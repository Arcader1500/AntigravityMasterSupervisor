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
      expect(lastFrame()).toContain('Input sent: Leaky bucket.');
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
      expect(lastFrame()).toContain('Input sent: Token bucket.');
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

  describe('Root viewport framing and input edge cases', () => {
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

    function decisionStore(
      onWritePty: (data: string) => void,
      onRequestQuit: () => void
    ) {
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
      return store;
    }

    it('renders a full-width horizontal rule in the empty CHAT state', () => {
      const { lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      expect(lastFrame() ?? '').toMatch(/─{10,}/);
    });

    it('renders tee joints and a vertical split divider when the rail is side-by-side', () => {
      const { lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/─+┬─+/);
      expect(frame).toMatch(/─+┴─+/);
      expect(
        frame.split('\n').some((line) => line.trim() === '│')
      ).toBe(true);
    });

    it('uses ASCII glyphs for the frame when AGYSUP_ASCII is set', () => {
      const { lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
          env={{ AGYSUP_ASCII: '1' } as NodeJS.ProcessEnv}
        />
      );

      expect(lastFrame() ?? '').toMatch(/-{10,}/);
    });

    it('collapses a Windows CRLF pair into one chat submission', () => {
      const onWritePty = vi.fn();
      const { stdin } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      stdin.write('hello\r\n');

      expect(onWritePty).toHaveBeenCalledTimes(1);
      expect(onWritePty).toHaveBeenCalledWith('hello\r');
    });

    it('does not answer a focused decision from the trailing \\n of a CRLF pair', () => {
      const onWritePty = vi.fn();
      const store = decisionStore(onWritePty, vi.fn());
      const { stdin, lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={store}
          onWritePty={onWritePty}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      expect(lastFrame()).toContain('1 needs you');

      // Enter TEAM (rail focused), then send a single CRLF chunk.
      stdin.write('\t');
      stdin.write('\r\n');

      expect(onWritePty).not.toHaveBeenCalled();
      expect(lastFrame()).toContain('1 needs you');
    });

    it('routes takeover transition and re-entry suffix bytes to the PTY exactly once', () => {
      const onWritePty = vi.fn();
      const { stdin } = render(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} onWritePty={onWritePty}
          onRequestQuit={vi.fn()} dimensions={{ columns: 100, rows: 32 }} />
      );

      stdin.write('\x14abc\x0b');
      expect(onWritePty).toHaveBeenNthCalledWith(1, 'abc\x0b');
      stdin.write('\x1d');
      stdin.write('/raw\rdef\x0b');
      expect(onWritePty).toHaveBeenNthCalledWith(2, 'def\x0b');
      stdin.write('\x1d');
      stdin.write('\x14ghi');
      expect(onWritePty).toHaveBeenNthCalledWith(3, 'ghi');
      expect(onWritePty).toHaveBeenCalledTimes(3);
    });

    it('keeps split CRLF ownership when the first submit changes focused card', () => {
      const onWritePty = vi.fn();
      const store = decisionStore(onWritePty, vi.fn());
      store.dispatch({
        type: 'TELEMETRY_EVENT',
        event: {
          type: 'DECISION_PROMPT', promptKind: 'ask_question',
          headline: 'Second decision', question: 'Second question?',
          options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }],
          timestamp: new Date().toISOString(),
        },
        elapsedFormatted: '0s',
      });
      const { stdin, lastFrame } = render(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} transcriptStore={store}
          onWritePty={onWritePty} onRequestQuit={vi.fn()} dimensions={{ columns: 100, rows: 32 }} />
      );

      stdin.write('\r');
      const afterFirstEnter = onWritePty.mock.calls.length;
      stdin.write('\n');
      expect(onWritePty).toHaveBeenCalledTimes(afterFirstEnter);
      expect(lastFrame()).toContain('Second decision');
      expect(lastFrame()).toContain('1 needs you');
    });

    it('keeps the visible logical marker on its row after append and width reflow', async () => {
      const store = createMockTranscriptStore(vi.fn(), vi.fn());
      const longTail = 'x'.repeat(56);
      for (let index = 0; index < 45; index++) {
        const id = `marker-${String(index).padStart(2, '0')}`;
        store.submitUserMessage(`${id} ${longTail}`);
      }
      const { stdin, lastFrame, rerender } = render(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} transcriptStore={store}
          onWritePty={vi.fn()} onRequestQuit={vi.fn()} dimensions={{ columns: 100, rows: 32 }} />
      );
      stdin.write('\x1b[5~');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const markerRow = () => {
        const lines = (lastFrame() ?? '').split('\n');
        const line = lines.find((entry) => /marker-\d{2}/.test(entry));
        const rule = lines.findIndex((entry) => /^─+$/.test(entry));
        return line ? { marker: line.match(/marker-\d{2}/)?.[0], row: lines.indexOf(line) - rule - 1 } : undefined;
      };
      const before = markerRow();
      expect(before).toBeDefined();

      store.submitUserMessage(`new-append ${longTail}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(markerRow()).toEqual(before);

      rerender(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} transcriptStore={store}
          onWritePty={vi.fn()} onRequestQuit={vi.fn()} dimensions={{ columns: 60, rows: 18 }} />
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(markerRow()).toEqual(before);
    });

    it('ignores digit selections beyond the decision option count and shows the real count', async () => {
      const onWritePty = vi.fn();
      const store = decisionStore(onWritePty, vi.fn());
      const { stdin, lastFrame } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          transcriptStore={store}
          onWritePty={onWritePty}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      const frame = lastFrame() ?? '';
      expect(frame).toContain('1 2 choose');
      expect(frame).not.toContain('1 2 3 choose');

      stdin.write('5');
      stdin.write('\r');

      expect(onWritePty).toHaveBeenCalledWith('\r');
      await new Promise((r) => setTimeout(r, 50));
      expect(lastFrame()).toContain('Input sent: Token bucket.');
      expect(lastFrame()).not.toContain('Option 5');
    });

    it('navigates the command palette with arrows and Tab autocompletes without entering TEAM', () => {
      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      stdin.write('/');
      const openFrame = lastFrame() ?? '';
      expect(openFrame).toContain('/spec');
      expect(openFrame).toContain('/plan');

      stdin.write('\x1b[B');
      stdin.write('\t');

      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/›\s+\/plan/);
      expect(frame).not.toContain('↑ ↓ select');
    });

    it('shows the takeover return instruction once, from the footer only', () => {
      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      stdin.write('\x14');
      const frame = lastFrame() ?? '';
      const instruction =
        "You are typing into the agent's terminal. Press Ctrl+] to return.";
      expect(frame.split(instruction).length - 1).toBe(1);
    });

    it('executes the highlighted palette command on Enter', () => {
      const { stdin, lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
          dimensions={{ columns: 120, rows: 24 }}
        />
      );

      stdin.write('/');
      stdin.write('\x1b[B');
      stdin.write('\r');

      expect(lastFrame()).toContain('test-plan.md');
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

    it('keeps a 30x8 layout bounded and recovers interaction after grow', () => {
      const onWritePty = vi.fn();
      const onRequestQuit = vi.fn();

      const { lastFrame } = render(
        <App
          snapshot={runningSnapshot}
          ledger={sampleLedger}
          onWritePty={onWritePty}
          onRequestQuit={onRequestQuit}
          dimensions={{ columns: 30, rows: 8 }}
        />
      );

      expect(lastFrame()).not.toContain('Make this window at least');
      expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(8);
      expect(lastFrame()).toContain('Message the supervisor');
    });

    it('keeps spec, audit, and narrow team rows consecutive at 60x18', () => {
      const specSnapshot = {
        ...sampleSnapshot,
        specContent: Array.from({ length: 24 }, (_, index) => `visible-spec-${index + 1}`).join('\n'),
      };
      const { stdin: specStdin, lastFrame: specFrame } = render(
        <App snapshot={specSnapshot} ledger={sampleLedger} onWritePty={vi.fn()}
          onRequestQuit={vi.fn()} dimensions={{ columns: 60, rows: 18 }} />
      );
      specStdin.write('/spec\r');
      const docNumbers = (specFrame() ?? '').split('\n')
        .map((line) => Number(line.match(/(?:^|│)\s*(\d+) │ visible-spec-/)?.[1]))
        .filter(Number.isFinite);
      expect(docNumbers.length).toBeGreaterThan(0);
      expect(docNumbers.slice(1).every((number, index) => number === docNumbers[index] + 1)).toBe(true);

      const { stdin: auditStdin, lastFrame: auditFrame } = render(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} onWritePty={vi.fn()}
          onRequestQuit={vi.fn()} dimensions={{ columns: 60, rows: 18 }} />
      );
      auditStdin.write('/audit\r');
      const auditEvents = (auditFrame() ?? '').split('\n')
        .map((line) => line.match(/(?:First event|Second event|Third event)/)?.[0])
        .filter((event): event is string => event !== undefined);
      expect(auditEvents.length).toBeGreaterThan(0);
      expect(auditEvents).toEqual(['First event', 'Second event', 'Third event'].slice(0, auditEvents.length));

      const tasks = Array.from({ length: 12 }, (_, index) => ({
        id: String(index + 1), index: index + 1, title: `narrow-task-${index + 1}`,
        status: 'pending' as const,
      }));
      const { stdin: teamStdin, lastFrame: teamFrame } = render(
        <App snapshot={{ ...sampleSnapshot, tasks }} ledger={sampleLedger}
          onWritePty={vi.fn()} onRequestQuit={vi.fn()} dimensions={{ columns: 60, rows: 18 }} />
      );
      teamStdin.write('\t');
      expect(teamFrame()).toContain('Tasks · artifacts');
      const teamRows = (teamFrame() ?? '').split('\n')
        .map((line) => Number(line.match(/narrow-task-(\d+)/)?.[1]))
        .filter(Number.isFinite);
      expect(teamRows.length).toBeGreaterThan(0);
      expect(teamRows.slice(1).every((number, index) => number === teamRows[index] + 1)).toBe(true);
    });

    it('passes Windows pause delivery feedback through to the integrated footer', () => {
      const store = createMockTranscriptStore(vi.fn(), vi.fn());
      const { stdin, lastFrame } = render(
        <App snapshot={sampleSnapshot} ledger={sampleLedger} transcriptStore={store}
          onWritePty={vi.fn()} onRequestQuit={vi.fn()} dimensions={{ columns: 100, rows: 32 }} />
      );
      stdin.write('/pause\r');
      expect(lastFrame()).toContain('Paused: Windows queues input');
    });

    it('tracks actual stdout resize events without a dimensions prop', () => {
      const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
      const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
      try {
        Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 30 });
        Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 8 });
        const { stdin, stdout, lastFrame, unmount } = render(
          <App snapshot={sampleSnapshot} ledger={sampleLedger} onWritePty={vi.fn()} onRequestQuit={vi.fn()} />
        );
        Object.defineProperty(stdout, 'columns', { configurable: true, value: 30 });
        (stdout as any).rows = 8;
        stdout.emit('resize');
        expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(8);
        Object.defineProperty(stdout, 'columns', { configurable: true, value: 100 });
        (stdout as any).rows = 32;
        stdout.emit('resize');
        stdin.write('grown');
        expect(lastFrame()).toContain('grown');
        unmount();
      } finally {
        if (columns) Object.defineProperty(process.stdout, 'columns', columns);
        else delete (process.stdout as any).columns;
        if (rows) Object.defineProperty(process.stdout, 'rows', rows);
        else delete (process.stdout as any).rows;
      }
    });

    it('disposes internalStore on unmount to prevent interval leak', async () => {
      const { unmount } = render(
        <App
          snapshot={sampleSnapshot}
          ledger={sampleLedger}
          onWritePty={vi.fn()}
          onRequestQuit={vi.fn()}
        />
      );
      const disposeSpy = vi.spyOn(TranscriptStore.prototype, 'dispose');

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
