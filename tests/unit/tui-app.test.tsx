import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { App } from '../../src/tui/App.js';
import { mountSupervisorTui } from '../../src/tui/index.js';
import type { TelemetrySnapshot } from '../../src/telemetry/types.js';
import type { SupervisorLedger } from '../../src/core/types.js';
import { PtyRunner } from '../../src/pty/runner.js';
import { initLedger, loadLedger } from '../../src/core/ledger.js';

describe('TUI App & Modal Input Router', () => {
  const sampleSnapshot: TelemetrySnapshot = {
    branch: 'main',
    dirtyFilesCount: 0,
    totalElapsedMs: 1000,
    phaseElapsedMs: 1000,
    subagentElapsedMs: 0,
    mainAgent: 'planner',
    pid: 1234,
    activeSubagent: null,
    lastAction: null,
    lastCommand: null,
    waitingForInput: false,
    specPath: 'docs/superpowers/specs/test-design.md',
    specContent: '# Test Spec Body\nLine 1\nLine 2\nLine 3\nLine 4',
    planPath: 'docs/superpowers/plans/test-plan.md',
    planContent: '# Test Plan Body\nPlan Item 1\nPlan Item 2',
    tasks: [],
    activityFeed: [],
    ptyViewportLines: ['agy prompt >'],
  };

  const sampleLedger: SupervisorLedger = {
    version: '1.0.0',
    sessionId: 's1',
    projectPath: process.cwd(),
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
    status: 'EXECUTING',
    activeAgent: 'planner',
    checkpoints: {
      spec: { status: 'UNINITIALIZED' },
      plan: { status: 'UNINITIALIZED' },
    },
    events: [
      { timestamp: '10:00:01', level: 'INFO', message: 'First event' },
      { timestamp: '10:00:02', level: 'INFO', message: 'Second event' },
      { timestamp: '10:00:03', level: 'WARN', message: 'Third event' },
    ],
  };

  it('switches panels in NAVIGATION mode and locks keystrokes to PTY in PTY_INTERACT mode until Ctrl+]', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
      />
    );

    // 1. Default render shows Panel [1] (MainStatusView)
    expect(lastFrame()).toContain('CURRENTLY RUNNING');
    expect(lastFrame()).toContain('planner');

    // 2. Pressing '2' switches to Panel [2] (LivePtyView) in NAVIGATION mode
    stdin.write('2');
    expect(lastFrame()).toContain('agy prompt >');
    expect(lastFrame()).toContain('○ NAVIGATION');

    // 3. Pressing 'i' on Panel [2] enters PTY_INTERACT mode
    stdin.write('i');
    expect(lastFrame()).toContain('Ctrl+]');
    expect(lastFrame()).toContain('● PTY INTERACT');

    // 4. While in PTY_INTERACT mode, writing '1', 'hello', '\r', '\x0b' forwards to onWritePty and does NOT switch tabs
    stdin.write('1');
    expect(onWritePty).toHaveBeenCalledWith('1');
    expect(lastFrame()).toContain('● PTY INTERACT');

    stdin.write('hello');
    expect(onWritePty).toHaveBeenCalledWith('hello');

    stdin.write('\r');
    expect(onWritePty).toHaveBeenCalledWith('\r');

    stdin.write('\x0b');
    expect(onWritePty).toHaveBeenCalledWith('\x0b');

    // 5. Writing '\x1d' (Ctrl+]) detaches back to NAVIGATION mode without forwarding '\x1d'
    stdin.write('\x1d');
    expect(onWritePty).not.toHaveBeenCalledWith('\x1d');
    expect(lastFrame()).toContain('○ NAVIGATION');

    // Now '3' switches to SpecPlanView
    stdin.write('3');
    expect(lastFrame()).toContain('# Test Spec Body');

    // And '4' switches to AuditLogView
    stdin.write('4');
    expect(lastFrame()).toContain('SUPERVISOR AUDIT LEDGER');
    expect(lastFrame()).toContain('First event');
  });

  it('switches to Panel 2 and enters PTY_INTERACT directly when pressing "t"', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
      />
    );

    // Start at Panel 1
    expect(lastFrame()).toContain('CURRENTLY RUNNING');

    // Press 't' from Panel 1
    stdin.write('t');
    expect(lastFrame()).toContain('● PTY INTERACT');
    expect(lastFrame()).toContain('Ctrl+]');

    // Type in PTY_INTERACT
    stdin.write('ls -la');
    expect(onWritePty).toHaveBeenCalledWith('ls -la');
  });

  it('enters PTY_INTERACT when pressing Enter on Panel 2', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
      />
    );

    stdin.write('2');
    expect(lastFrame()).toContain('○ NAVIGATION');

    stdin.write('\r');
    expect(lastFrame()).toContain('● PTY INTERACT');
  });

  it('toggles between Spec and Plan on Panel 3 using "s" and "p"', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={3}
      />
    );

    // Default doc on Panel 3 is spec
    expect(lastFrame()).toContain('# Test Spec Body');

    // Switch to plan with 'p'
    stdin.write('p');
    expect(lastFrame()).toContain('# Test Plan Body');

    // Switch back to spec with 's'
    stdin.write('s');
    expect(lastFrame()).toContain('# Test Spec Body');
  });

  it('scrolls SpecPlanView and AuditLogView with arrows and j/k keys', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const longSpecSnapshot: TelemetrySnapshot = {
      ...sampleSnapshot,
      specContent: Array.from({ length: 50 }, (_, i) => `Spec line ${i + 1}`).join('\n'),
    };

    const { stdin, lastFrame } = render(
      <App
        snapshot={longSpecSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={3}
      />
    );

    expect(lastFrame()).toContain('Spec line 1');

    // Scroll down with 'j'
    stdin.write('j');
    expect(lastFrame()).toContain('Spec line 2');

    // Scroll down with down arrow \x1b[B
    stdin.write('\x1b[B');
    expect(lastFrame()).toContain('Spec line 3');

    // Scroll up with 'k'
    stdin.write('k');
    expect(lastFrame()).toContain('Spec line 2');

    // Scroll up with up arrow \x1b[A
    stdin.write('\x1b[A');
    expect(lastFrame()).toContain('Spec line 1');

    // Scrolling up at 0 does not underflow
    stdin.write('k');
    expect(lastFrame()).toContain('Spec line 1');
  });

  it('scrolls SpecPlanView and AuditLogView with PageUp and PageDown by 10 lines', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const longSpecSnapshot: TelemetrySnapshot = {
      ...sampleSnapshot,
      specContent: Array.from({ length: 50 }, (_, i) => `Spec line ${i + 1}`).join('\n'),
    };

    const { stdin, lastFrame } = render(
      <App
        snapshot={longSpecSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={3}
      />
    );

    expect(lastFrame()).toContain('Spec line 1');

    // PageDown scrolls down by 10 lines (\x1b[6~)
    stdin.write('\x1b[6~');
    expect(lastFrame()).toContain('Spec line 11');

    // PageDown scrolls down another 10 lines
    stdin.write('\x1b[6~');
    expect(lastFrame()).toContain('Spec line 21');

    // PageUp scrolls up by 10 lines (\x1b[5~)
    stdin.write('\x1b[5~');
    expect(lastFrame()).toContain('Spec line 11');

    // PageUp scrolls back to top
    stdin.write('\x1b[5~');
    expect(lastFrame()).toContain('Spec line 1');

    // PageUp at 0 does not underflow
    stdin.write('\x1b[5~');
    expect(lastFrame()).toContain('Spec line 1');

    // Test on Panel 4 (AuditLogView)
    const longLedger: SupervisorLedger = {
      ...sampleLedger,
      events: Array.from({ length: 50 }, (_, i) => ({
        timestamp: '10:00:00',
        level: 'INFO' as const,
        message: `Audit event ${i + 1}`,
      })),
    };

    const { stdin: stdin4, lastFrame: lastFrame4 } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={longLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={4}
      />
    );

    expect(lastFrame4()).toContain('Audit event 1');
    stdin4.write('\x1b[6~');
    expect(lastFrame4()).toContain('Audit event 11');
    stdin4.write('\x1b[5~');
    expect(lastFrame4()).toContain('Audit event 1');
  });

  it('invokes onRequestQuit when "q", "Q", or Ctrl+C is pressed in NAVIGATION mode', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
      />
    );

    stdin.write('q');
    expect(onRequestQuit).toHaveBeenCalledTimes(1);

    stdin.write('Q');
    expect(onRequestQuit).toHaveBeenCalledTimes(2);

    stdin.write('\x03');
    expect(onRequestQuit).toHaveBeenCalledTimes(3);
  });

  it('splits chunk with Ctrl+] in PTY_INTERACT mode, forwarding prefix and handling suffix in NAVIGATION', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { stdin, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={2}
        initialInputMode="PTY_INTERACT"
      />
    );

    expect(lastFrame()).toContain('● PTY INTERACT');

    // Send chunk containing text before Ctrl+] and '3' after Ctrl+]
    stdin.write('my-command\x1d3');
    expect(onWritePty).toHaveBeenCalledWith('my-command');
    expect(onWritePty).not.toHaveBeenCalledWith('my-command\x1d3');

    // Should now be on Panel 3 in NAVIGATION mode
    expect(lastFrame()).toContain('[NAV]');
    expect(lastFrame()).toContain('# Test Spec Body');
  });

  it('returns to NAVIGATION mode when forceNavigationSignal updates', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { rerender, lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={2}
        initialInputMode="PTY_INTERACT"
        forceNavigationSignal={0}
      />
    );

    expect(lastFrame()).toContain('● PTY INTERACT');

    // Rerender with incremented forceNavigationSignal
    rerender(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
        initialPanel={2}
        initialInputMode="PTY_INTERACT"
        forceNavigationSignal={1}
      />
    );

    expect(lastFrame()).toContain('○ NAVIGATION');
  });
});

describe('mountSupervisorTui integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tui-test-'));
    initLedger(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('mounts TUI, wires PTY runner and store, and unmounts cleanly', async () => {
    const ptyRunner = new PtyRunner({
      projectDir: tempDir,
      binaryPath: 'agy',
      agent: 'planner',
      dryRun: true,
    });

    const tui = mountSupervisorTui({
      projectDir: tempDir,
      ptyRunner,
      mainAgent: 'planner',
    });

    expect(tui.store).toBeDefined();
    expect(tui.virtualTerminal).toBeDefined();
    expect(typeof tui.unmount).toBe('function');
    expect(typeof tui.waitUntilExit).toBe('function');

    // Verify virtualTerminal received initial dimensions
    expect(tui.virtualTerminal.getCols()).toBeGreaterThanOrEqual(20);
    expect(tui.virtualTerminal.getRows()).toBeGreaterThanOrEqual(10);

    // Clean unmount
    tui.unmount();
    await tui.waitUntilExit();
  });

  it('updates virtualTerminal and store when ptyRunner emits data', async () => {
    let capturedDataListener: ((chunk: string) => void) | undefined;
    const mockPtyRunner = {
      onData: vi.fn((listener: (chunk: string) => void) => {
        capturedDataListener = listener;
      }),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      isProcessRunning: vi.fn(() => false),
      kill: vi.fn(),
      getPid: vi.fn(() => 4567),
    } as unknown as PtyRunner;

    const tui = mountSupervisorTui({
      projectDir: tempDir,
      ptyRunner: mockPtyRunner,
      mainAgent: 'planner',
    });

    expect(capturedDataListener).toBeDefined();

    const notifySpy = vi.spyOn(tui.store, 'notify');
    capturedDataListener!('test output from pty\r\n');

    // Wait for virtualTerminal.write promise to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(notifySpy).toHaveBeenCalled();
    expect(tui.virtualTerminal.getViewportLines().join(' ')).toContain('test output from pty');

    tui.unmount();
    await tui.waitUntilExit();
  });
});
