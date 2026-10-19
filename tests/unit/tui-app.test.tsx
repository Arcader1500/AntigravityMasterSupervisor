import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { App } from '../../src/tui/App.js';
import { mountSupervisorTui } from '../../src/tui/index.js';
import { TranscriptStore } from '../../src/tui/transcript-store.js';
import type { TelemetrySnapshot } from '../../src/telemetry/types.js';
import type { SupervisorLedger } from '../../src/core/types.js';
import { PtyRunner } from '../../src/pty/runner.js';
import { initLedger, loadLedger } from '../../src/core/ledger.js';

describe('TUI App Mode Router & Responsive Layout', () => {
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

  function createMockTranscriptStore(
    onWritePty: (data: string) => void,
    onRequestQuit: () => void,
    customSnapshot = sampleSnapshot
  ) {
    const fakeTelemetryStore = {
      getSnapshot: () => ({ ...customSnapshot }),
      onTelemetryEvent: vi.fn(() => () => {}),
      subscribe: vi.fn(() => () => {}),
    } as any;

    return new TranscriptStore({
      telemetryStore: fakeTelemetryStore,
      initialLedger: sampleLedger,
      onWritePty,
      onRequestQuit,
    });
  }

  it('launching with no prior messages shows empty chat, focused composer, and hides TeamRail', () => {
    const onWritePty = vi.fn();
    const onRequestQuit = vi.fn();

    const { lastFrame } = render(
      <App
        snapshot={sampleSnapshot}
        ledger={sampleLedger}
        onWritePty={onWritePty}
        onRequestQuit={onRequestQuit}
      />
    );

    const frame = lastFrame() ?? '';
    // Shows initial empty chat note
    expect(frame).toContain(
      'What do you want built? Describe it in your own words'
    );
    // Focused composer placeholder
    expect(frame).toContain('Describe what you want built');
    // TeamRail should be hidden on first launch before work starts
    expect(frame).not.toContain('Tasks appear once the plan is approved');
  });

  it('typing characters in CHAT mode appends to Composer and submits on Enter without triggering shortcuts', () => {
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

    // Write letters and digits: q, p, t, r, 1, 2, 3, 4
    stdin.write('qptr1234');
    expect(lastFrame()).toContain('qptr1234');
    // onRequestQuit should NOT have been called by 'q'
    expect(onRequestQuit).not.toHaveBeenCalled();

    // Submit with Enter
    stdin.write('\r');
    expect(onWritePty).toHaveBeenCalledWith('qptr1234\r');
  });

  describe('Decision card interaction', () => {
    it('pressing 2 then Enter on focused DecisionCard sends \\x1b[B\\r and removes badge', async () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();
      const store = createMockTranscriptStore(onWritePty, onRequestQuit);

      store.dispatch({
        type: 'TELEMETRY_EVENT',
        event: {
          type: 'DECISION_PROMPT',
          promptKind: 'ask_question',
          headline: 'Select rate limiter strategy',
          question: 'Which strategy do you prefer?',
          options: [
            { index: 1, label: 'Token bucket' },
            { index: 2, label: 'Leaky bucket' },
          ],
          timestamp: new Date().toISOString(),
        },
        elapsedFormatted: '0s',
      });

      const { stdin, lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={store}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      // Verify card is focused and 1 needs you badge is in header
      expect(lastFrame()).toContain('1 needs you');
      expect(lastFrame()).toContain('Select rate limiter strategy');

      // Press 2
      stdin.write('2');
      // Press Enter
      stdin.write('\r');

      expect(onWritePty).toHaveBeenCalledWith('\x1b[B\r');
      await new Promise((r) => setTimeout(r, 50));
      expect(lastFrame()).toContain('You chose: Leaky bucket');
      expect(lastFrame()).not.toContain('1 needs you');
    });

    it('typing non-digit characters switches to free-form and backspacing restores option 1', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();
      const store = createMockTranscriptStore(onWritePty, onRequestQuit);

      store.dispatch({
        type: 'TELEMETRY_EVENT',
        event: {
          type: 'DECISION_PROMPT',
          promptKind: 'ask_question',
          headline: 'Select rate limiter strategy',
          question: 'Which strategy?',
          options: [
            { index: 1, label: 'Token bucket' },
            { index: 2, label: 'Leaky bucket' },
          ],
          timestamp: new Date().toISOString(),
        },
        elapsedFormatted: '0s',
      });

      const { stdin, lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={store}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      // Typing non-digit 'w' switches to free-form
      stdin.write('w');
      expect(lastFrame()).toContain('w');

      // Backspace back to empty restores option 1
      stdin.write('\x7f');

      // Submitting on empty sends option 1
      stdin.write('\r');
      expect(onWritePty).toHaveBeenCalledWith('\r');
      expect(lastFrame()).toContain('You chose: Token bucket');
    });

    it('pressing Esc defers decision and End re-focuses it', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();
      const store = createMockTranscriptStore(onWritePty, onRequestQuit);

      store.dispatch({
        type: 'TELEMETRY_EVENT',
        event: {
          type: 'DECISION_PROMPT',
          promptKind: 'ask_question',
          headline: 'Select rate limiter strategy',
          question: 'Which strategy?',
          options: [
            { index: 1, label: 'Token bucket' },
            { index: 2, label: 'Leaky bucket' },
          ],
          timestamp: new Date().toISOString(),
        },
        elapsedFormatted: '0s',
      });

      const { stdin, lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={store}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      expect(lastFrame()).toContain('1 needs you');

      // Esc defers
      stdin.write('\x1b');
      // Badge stays
      expect(lastFrame()).toContain('1 needs you');

      // End key \x1b[F re-focuses
      stdin.write('\x1b[F');
      expect(lastFrame()).toContain('1 needs you');
    });
  });

  describe('Mode transitions', () => {
    const runningSnapshot: TelemetrySnapshot = {
      ...sampleSnapshot,
      activeSubagent: 'implementer',
      subagentElapsedMs: 35000,
      tasks: [
        {
          id: '1',
          title: 'Route middleware',
          status: 'in_progress',
        },
      ],
      ptyViewportLines: ['npm test', '14 passed'],
    };

    it('Tab enters TEAM, arrows select, Enter zooms, Ctrl+R opens raw overlay, Esc returns', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
          dimensions={{ columns: 120, rows: 36 }}
        />
      );

      // Press Tab to enter TEAM mode
      stdin.write('\t');
      // Down arrow to select row
      stdin.write('\x1b[B');

      // Enter to enter ZOOM mode
      stdin.write('\r');
      expect(lastFrame()).toMatch(/Team \/ (implementer|orchestrator)/);

      // Ctrl+R (\x12) opens full raw overlay
      stdin.write('\x12');
      expect(lastFrame()).toContain('Esc back to the conversation');

      // Esc closes raw overlay back to ZOOM mode
      stdin.write('\x1b');
      // Second Esc returns from ZOOM mode to CHAT mode
      stdin.write('\x1b');
      expect(lastFrame()).not.toContain('Esc back to the conversation');
    });

    it('Ctrl+T enters TAKEOVER mode forwarding keystrokes until Ctrl+]', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      // Press Ctrl+T (\x14)
      stdin.write('\x14');
      expect(lastFrame()).toContain(
        "You are typing into the agent's terminal. Press Ctrl+] to return."
      );

      // Keystrokes forward 100% to onWritePty
      stdin.write('git status\r');
      expect(onWritePty).toHaveBeenCalledWith('git status\r');

      // Ctrl+] (\x1d) exits TAKEOVER mode back to CHAT
      stdin.write('\x1d');
      expect(lastFrame()).not.toContain(
        "You are typing into the agent's terminal"
      );
    });

    it('/spec, /plan, /audit open overlays and Esc closes them', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      // /spec opens SpecPlanView
      stdin.write('/spec\r');
      expect(lastFrame()).toContain('test-design.md');
      expect(lastFrame()).toContain('Esc back to the conversation');

      // Esc closes
      stdin.write('\x1b');
      expect(lastFrame()).not.toContain('test-design.md');

      // /audit opens AuditLogView forwarding ledger
      stdin.write('/audit\r');
      expect(lastFrame()).toContain('SUPERVISOR AUDIT LEDGER');
      expect(lastFrame()).toContain('First event');

      // Esc closes
      stdin.write('\x1b');
      expect(lastFrame()).not.toContain('SUPERVISOR AUDIT LEDGER');
    });

    it('/pause and /resume toggle paused state', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      stdin.write('/pause\r');
      expect(lastFrame()).toContain('Paused');

      stdin.write('/resume\r');
      expect(lastFrame()).not.toContain('Paused');
    });

    it('Ctrl+C once confirms quit and second Ctrl+C calls onRequestQuit', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
        />
      );

      // First Ctrl+C
      stdin.write('\x03');
      expect(lastFrame()).toContain(
        'Stop the team and quit? Press Ctrl+C again.'
      );
      expect(onRequestQuit).not.toHaveBeenCalled();

      // Second Ctrl+C
      stdin.write('\x03');
      expect(onRequestQuit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Responsive sizing', () => {
    const runningSnapshot: TelemetrySnapshot = {
      ...sampleSnapshot,
      activeSubagent: 'implementer',
      tasks: [
        {
          id: '1',
          title: 'Route middleware',
          status: 'in_progress',
        },
      ],
    };

    it('at 120x36 TeamRail is rendered side-by-side', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
          dimensions={{ columns: 120, rows: 36 }}
        />
      );

      const frame = lastFrame() ?? '';
      expect(frame).toContain('Team');
      expect(frame).toContain('Tasks');
      expect(frame).toContain('Route middleware');
    });

    it('at 80x24 TeamRail is hidden in CHAT mode and opens as overlay on Tab', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
          dimensions={{ columns: 80, rows: 24 }}
        />
      );

      // In CHAT mode at 80x24, Tasks list rail is hidden
      expect(lastFrame()).not.toContain('Tasks\n');

      // Tab enters TEAM mode and opens rail overlay
      stdin.write('\t');
      expect(lastFrame()).toContain('Team');

      // Enter enters ZOOM mode and rail closes so Zoom gets full width
      stdin.write('\r');
      expect(lastFrame()).toMatch(/Team \/ (implementer|orchestrator)/);
    });

    it('below 80x24 renders minimum window size guard', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
          dimensions={{ columns: 70, rows: 20 }}
        />
      );

      expect(lastFrame()).toContain(
        'Make this window at least 80 columns by 24 rows.'
      );
    });

    it('disposes internalStore on unmount to prevent interval leak', async () => {
      const disposeSpy = vi.spyOn(TranscriptStore.prototype, 'dispose');
      const { unmount } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
        />
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(disposeSpy).not.toHaveBeenCalled();
      unmount();
      await new Promise((r) => setTimeout(r, 20));
      expect(disposeSpy).toHaveBeenCalled();
      disposeSpy.mockRestore();
    });

    it('registers callbacks via setCallbacks on effectiveStore and cleans up on unmount', async () => {
      const mockStore = createMockTranscriptStore(vi.fn(), vi.fn());
      let restoreFn: (() => void) | undefined;
      const origSetCallbacks = mockStore.setCallbacks.bind(mockStore);
      const setCallbacksSpy = vi.spyOn(mockStore, 'setCallbacks').mockImplementation((cbs) => {
        const cleanup = origSetCallbacks(cbs);
        restoreFn = vi.fn(cleanup);
        return restoreFn;
      });

      const { unmount } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={mockStore}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
        />
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(setCallbacksSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          onOpenOverlay: expect.any(Function),
          onEnterTakeover: expect.any(Function),
          onRequestQuit: expect.any(Function),
        })
      );

      unmount();
      await new Promise((r) => setTimeout(r, 20));
      expect(restoreFn).toHaveBeenCalled();
      mockStore.dispose();
    });
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

    expect(tui.virtualTerminal.getCols()).toBeGreaterThanOrEqual(20);
    expect(tui.virtualTerminal.getRows()).toBeGreaterThanOrEqual(10);

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

    await new Promise((r) => setTimeout(r, 50));
    expect(notifySpy).toHaveBeenCalled();
    expect(tui.virtualTerminal.getViewportLines().join(' ')).toContain(
      'test output from pty'
    );

    tui.unmount();
    await tui.waitUntilExit();
  });
});
