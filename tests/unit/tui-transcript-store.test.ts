import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryParser } from '../../src/telemetry/parser.js';
import { TelemetryStore } from '../../src/telemetry/store.js';
import { initLedger } from '../../src/core/ledger.js';
import type { SupervisorLedger } from '../../src/core/types.js';
import {
  TranscriptStore,
  type TranscriptStoreOptions,
  type TranscriptStoreSnapshot,
} from '../../src/tui/transcript-store.js';
import { FIRST_LAUNCH_NOTE, CONTEXT_RESET_NOTE, HELP_TEXT_NOTE } from '../../src/tui/narrator-copy.js';

describe('TranscriptStore', () => {
  let tmpDir: string;
  let vt: VirtualTerminal;
  let parser: TelemetryParser;
  let telemetryStore: TelemetryStore;
  let ledger: SupervisorLedger;
  let ptyWrites: string[];
  let bellRingCount: number;
  let enteredTakeoverCount: number;
  let requestedQuitCount: number;
  let openedOverlays: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-store-test-'));
    ledger = initLedger(tmpDir);
    vt = new VirtualTerminal({ cols: 80, rows: 24 });
    parser = new TelemetryParser({ mainAgent: 'orchestrator' });
    telemetryStore = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    ptyWrites = [];
    bellRingCount = 0;
    enteredTakeoverCount = 0;
    requestedQuitCount = 0;
    openedOverlays = [];
  });

  afterEach(() => {
    telemetryStore.stop();
    vt.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createStore(overrides?: Partial<TranscriptStoreOptions>): TranscriptStore {
    return new TranscriptStore({
      telemetryStore,
      parser,
      initialLedger: ledger,
      onWritePty: (data: string) => ptyWrites.push(data),
      onRingBell: () => {
        bellRingCount++;
      },
      onEnterTakeover: () => {
        enteredTakeoverCount++;
      },
      onRequestQuit: () => {
        requestedQuitCount++;
      },
      onOpenOverlay: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => {
        openedOverlays.push(overlay);
      },
      ...overrides,
    });
  }

  describe('telemetry subscription and startup noise suppression', () => {
    it('subscribing to TelemetryStore and TelemetryParser feeds events into NarratorState', () => {
      const store = createStore();
      const initialSnapshot = store.getSnapshot();

      expect(initialSnapshot.hasStarted).toBe(false);
      expect(initialSnapshot.items).toHaveLength(1);
      expect(initialSnapshot.items[0].kind).toBe('SupervisorNote');
      expect((initialSnapshot.items[0] as any).text).toBe(FIRST_LAUNCH_NOTE);

      // Feed a subagent dispatch through the parser
      parser.processLine('Invoking subagent implementer for task 1');

      const updatedSnapshot = store.getSnapshot();
      expect(updatedSnapshot.hasStarted).toBe(true);
      const card = updatedSnapshot.items.find((i) => i.kind === 'DelegationCard');
      expect(card).toBeDefined();
      expect((card as any)?.role).toBe('implementer');
      store.dispose();
    });

    it('PTY startup noise lines before user submission do not create transcript items, whereas submitUserMessage writes to PTY and appends UserMessage', () => {
      const store = createStore();

      // PTY noise lines committed before submission
      parser.processLine('antigravity supervisor v1.0.0 initializing...');
      parser.processLine('connecting to telemetry daemon at /tmp/socket...');
      parser.processLine('$ shell prompt ready');

      // Transcript items should remain untouched (only initial note)
      expect(store.getSnapshot().items).toHaveLength(1);
      expect(store.getSnapshot().hasStarted).toBe(false);
      expect(ptyWrites).toHaveLength(0);

      // Submit user message
      store.submitUserMessage('Build rate limiter');

      expect(ptyWrites).toEqual(['Build rate limiter\r']);
      const snapshot = store.getSnapshot();
      expect(snapshot.hasStarted).toBe(true);
      expect(snapshot.items).toHaveLength(2);
      expect(snapshot.items[1].kind).toBe('UserMessage');
      expect((snapshot.items[1] as any).text).toBe('Build rate limiter');
      store.dispose();
    });
  });

  describe('ledger status transitions and PTY exit', () => {
    it('calling updateLedger dispatches LEDGER_STATUS_CHANGED, emitting context-reset and completion cards', () => {
      const store = createStore();

      // PLANNING -> EXECUTING
      store.updateLedger({
        ...ledger,
        status: 'PLANNING',
      });
      store.updateLedger({
        ...ledger,
        status: 'EXECUTING',
      });

      const snapshotAfterExec = store.getSnapshot();
      const phaseExecuting = snapshotAfterExec.items.find(
        (i) => i.kind === 'PhaseChange' && (i as any).phase === 'EXECUTING'
      );
      expect(phaseExecuting).toBeDefined();

      const contextResetNote = snapshotAfterExec.items.find(
        (i) => i.kind === 'SupervisorNote' && (i as any).text === CONTEXT_RESET_NOTE
      );
      expect(contextResetNote).toBeDefined();

      // EXECUTING -> COMPLETED
      store.updateLedger({
        ...ledger,
        status: 'COMPLETED',
      });

      const snapshotAfterCompleted = store.getSnapshot();
      const completionCard = snapshotAfterCompleted.items.find((i) => i.kind === 'CompletionCard');
      expect(completionCard).toBeDefined();
      store.dispose();
    });

    it('calling updateLedger with CHECKPOINT_SPEC creates a spec review DecisionCard', () => {
      const store = createStore();
      store.updateLedger({
        ...ledger,
        status: 'CHECKPOINT_SPEC',
        checkpoints: {
          spec: { status: 'PENDING', path: 'docs/superpowers/specs/spec.md' },
          plan: { status: 'UNINITIALIZED' },
        },
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.pendingDecisionCount).toBe(1);
      const decision = snapshot.focusedDecision;
      expect(decision).toBeDefined();
      expect(decision?.kind).toBe('DecisionCard');
      if (decision?.kind === 'DecisionCard') {
        expect(decision.promptKind).toBe('checkpoint_spec');
        expect(decision.options).toHaveLength(3);
      }
      store.dispose();
    });

    it('calling handlePtyExit(1) dispatches PTY_EXITED producing a FailureCard with pty_exit', () => {
      const store = createStore();

      store.handlePtyExit(1);

      const snapshot = store.getSnapshot();
      expect(snapshot.pendingDecisionCount).toBe(1);
      const failureCard = snapshot.items.find((i) => i.kind === 'FailureCard');
      expect(failureCard).toBeDefined();
      if (failureCard && failureCard.kind === 'FailureCard') {
        expect(failureCard.failureKind).toBe('pty_exit');
        expect(failureCard.options).toHaveLength(3);
      }
      store.dispose();
    });

    it('calling handlePtyExit(0) does not produce a FailureCard', () => {
      const store = createStore();
      store.handlePtyExit(0);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);
      expect(store.getSnapshot().items.find((i) => i.kind === 'FailureCard')).toBeUndefined();
      store.dispose();
    });
  });

  describe('DecisionCard and FailureCard answering & keystroke protocol', () => {
    it('answers numbered ask_question menu options with Down-arrow sequences and Enter', () => {
      const store = createStore();

      // Emit an ask_question prompt with 3 options
      parser.processLine('ask_question: What strategy?');
      parser.processLine('1. Token bucket');
      parser.processLine('2. Leaky bucket');
      parser.processLine('3. Fixed window');

      expect(store.getSnapshot().pendingDecisionCount).toBe(1);

      // Option 1 sends '\r'
      store.selectDecisionOption(1);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['\r']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);

      // Emit another question to test option 2
      ptyWrites.length = 0;
      parser.processLine('ask_question: Select cache store:');
      parser.processLine('1. Memory');
      parser.processLine('2. Redis');
      parser.processLine('3. Postgres');

      store.selectDecisionOption(2);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['\x1b[B\r']);

      // Emit another question to test option 3
      ptyWrites.length = 0;
      parser.processLine('ask_question: Key expiration policy:');
      parser.processLine('1. 60s');
      parser.processLine('2. 300s');
      parser.processLine('3. None');

      store.selectDecisionOption(3);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['\x1b[B\x1b[B\r']);
      store.dispose();
    });

    it('answers ask_question menu with free-form text selecting the write-in slot (K down-arrows + Enter + text + Enter)', () => {
      const store = createStore();

      parser.processLine('ask_question: Custom error response?');
      parser.processLine('1. 429 Retry-After');
      parser.processLine('2. 403 Forbidden');
      parser.processLine('3. 503 Unavailable');

      store.answerFocusedDecision('Custom 429 body');

      // K = 3 options -> 3 down arrows + '\r' + 'Custom 429 body\r'
      expect(ptyWrites).toEqual(['\x1b[B\x1b[B\x1b[B\rCustom 429 body\r']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);
      const answeredCard = store.getSnapshot().items.find((i) => i.kind === 'DecisionCard');
      expect((answeredCard as any)?.status).toBe('answered');
      expect((answeredCard as any)?.answeredText).toBe('Custom 429 body');
      store.dispose();
    });

    it('answers permission prompt: Option 1 sends Ctrl+K, Option 2 sends Esc', () => {
      const store = createStore();

      // Option 1 -> \x0b
      parser.processLine('Allow command npm test? (ctrl+k)');
      store.selectDecisionOption(1);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['\x0b']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);

      // Option 2 -> \x1b
      ptyWrites.length = 0;
      parser.processLine('Allow command rm -rf? (ctrl+k)');
      store.selectDecisionOption(2);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['\x1b']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);
      store.dispose();
    });

    it('answers checkpoint_spec: Option 1 approves, Option 2 opens overlay, Option 3 requests changes', () => {
      const store = createStore();

      store.updateLedger({
        ...ledger,
        status: 'CHECKPOINT_SPEC',
      });
      expect(store.getSnapshot().pendingDecisionCount).toBe(1);

      // Option 2 calls onOpenOverlay('spec') and keeps card pending
      store.selectDecisionOption(2);
      store.answerFocusedDecision();
      expect(openedOverlays).toEqual(['spec']);
      expect(ptyWrites).toHaveLength(0);
      expect(store.getSnapshot().pendingDecisionCount).toBe(1);

      // Option 1 sends 'Approve the spec.\r' and resolves card
      store.selectDecisionOption(1);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['Approve the spec.\r']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);
      store.dispose();
    });

    it('answers FailureCard: Option 1 sends retry, Option 2 sends skip, Option 3 takes over', () => {
      const store = createStore();

      // Trigger a failure card via BLOCKED subagent verdict
      parser.processLine('Invoking subagent implementer for task 2');
      parser.processLine('Status: BLOCKED');

      expect(store.getSnapshot().pendingDecisionCount).toBe(1);

      // Option 1 (retry)
      store.selectDecisionOption(1);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['Retry the blocked task and resolve the error.\r']);
      expect(store.getSnapshot().pendingDecisionCount).toBe(0);

      // Trigger another failure card for skip
      ptyWrites.length = 0;
      parser.processLine('Invoking subagent implementer for task 3');
      parser.processLine('Status: BLOCKED');
      store.selectDecisionOption(2);
      store.answerFocusedDecision();
      expect(ptyWrites).toEqual(['Skip the blocked task and continue with the remaining tasks in the current wave.\r']);

      // Trigger another failure card for takeover
      ptyWrites.length = 0;
      parser.processLine('Invoking subagent implementer for task 4');
      parser.processLine('Status: BLOCKED');
      store.selectDecisionOption(3);
      store.answerFocusedDecision();
      expect(enteredTakeoverCount).toBe(1);
      expect(ptyWrites).toHaveLength(0);
      store.dispose();
    });
  });

  describe('terminal bell deduplication', () => {
    it('fires onRingBell exactly once per unique DecisionCard ID', () => {
      const store = createStore();

      // 1st decision prompt
      parser.processLine('ask_question: First question?');
      parser.processLine('1. A');
      parser.processLine('2. B');

      expect(bellRingCount).toBe(1);

      // Re-processing streaming line for same question should not ring again
      parser.processLine('3. C');
      expect(bellRingCount).toBe(1);

      // Changing selection should not ring again
      store.selectDecisionOption(2);
      expect(bellRingCount).toBe(1);

      // Deferring and refocusing should not ring again
      store.deferFocusedDecision();
      expect(bellRingCount).toBe(1);
      store.refocusDeferredDecision();
      expect(bellRingCount).toBe(1);

      // Answering it
      store.answerFocusedDecision();
      expect(bellRingCount).toBe(1);

      // 2nd distinct decision prompt fires onRingBell a second time
      parser.processLine('ask_question: Second question?');
      parser.processLine('1. X');
      parser.processLine('2. Y');

      expect(bellRingCount).toBe(2);
      store.dispose();
    });
  });

  describe('soft-pause controller and queueing', () => {
    it('queues submitUserMessage and answerFocusedDecision writes when paused, flushing FIFO on resume', () => {
      const store = createStore();

      expect(store.getSnapshot().isPaused).toBe(false);

      store.pause();
      expect(store.getSnapshot().isPaused).toBe(true);

      // User message submitted while paused
      store.submitUserMessage('First paused message');
      expect(ptyWrites).toHaveLength(0);

      // Decision card answered while paused
      parser.processLine('ask_question: Choose one:');
      parser.processLine('1. Yes');
      parser.processLine('2. No');
      store.selectDecisionOption(1);
      store.answerFocusedDecision();
      expect(ptyWrites).toHaveLength(0);

      // Resume flushes in FIFO order
      store.resume();
      expect(store.getSnapshot().isPaused).toBe(false);
      expect(ptyWrites).toEqual(['First paused message\r', '\r']);
      store.dispose();
    });

    it('sends SIGSTOP/SIGCONT signals on POSIX when getPtyPid is provided, and ignores on win32', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

      // POSIX platform
      const posixStore = createStore({
        platform: 'linux',
        getPtyPid: () => 4321,
      });

      posixStore.pause();
      expect(killSpy).toHaveBeenCalledWith(4321, 'SIGSTOP');

      posixStore.resume();
      expect(killSpy).toHaveBeenCalledWith(4321, 'SIGCONT');
      posixStore.dispose();

      killSpy.mockClear();

      // Windows platform
      const winStore = createStore({
        platform: 'win32',
        getPtyPid: () => 4321,
      });

      winStore.pause();
      winStore.resume();
      expect(killSpy).not.toHaveBeenCalled();
      winStore.dispose();
    });
  });

  describe('slash commands', () => {
    it('executes /spec, /plan, /audit, /raw, /pause, /resume, /decide, /help, and /quit', () => {
      const store = createStore();

      store.runSlashCommand('/spec');
      expect(openedOverlays).toEqual(['spec']);

      store.runSlashCommand('/plan');
      expect(openedOverlays).toEqual(['spec', 'plan']);

      store.runSlashCommand('/audit');
      expect(openedOverlays).toEqual(['spec', 'plan', 'audit']);

      store.runSlashCommand('/raw');
      expect(enteredTakeoverCount).toBe(1);

      store.runSlashCommand('/pause');
      expect(store.getSnapshot().isPaused).toBe(true);

      store.runSlashCommand('/resume');
      expect(store.getSnapshot().isPaused).toBe(false);

      store.runSlashCommand('/help');
      const note = store.getSnapshot().items.find(
        (i) => i.kind === 'SupervisorNote' && (i as any).text === HELP_TEXT_NOTE
      );
      expect(note).toBeDefined();

      store.runSlashCommand('/quit');
      expect(requestedQuitCount).toBe(1);

      store.dispose();
    });
  });
});
