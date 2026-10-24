import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { VirtualTerminal } from '../pty/virtual-terminal.js';
import { PtyRunner } from '../pty/runner.js';
import { TelemetryParser } from '../telemetry/parser.js';
import { TelemetryStore } from '../telemetry/store.js';
import { loadLedger, updateLedger } from '../core/ledger.js';
import type {
  TelemetrySnapshot,
  TuiPanelId,
  InputMode,
} from '../telemetry/types.js';
import type { ProcessOutcome, ProcessRunContext, SupervisorLedger } from '../core/types.js';
import { createProcessRunContext, recordProcessOutcome } from '../core/process-outcome.js';
import {
  App,
  type AppProps,
  type TuiInteractionMode,
  type TuiOverlayId,
} from './App.js';
import { TranscriptStore } from './transcript-store.js';

export {
  App,
  type AppProps,
  type TuiInteractionMode,
  type TuiOverlayId,
} from './App.js';
export {
  HeaderBar,
  type HeaderBarProps,
  formatDuration,
  formatCompactTimer,
} from './components/HeaderBar.js';
export { FooterBar, type FooterBarProps } from './components/FooterBar.js';
export {
  Transcript,
  type TranscriptProps,
  CompletionCard,
  type CompletionCardProps,
} from './components/Transcript.js';
export {
  TeamRail,
  type TeamRailProps,
  type TeamMemberRow,
  deriveTeamMembers,
  formatElapsed,
} from './components/TeamRail.js';
export {
  ZoomView,
  type ZoomViewProps,
  formatAgentStep,
  toCapitalizedWord,
} from './components/ZoomView.js';
export {
  TakeoverView,
  type TakeoverViewProps,
} from './components/TakeoverView.js';
export {
  Composer,
  type ComposerProps,
  getComposerPlaceholder,
  wrapComposerLines,
} from './components/Composer.js';
export {
  CommandPalette,
  type CommandPaletteProps,
  type SlashCommandItem,
  SLASH_COMMANDS,
  filterSlashCommands,
} from './components/CommandPalette.js';
export {
  DelegationCard,
  type DelegationCardProps,
} from './components/DelegationCard.js';
export {
  DecisionCard,
  type DecisionCardProps,
} from './components/DecisionCard.js';
export {
  FailureCard,
  type FailureCardProps,
} from './components/FailureCard.js';
export {
  SpecPlanView,
  type SpecPlanViewProps,
} from './components/SpecPlanView.js';
export {
  AuditLogView,
  type AuditLogViewProps,
} from './components/AuditLogView.js';
export {
  TranscriptStore,
  type TranscriptStoreOptions,
  type TranscriptStoreSnapshot,
  type TranscriptStoreCallbacks,
} from './transcript-store.js';
export {
  reduceNarrator,
  createInitialNarratorState,
  type NarratorState,
  type NarratorInputEvent,
  type TranscriptItem,
} from './narrator.js';
export { resolveTheme, type ThemeConfig, type ThemeToken } from './theme.js';
export { resolveGlyphs, type GlyphSet } from './glyphs.js';
export type { TuiPanelId, InputMode } from '../telemetry/types.js';

export interface MountSupervisorTuiOptions {
  projectDir: string;
  ptyRunner: PtyRunner;
  mainAgent?: string;
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
  sessionStartedAt?: number;
  processRun?: ProcessRunContext;
  processOutcomeOwner?: 'caller' | 'mount';
}

export interface SupervisorTuiInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  store: TelemetryStore;
  virtualTerminal: VirtualTerminal;
  transcriptStore?: TranscriptStore;
  handleProcessOutcome?: (outcome: ProcessOutcome) => void;
}

interface SupervisorTuiContainerProps {
  store: TelemetryStore;
  transcriptStore: TranscriptStore;
  projectDir: string;
  onWritePty: (data: string) => void;
  onRequestQuit: () => void;
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
  forceNavSignal: number;
}

const SupervisorTuiContainer: React.FC<SupervisorTuiContainerProps> = ({
  store,
  transcriptStore,
  projectDir,
  onWritePty,
  onRequestQuit,
  initialPanel,
  initialInputMode,
  forceNavSignal,
}) => {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(() =>
    store.getSnapshot()
  );
  const [ledger, setLedger] = useState<SupervisorLedger>(() =>
    loadLedger(projectDir)
  );

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setSnapshot(store.getSnapshot());
    });

    const timer = setInterval(() => {
      setSnapshot(store.getSnapshot());
      const nextLedger = loadLedger(projectDir);
      setLedger(nextLedger);
      transcriptStore.updateLedger(nextLedger);
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [store, projectDir, transcriptStore]);

  useEffect(() => {
    const nextLedger = loadLedger(projectDir);
    setLedger(nextLedger);
    transcriptStore.updateLedger(nextLedger);
  }, [forceNavSignal, projectDir, transcriptStore]);

  return React.createElement(App, {
    snapshot,
    ledger,
    transcriptStore,
    onWritePty,
    onRequestQuit,
    initialPanel,
    initialInputMode,
    forceNavigationSignal: forceNavSignal,
  });
};

export function mountSupervisorTui(
  options: MountSupervisorTuiOptions
): SupervisorTuiInstance {
  const originalRawMode = typeof process.stdin.isRaw === 'boolean' ? process.stdin.isRaw : false;
  const originalInputPaused = typeof process.stdin.isPaused === 'function'
    ? process.stdin.isPaused()
    : process.stdin.readableFlowing === false;
  const initialLedger = loadLedger(options.projectDir);
  const processRun = options.processRun ?? createProcessRunContext(initialLedger.sessionId);
  const ownsOutcomePersistence = options.processOutcomeOwner === 'mount' ||
    (options.processOutcomeOwner === undefined && options.processRun === undefined);
  if (ownsOutcomePersistence && !processRun.outcome) {
    updateLedger(options.projectDir, (ledger) => {
      ledger.events.push({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Supervisor TUI process started',
        metadata: { kind: 'PROCESS_STARTED', runId: processRun.runId, sessionId: processRun.sessionId },
      });
    });
  }

  let virtualTerminal: VirtualTerminal | undefined;
  let store: TelemetryStore | undefined;
  let transcriptStore: TranscriptStore | undefined;
  let inkInstance: ReturnType<typeof render> | undefined;
  let removeDataListener: (() => void) | undefined;
  let removeExitListener: (() => void) | undefined;
  let resizeListenerAttached = false;
  let handleResize: (() => void) | undefined;
  let screenModeAttempted = false;
  let disposed = false;
  let isCleanedUp = false;
  let terminalOutcome = processRun.outcome;
  let currentForceNavSignal = 0;
  let cleanupRef: (() => void) | undefined;

  let exitPromiseResolve!: () => void;
  const exitPromise = new Promise<void>((resolve) => { exitPromiseResolve = resolve; });
  const attempt = (action: () => void) => {
    try { action(); } catch { /* Continue restoring later resources. */ }
  };

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    disposed = true;
    if (transcriptStore) attempt(() => transcriptStore!.dispose());
    if (store) attempt(() => store!.stop());
    if (removeDataListener) {
      const unsubscribe = removeDataListener;
      removeDataListener = undefined;
      attempt(unsubscribe);
    }
    if (resizeListenerAttached) {
      resizeListenerAttached = false;
      if (handleResize) attempt(() => process.stdout.removeListener('resize', handleResize!));
    }
    if (virtualTerminal) attempt(() => virtualTerminal!.dispose());
    let wasRunning = false;
    try { wasRunning = options.ptyRunner.isProcessRunning(); } catch { /* Keep cleanup moving. */ }
    if (wasRunning) attempt(() => options.ptyRunner.kill());
    if (inkInstance) {
      const instance = inkInstance;
      inkInstance = undefined;
      attempt(() => instance.unmount());
    }
    if (process.stdout.isTTY) attempt(() => process.stdout.write('\x1b[?25h'));
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      attempt(() => process.stdin.setRawMode(originalRawMode));
    }
    if (process.stdin.isTTY) {
      if (originalInputPaused && typeof process.stdin.pause === 'function') attempt(() => process.stdin.pause());
      if (!originalInputPaused && typeof process.stdin.resume === 'function') attempt(() => process.stdin.resume());
    }
    if (screenModeAttempted && process.stdout.isTTY) attempt(() => process.stdout.write('\x1b[?1049l'));
    if (!ownsOutcomePersistence || !wasRunning) {
      if (removeExitListener) {
        const unsubscribe = removeExitListener;
        removeExitListener = undefined;
        attempt(unsubscribe);
      }
    }
    exitPromiseResolve();
  };
  cleanupRef = cleanup;

  const onWritePty = (data: string) => {
    if (disposed) return;
    parser.clearWaitingForInput();
    store?.notify();
    options.ptyRunner.write(data);
  };
  const parser = new TelemetryParser({ mainAgent: options.mainAgent });
  const projectOutcome = (outcome: ProcessOutcome) => {
    if (outcome.runId !== processRun.runId || outcome.sessionId !== processRun.sessionId || terminalOutcome) return;
    terminalOutcome = outcome;
    processRun.outcome = outcome;
    store?.handleProcessOutcome(outcome);
    if (ownsOutcomePersistence) {
      try { recordProcessOutcome(options.projectDir, outcome); } catch { /* The original startup/exit result remains primary. */ }
    }
    transcriptStore?.handleProcessOutcome(outcome);
    currentForceNavSignal++;
    if (!disposed && inkInstance && store && transcriptStore) {
      try {
        inkInstance.rerender(React.createElement(SupervisorTuiContainer, {
          store, transcriptStore, projectDir: options.projectDir,
          onWritePty, onRequestQuit: cleanup, initialPanel: options.initialPanel,
          initialInputMode: options.initialInputMode, forceNavSignal: currentForceNavSignal,
        }));
      } catch { /* A teardown race must not undo persisted outcome evidence. */ }
    }
  };

  try {
    const cols = Math.max(1, process.stdout.columns || 80);
    const rows = Math.max(1, (process.stdout.rows || 30) - 6);
    virtualTerminal = new VirtualTerminal({ cols, rows });
    options.ptyRunner.resize(cols, rows);
    store = new TelemetryStore({
      projectDir: options.projectDir,
      virtualTerminal,
      parser,
      ptyRunner: options.ptyRunner,
      sessionStartedAt: options.sessionStartedAt,
      processRun,
    });
    transcriptStore = new TranscriptStore({
      telemetryStore: store,
      parser,
      initialLedger,
      processRun,
      onWritePty,
      getPtyPid: () => options.ptyRunner.getPid?.(),
      onRingBell: () => { try { process.stdout.write('\x07'); } catch { /* Ignore closed output. */ } },
      onRequestQuit: () => cleanupRef?.(),
    });

    removeDataListener = options.ptyRunner.onData((chunk) => {
      if (disposed || !virtualTerminal || !store) return;
      void virtualTerminal.write(chunk).then(() => {
        if (!disposed) store?.notify();
      }).catch(() => { /* Ignore writes after terminal disposal. */ });
    });

    handleResize = () => {
      if (disposed || !virtualTerminal) return;
      const newCols = Math.max(1, process.stdout.columns || 80);
      const newRows = Math.max(1, (process.stdout.rows || 30) - 6);
      virtualTerminal.resize(newCols, newRows);
      options.ptyRunner.resize(newCols, newRows);
    };
    process.stdout.on('resize', handleResize);
    resizeListenerAttached = true;
    store.startPolling(2000);

    removeExitListener = options.ptyRunner.onExit((code, signal) => {
      projectOutcome({
        runId: processRun.runId,
        sessionId: processRun.sessionId,
        observedAt: new Date().toISOString(),
        kind: 'exit',
        exitCode: code,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (ownsOutcomePersistence && isCleanedUp && removeExitListener) {
        const unsubscribe = removeExitListener;
        removeExitListener = undefined;
        attempt(unsubscribe);
      }
    });

    if (process.stdout.isTTY) {
      screenModeAttempted = true;
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
    }

    inkInstance = render(React.createElement(SupervisorTuiContainer, {
      store, transcriptStore, projectDir: options.projectDir, onWritePty,
      onRequestQuit: cleanup, initialPanel: options.initialPanel,
      initialInputMode: options.initialInputMode, forceNavSignal: currentForceNavSignal,
    }), { exitOnCtrlC: false });
    inkInstance.waitUntilExit().then(() => cleanup()).catch(() => cleanup());

    return {
      unmount: cleanup,
      waitUntilExit: () => exitPromise,
      store,
      virtualTerminal,
      transcriptStore,
      handleProcessOutcome: projectOutcome,
    };
  } catch (error) {
    if (ownsOutcomePersistence && !terminalOutcome) {
      projectOutcome({
        runId: processRun.runId,
        sessionId: processRun.sessionId,
        observedAt: new Date().toISOString(),
        kind: 'startup_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    cleanup();
    throw error;
  }
}
