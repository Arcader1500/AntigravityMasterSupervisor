import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initLedger, loadLedger, saveLedgerAtomic } from '../../src/core/ledger.js';
import {
  createProcessRunContext,
  formatProcessOutcome,
  recordProcessOutcome,
} from '../../src/core/process-outcome.js';

const directories: string[] = [];

function createWorkspace() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-process-outcome-'));
  directories.push(projectDir);
  return projectDir;
}

afterEach(() => {
  for (const projectDir of directories.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('process outcomes', () => {
  it('records zero exit as idle and deduplicates by invocation', () => {
    const projectDir = createWorkspace();
    const ledger = initLedger(projectDir);
    const context = createProcessRunContext(ledger.sessionId);
    const outcome = { ...context, observedAt: '2026-10-24T00:00:00.000Z', kind: 'exit' as const, exitCode: 0 };

    expect(recordProcessOutcome(projectDir, outcome)).toMatchObject({ recorded: true, ledger: { status: 'IDLE' } });
    const beforeDuplicate = loadLedger(projectDir);
    expect(recordProcessOutcome(projectDir, outcome)).toEqual({ ledger: beforeDuplicate, recorded: false });
    expect(loadLedger(projectDir).events).toHaveLength(1);
  });

  it('records separate resumed-session invocations without changing schema', () => {
    const projectDir = createWorkspace();
    const ledger = initLedger(projectDir);
    const first = createProcessRunContext(ledger.sessionId);
    const second = createProcessRunContext(ledger.sessionId);
    expect(second.runId).not.toBe(first.runId);

    recordProcessOutcome(projectDir, { ...first, observedAt: '2026-10-24T00:00:00.000Z', kind: 'exit', exitCode: 0 });
    const result = recordProcessOutcome(projectDir, { ...second, observedAt: '2026-10-24T00:00:01.000Z', kind: 'exit', exitCode: 7 });
    expect(result).toMatchObject({ recorded: true, ledger: { version: '1.0.0', sessionId: ledger.sessionId, status: 'FAILED' } });
    expect(result.ledger.events).toHaveLength(2);
  });

  it('rejects stale session outcomes without modifying the new ledger', () => {
    const projectDir = createWorkspace();
    initLedger(projectDir);
    const stale = createProcessRunContext(loadLedger(projectDir).sessionId);
    const replacement = initLedger(projectDir, { reset: true });
    const before = loadLedger(projectDir);
    const outcome = { ...stale, observedAt: '2026-10-24T00:00:00.000Z', kind: 'exit' as const, exitCode: 0 };
    expect(() => recordProcessOutcome(projectDir, outcome)).toThrow(/session/i);
    expect(loadLedger(projectDir)).toEqual(before);
    expect(replacement.sessionId).not.toBe(stale.sessionId);
  });

  it.each([
    [{ kind: 'exit', signal: 9 }, 'FAILED', /signal 9/i],
    [{ kind: 'exit' }, 'FAILED', /unknown/i],
    [{ kind: 'startup_error', message: 'spawn failed' }, 'FAILED', /failed to start/i],
    [{ kind: 'interrupted', supervisorSignal: 'SIGINT', supervisorExitCode: 130 }, 'IDLE', /interrupted.*SIGINT.*130/i],
  ] as const)('records %j with factual status and formatting', (details, status, formatted) => {
    const projectDir = createWorkspace();
    const ledger = initLedger(projectDir);
    const outcome = { ...createProcessRunContext(ledger.sessionId), observedAt: '2026-10-24T00:00:00.000Z', ...details } as const;
    expect(recordProcessOutcome(projectDir, outcome).ledger.status).toBe(status);
    expect(formatProcessOutcome(outcome)).toMatch(formatted);
  });

  it('bounds startup error metadata and retains legacy ledger events', () => {
    const projectDir = createWorkspace();
    const ledger = initLedger(projectDir);
    ledger.status = 'COMPLETED';
    ledger.events.push({ timestamp: '2026-10-23T00:00:00.000Z', level: 'INFO', message: 'legacy' });
    saveLedgerAtomic(projectDir, ledger);
    const context = createProcessRunContext(ledger.sessionId);
    recordProcessOutcome(projectDir, { ...context, observedAt: '2026-10-24T00:00:00.000Z', kind: 'startup_error', message: 'x'.repeat(1000) });
    const read = loadLedger(projectDir);
    expect(read.version).toBe('1.0.0');
    expect(read.events[0]?.message).toBe('legacy');
    expect(read.events[1]?.metadata).toMatchObject({ kind: 'PROCESS_OUTCOME', outcomeKind: 'startup_error' });
    expect(String(read.events[1]?.metadata?.message).length).toBeLessThanOrEqual(500);
    expect(formatProcessOutcome({ ...context, observedAt: '', kind: 'exit', exitCode: 0 })).toBe('Agent process exited with code 0');
  });
});
