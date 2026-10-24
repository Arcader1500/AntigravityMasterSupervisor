import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { TelemetryStore } from '../../src/telemetry/store.js';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryParser } from '../../src/telemetry/parser.js';
import { initLedger, loadLedger, updateLedger } from '../../src/core/ledger.js';
import { createProcessRunContext, recordProcessOutcome } from '../../src/core/process-outcome.js';

describe('telemetry/store', () => {
  let tmpDir: string;
  let vt: VirtualTerminal;
  let parser: TelemetryParser;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-store-test-'));
    vt = new VirtualTerminal({ cols: 80, rows: 24 });
    parser = new TelemetryParser({ mainAgent: 'orchestrator' });
  });

  afterEach(() => {
    vt.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes snapshot with defaults and elapsed timers', () => {
    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
      pid: 12345,
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.mainAgent).toBe('orchestrator');
    expect(snapshot.pid).toBe(12345);
    expect(snapshot.activeSubagent).toBeNull();
    expect(snapshot.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.phaseElapsedMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.subagentElapsedMs).toBe(0);
    expect(snapshot.ptyViewportLines).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    store.stop();
  });

  it('supports constructor with individual arguments', () => {
    const mockRunner = { getPid: () => 9876 };
    const store = new TelemetryStore(vt, parser, tmpDir, mockRunner);

    const snapshot = store.getSnapshot();
    expect(snapshot.pid).toBe(9876);
    store.stop();
  });

  it('updates snapshot and notifies listeners when virtual terminal emits committed lines', async () => {
    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    // Write a subagent dispatch command into virtual terminal
    await vt.write('invoking subagent implementer\r\n');

    expect(listener).toHaveBeenCalled();
    const snapshot = store.getSnapshot();
    expect(snapshot.activeSubagent).toBe('implementer');
    expect(snapshot.subagentElapsedMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.ptyViewportLines).toContain('invoking subagent implementer');

    // Unsubscribe and verify no more notifications
    listener.mockClear();
    unsubscribe();
    await vt.write('Status: DONE\r\n');
    expect(listener).not.toHaveBeenCalled();

    const updatedSnapshot = store.getSnapshot();
    expect(updatedSnapshot.activeSubagent).toBeNull();
    store.stop();
  });

  it('detects new git commit on pollNow, appends [GIT] event to activity feed and ledger', () => {
    execSync('git init -b main', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: tmpDir, stdio: 'ignore' });

    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'version 1');
    execSync('git add file.txt', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'ignore' });

    // Initialize ledger
    initLedger(tmpDir);

    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    // Initial poll records the initial commit
    store.pollNow();
    expect(store.getSnapshot().branch).toBe('main');

    // Make a new commit
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'version 2');
    execSync('git add file.txt', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "feat: second commit"', { cwd: tmpDir, stdio: 'ignore' });

    // Next poll should detect the new commit
    store.pollNow();
    const snapshot = store.getSnapshot();
    expect(snapshot.lastCommit?.subject).toBe('feat: second commit');

    // Check activity feed
    const gitEvent = snapshot.activityFeed.find((item) => item.actor === 'GIT');
    expect(gitEvent).toBeDefined();
    expect(gitEvent?.message).toContain('feat: second commit');

    // Check ledger event
    const ledger = loadLedger(tmpDir);
    const ledgerGitEvent = ledger.events.find((e) => e.message.includes('feat: second commit'));
    expect(ledgerGitEvent).toBeDefined();

    store.stop();
  });

  it('startPolling periodically invokes pollNow and stop cleans up timer', async () => {
    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    const pollSpy = vi.spyOn(store, 'pollNow');
    store.startPolling(50);

    await new Promise((res) => setTimeout(res, 120));
    expect(pollSpy).toHaveBeenCalled();

    store.stop();
    const callCountAfterStop = pollSpy.mock.calls.length;
    await new Promise((res) => setTimeout(res, 120));
    expect(pollSpy.mock.calls.length).toBe(callCountAfterStop);
  });

  it('ignores plan files older than sessionStartedAt and picks up session-scoped plans', () => {
    const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });

    const planFile = path.join(plansDir, '2026-10-17-prior-session-plan.md');
    fs.writeFileSync(planFile, '### Task 1: Prior Session\n- [ ] Step 1\n');

    const sessionStartedAt = Date.now() + 5000;
    const oldDate = new Date(sessionStartedAt - 60_000);
    fs.utimesSync(planFile, oldDate, oldDate);

    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
      sessionStartedAt,
    });

    expect(store.getSnapshot().tasks).toEqual([]);
    expect(store.getSnapshot().planPath).toBeNull();

    // A plan created during the session is discovered on the next poll.
    const freshDate = new Date(sessionStartedAt + 10_000);
    fs.utimesSync(planFile, freshDate, freshDate);

    const polled = store.pollNow();
    expect(polled.planPath).toContain('2026-10-17-prior-session-plan.md');
    expect(store.getSnapshot().tasks).toHaveLength(1);
    expect(store.getSnapshot().tasks[0]).toMatchObject({
      title: 'Task 1: Prior Session',
      status: 'pending',
    });

    store.stop();
  });

  it('transitions the ledger to EXECUTING when an execution subagent is dispatched', () => {
    initLedger(tmpDir);

    for (const status of ['PLANNING', 'CHECKPOINT_SPEC'] as const) {
      updateLedger(tmpDir, (ledger) => {
        ledger.status = status;
      });

      const store = new TelemetryStore({
        projectDir: tmpDir,
        virtualTerminal: vt,
        parser,
      });

      parser.processLine('invoke_subagent -> implementer');

      expect(loadLedger(tmpDir).status).toBe('EXECUTING');
      expect(store.getSnapshot().phaseSource).toBe('agent_output');
      store.stop();
    }
  });

  it('attributes task-driven phase promotion to discovered artifacts', () => {
    initLedger(tmpDir);
    const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, '2026-10-24-progress-plan.md'), '### Task 1: Observed progress\n- [x] Checkbox source is the plan\n');

    const store = new TelemetryStore({ projectDir: tmpDir, virtualTerminal: vt, parser });
    expect(store.getSnapshot().phaseSource).toBe('artifacts');
    store.stop();
  });

  it('keeps ended telemetry fenced while retaining discovered artifacts and ledger outcome provenance', () => {
    const initialLedger = initLedger(tmpDir);
    const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, '2026-10-24-fence-plan.md'), '### Task 1: Keep visible\n- [x] Observed only\n');

    const processRun = createProcessRunContext(initialLedger.sessionId);
    const outcome = {
      ...processRun,
      observedAt: new Date().toISOString(),
      kind: 'exit' as const,
      exitCode: 0,
    };
    recordProcessOutcome(tmpDir, outcome);

    const store = new TelemetryStore({ projectDir: tmpDir, virtualTerminal: vt, parser, processRun });
    store.handleProcessOutcome(outcome);
    parser.processLine('invoke_subagent -> implementer');
    store.pollNow();
    const snapshot = store.getSnapshot();

    expect(loadLedger(tmpDir).status).toBe('IDLE');
    expect(snapshot.planPath).toContain('2026-10-24-fence-plan.md');
    expect(snapshot.tasks[0]).toMatchObject({ status: 'completed' });
    expect(snapshot.processOutcome).toEqual(outcome);
    expect(snapshot.processOutcomeSource).toBe('ledger');
    expect(snapshot.phaseSource).toBe('ledger');
    store.stop();
  });

  it('keeps READY as reported agent output without approving a checkpoint', () => {
    initLedger(tmpDir);
    const store = new TelemetryStore({ projectDir: tmpDir, virtualTerminal: vt, parser });
    const received: any[] = [];
    store.onTelemetryEvent((event) => received.push(event));

    parser.processLine('invoke_subagent -> plan-critic');
    parser.processLine('Status: READY - plan is ready for review');

    expect(received.at(-1)).toMatchObject({ type: 'SUBAGENT_COMPLETED', verdict: 'READY', source: 'agent_output' });
    expect(loadLedger(tmpDir).checkpoints.spec.status).not.toBe('APPROVED');
    expect(loadLedger(tmpDir).checkpoints.plan.status).not.toBe('APPROVED');
    store.stop();
  });

  it('forwards structured telemetry events via onTelemetryEvent and exposes agentSteps and lastErrorLine in snapshot', async () => {
    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    const receivedEvents: any[] = [];
    const unsub = store.onTelemetryEvent((e) => receivedEvents.push(e));

    await vt.write('invoking subagent implementer\r\n');
    await vt.write('view_file: auth.ts\r\n');
    await vt.write('Error: connect ECONNREFUSED 127.0.0.1:6379\r\n');

    expect(receivedEvents.length).toBeGreaterThan(0);
    expect(receivedEvents.some((e) => e.type === 'SUBAGENT_DISPATCHED')).toBe(true);
    expect(receivedEvents.some((e) => e.type === 'TOOL_CALLED')).toBe(true);
    expect(receivedEvents.some((e) => e.type === 'ERROR_LINE')).toBe(true);
    expect(receivedEvents.every((e) => e.source === 'agent_output')).toBe(true);

    const snapshot = store.getSnapshot();
    expect(snapshot.lastErrorLine).toContain('ECONNREFUSED');
    expect(snapshot.agentSteps?.['implementer']).toBeDefined();
    expect(snapshot.agentSteps?.['implementer'].length).toBeGreaterThan(0);

    unsub();
    store.stop();
  });
});
