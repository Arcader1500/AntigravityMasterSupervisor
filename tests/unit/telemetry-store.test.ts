import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { TelemetryStore } from '../../src/telemetry/store.js';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryParser } from '../../src/telemetry/parser.js';
import { initLedger, loadLedger } from '../../src/core/ledger.js';

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

    const snapshot = store.getSnapshot();
    expect(snapshot.lastErrorLine).toContain('ECONNREFUSED');
    expect(snapshot.agentSteps?.['implementer']).toBeDefined();
    expect(snapshot.agentSteps?.['implementer'].length).toBeGreaterThan(0);

    unsub();
    store.stop();
  });
});
