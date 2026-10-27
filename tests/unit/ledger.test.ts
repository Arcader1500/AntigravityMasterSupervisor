import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  initLedger,
  loadLedger,
  updateLedger,
  saveLedgerAtomic,
  appendLedgerEvent,
  getLedgerPath,
  createWorkflowState,
} from '../../src/core/ledger.js';
import { createHash } from 'node:crypto';

describe('Workspace Ledger', () => {
  const testDir = path.join(process.cwd(), 'tests/fixtures/test-ledger');

  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('computes correct ledger path', () => {
    const ledgerPath = getLedgerPath(testDir);
    expect(ledgerPath).toBe(path.join(testDir, '.agy', 'supervisor_state.json'));
  });

  it('initializes a new supervisor_state.json with default structure', () => {
    const ledger = initLedger(testDir);
    expect(ledger.version).toBe('1.0.0');
    expect(ledger.status).toBe('IDLE');
    expect(ledger.activeAgent).toBeNull();
    expect(ledger.projectPath).toBe(path.resolve(testDir));
    expect(ledger.checkpoints.spec.status).toBe('UNINITIALIZED');
    expect(ledger.checkpoints.plan.status).toBe('UNINITIALIZED');
    expect(Array.isArray(ledger.events)).toBe(true);
    expect(ledger.events).toHaveLength(0);
    expect(fs.existsSync(path.join(testDir, '.agy', 'supervisor_state.json'))).toBe(true);
  });

  it('returns existing ledger if already initialized without resetting fields', () => {
    const ledger1 = initLedger(testDir);
    updateLedger(testDir, (l) => {
      l.status = 'PLANNING';
      l.activeAgent = 'planner';
    });

    const ledger2 = initLedger(testDir);
    expect(ledger2.sessionId).toBe(ledger1.sessionId);
    expect(ledger2.status).toBe('PLANNING');
    expect(ledger2.activeAgent).toBe('planner');
  });

  it('preserves the existing ledger when reset is not requested', () => {
    const original = initLedger(testDir);
    updateLedger(testDir, (l) => {
      l.status = 'EXECUTING';
      l.checkpoints.spec = { status: 'PENDING' };
      l.events.push({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message: 'kept event',
      });
    });

    const preserved = initLedger(testDir);
    expect(preserved.sessionId).toBe(original.sessionId);
    expect(preserved.status).toBe('EXECUTING');
    expect(preserved.checkpoints.spec.status).toBe('PENDING');
    expect(preserved.events).toHaveLength(1);
  });

  it('resets an existing ledger when reset option is true', () => {
    const original = initLedger(testDir);
    updateLedger(testDir, (l) => {
      l.status = 'EXECUTING';
      l.activeAgent = 'executor';
      l.checkpoints.spec = { status: 'PENDING', path: 'docs/specs/spec.md' };
      l.checkpoints.plan = { status: 'APPROVED' };
      l.events.push({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'old session event',
      });
    });

    const reset = initLedger(testDir, { reset: true });

    expect(reset.sessionId).not.toBe(original.sessionId);
    expect(reset.status).toBe('IDLE');
    expect(reset.activeAgent).toBeNull();
    expect(reset.checkpoints.spec).toEqual({ status: 'UNINITIALIZED' });
    expect(reset.checkpoints.plan).toEqual({ status: 'UNINITIALIZED' });
    expect(reset.events).toEqual([]);
    expect(reset.projectPath).toBe(path.resolve(testDir));

    const onDisk = loadLedger(testDir);
    expect(onDisk.sessionId).toBe(reset.sessionId);
    expect(onDisk.status).toBe('IDLE');
    expect(onDisk.activeAgent).toBeNull();
    expect(onDisk.checkpoints.spec).toEqual({ status: 'UNINITIALIZED' });
    expect(onDisk.events).toEqual([]);
  });

  it('loads existing ledger from disk', () => {
    initLedger(testDir);
    updateLedger(testDir, (l) => {
      l.status = 'EXECUTING';
      l.checkpoints.spec.status = 'APPROVED';
    });

    const loaded = loadLedger(testDir);
    expect(loaded.status).toBe('EXECUTING');
    expect(loaded.checkpoints.spec.status).toBe('APPROVED');
  });

  it('updates ledger atomically and refreshes updatedAt', async () => {
    const initial = initLedger(testDir);
    const initialUpdatedAt = initial.updatedAt;

    // Small delay to ensure timestamp changes if resolution allows
    await new Promise((res) => setTimeout(res, 20));

    const updated = updateLedger(testDir, (l) => {
      l.status = 'CHECKPOINT_SPEC';
      l.checkpoints.spec = {
        status: 'PENDING',
        path: 'docs/superpowers/specs/spec.md',
      };
    });

    expect(updated.status).toBe('CHECKPOINT_SPEC');
    expect(updated.checkpoints.spec.status).toBe('PENDING');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(initialUpdatedAt).getTime()
    );

    // Verify temp file does not linger
    const tmpFile = `${getLedgerPath(testDir)}.tmp`;
    expect(fs.existsSync(tmpFile)).toBe(false);

    // Verify disk content matches
    const diskLedger = JSON.parse(fs.readFileSync(getLedgerPath(testDir), 'utf-8'));
    expect(diskLedger.status).toBe('CHECKPOINT_SPEC');
  });

  it('appends events with timestamps and levels', () => {
    initLedger(testDir);
    appendLedgerEvent(testDir, 'INFO', 'Session started', { runMode: 'test' });
    appendLedgerEvent(testDir, 'WARN', 'Potential retry', { attempt: 1 });

    const loaded = loadLedger(testDir);
    expect(loaded.events).toHaveLength(2);
    expect(loaded.events[0].level).toBe('INFO');
    expect(loaded.events[0].message).toBe('Session started');
    expect(loaded.events[0].metadata).toEqual({ runMode: 'test' });
    expect(loaded.events[1].level).toBe('WARN');
    expect(loaded.events[1].message).toBe('Potential retry');
  });

  it('recovers from corrupt JSON by backing up corrupt file and re-initializing clean ledger', () => {
    const agyDir = path.join(testDir, '.agy');
    fs.mkdirSync(agyDir, { recursive: true });
    const ledgerFile = path.join(agyDir, 'supervisor_state.json');
    fs.writeFileSync(ledgerFile, 'MALFORMED_JSON_CONTENT_<<<', 'utf-8');

    const recovered = loadLedger(testDir);
    expect(recovered.version).toBe('1.0.0');
    expect(recovered.status).toBe('IDLE');

    // Verify backup file exists
    const files = fs.readdirSync(agyDir);
    const corruptBackup = files.find((f) => f.startsWith('supervisor_state.json.corrupt.'));
    expect(corruptBackup).toBeDefined();

    if (corruptBackup) {
      const backupContent = fs.readFileSync(path.join(agyDir, corruptBackup), 'utf-8');
      expect(backupContent).toBe('MALFORMED_JSON_CONTENT_<<<');
    }
  });

  it('saveLedgerAtomic writes content safely and can be reloaded', () => {
    const initial = initLedger(testDir);
    initial.status = 'COMPLETED';
    saveLedgerAtomic(testDir, initial);

    const reloaded = loadLedger(testDir);
    expect(reloaded.status).toBe('COMPLETED');
  });

  it('migrates legacy ledgers additively while preserving historical status and events', () => {
    const legacy = {
      version: '1.0.0', sessionId: 'legacy-session', projectPath: path.resolve(testDir),
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'COMPLETED', activeAgent: null,
      checkpoints: { spec: { status: 'APPROVED' }, plan: { status: 'PENDING' } },
      events: [{ timestamp: '2026-01-01T00:00:00.000Z', level: 'INFO', message: 'legacy event' }],
    };
    fs.mkdirSync(path.dirname(getLedgerPath(testDir)), { recursive: true });
    fs.writeFileSync(getLedgerPath(testDir), JSON.stringify(legacy));

    const migrated = loadLedger(testDir);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.status).toBe('COMPLETED');
    expect(migrated.sessionId).toBe('legacy-session');
    expect(migrated.events).toEqual(legacy.events);
    expect(migrated.workflow).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(getLedgerPath(testDir), 'utf-8')).schemaVersion).toBe(2);
  });

  it('preserves unknown schema versions without overwriting or authorizing them', () => {
    const unknown = { schemaVersion: 999, version: '99.0.0', status: 'COMPLETED', marker: 'diagnostic' };
    fs.mkdirSync(path.dirname(getLedgerPath(testDir)), { recursive: true });
    fs.writeFileSync(getLedgerPath(testDir), JSON.stringify(unknown));

    expect(() => loadLedger(testDir)).toThrow(/unsupported.*schema/i);
    expect(fs.readFileSync(getLedgerPath(testDir), 'utf-8')).toBe(JSON.stringify(unknown));

    const unknownLegacy = { ...unknown, schemaVersion: undefined, version: '99.0.0' };
    fs.writeFileSync(getLedgerPath(testDir), JSON.stringify(unknownLegacy));
    expect(() => loadLedger(testDir)).toThrow(/unsupported.*schema/i);
    expect(fs.readFileSync(getLedgerPath(testDir), 'utf-8')).toBe(JSON.stringify(unknownLegacy));
  });

  it('creates an immutable request snapshot whose hash survives workflow persistence', () => {
    const ledger = initLedger(testDir);
    const request = 'Implement the approved lifecycle.';
    const workflow = createWorkflowState(testDir, request, { runId: 'run-fixed' });

    expect(workflow.originalRequest.path).toBe(path.join('.agy', 'runs', 'run-fixed', 'request.txt'));
    expect(workflow.originalRequest.revision).toBe(createHash('sha256').update(request).digest('hex'));
    expect(fs.readFileSync(path.join(testDir, workflow.originalRequest.path), 'utf-8')).toBe(request);
    expect(loadLedger(testDir).workflow).toEqual(workflow);
    expect(() => createWorkflowState(testDir, 'changed request', { runId: 'run-fixed' })).toThrow(/immutable/i);
    expect(fs.readFileSync(path.join(testDir, workflow.originalRequest.path), 'utf-8')).toBe(request);
    expect(ledger.sessionId).toBe(loadLedger(testDir).sessionId);
  });

  it('retains approval history tied to artifact revisions', () => {
    const ledger = initLedger(testDir);
    ledger.workflow = {
      schemaVersion: 1, runId: 'run-approval', workspaceRoot: testDir, phase: 'planning',
      originalRequest: { path: '.agy/runs/run-approval/request.txt', revision: 'a'.repeat(64) },
      decisionsPath: '.agy/runs/run-approval/decisions.jsonl', journalPath: '.agy/runs/run-approval/events.jsonl',
      approvals: [
        { actor: 'user', artifactKind: 'spec', revision: 'b'.repeat(64), decision: 'approved', recordedAt: '2026-01-01T00:00:00.000Z' },
        { actor: 'user', artifactKind: 'spec', revision: 'c'.repeat(64), decision: 'rejected', recordedAt: '2026-01-02T00:00:00.000Z' },
      ],
    };
    saveLedgerAtomic(testDir, ledger);

    expect(loadLedger(testDir).workflow?.approvals).toHaveLength(2);
    expect(loadLedger(testDir).workflow?.approvals?.map((approval) => approval.revision)).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
  });
});
