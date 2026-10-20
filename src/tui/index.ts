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
import type { SupervisorLedger } from '../core/types.js';
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
}

export interface SupervisorTuiInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  store: TelemetryStore;
  virtualTerminal: VirtualTerminal;
  transcriptStore?: TranscriptStore;
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
  const cols = process.stdout.columns || 80;
  const rows = Math.max(10, (process.stdout.rows || 30) - 6);

  const virtualTerminal = new VirtualTerminal({ cols, rows });
  const parser = new TelemetryParser({ mainAgent: options.mainAgent });
  const store = new TelemetryStore({
    projectDir: options.projectDir,
    virtualTerminal,
    parser,
    ptyRunner: options.ptyRunner,
    sessionStartedAt: options.sessionStartedAt,
  });

  const onWritePty = (data: string) => {
    parser.clearWaitingForInput();
    store.notify();
    options.ptyRunner.write(data);
  };

  const initialLedger = loadLedger(options.projectDir);
  let cleanupRef: (() => void) | null = null;

  const transcriptStore = new TranscriptStore({
    telemetryStore: store,
    parser,
    initialLedger,
    onWritePty,
    getPtyPid: () => options.ptyRunner.getPid?.(),
    onRingBell: () => {
      try {
        process.stdout.write('\x07');
      } catch {
        // ignore
      }
    },
    onRequestQuit: () => {
      cleanupRef?.();
    },
  });

  options.ptyRunner.onData((chunk) => {
    void virtualTerminal.write(chunk).then(() => {
      store.notify();
    });
  });

  const handleResize = () => {
    const newCols = process.stdout.columns || 80;
    const newRows = Math.max(10, (process.stdout.rows || 30) - 6);
    virtualTerminal.resize(newCols, newRows);
    options.ptyRunner.resize(newCols, newRows);
  };

  if (typeof process.stdout.on === 'function') {
    process.stdout.on('resize', handleResize);
  }

  store.startPolling(2000);

  let currentForceNavSignal = 0;
  let isCleanedUp = false;

  let exitPromiseResolve!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    exitPromiseResolve = resolve;
  });

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    transcriptStore.dispose();
    store.stop();

    if (typeof process.stdout.off === 'function') {
      process.stdout.off('resize', handleResize);
    } else if (typeof process.stdout.removeListener === 'function') {
      process.stdout.removeListener('resize', handleResize);
    }

    virtualTerminal.dispose();

    if (options.ptyRunner.isProcessRunning()) {
      try {
        options.ptyRunner.kill();
      } catch {
        // ignore
      }
    }

    try {
      inkInstance.unmount();
    } catch {
      // ignore
    }

    if (process.stdout.isTTY) {
      // Exit alt-screen
      process.stdout.write('\x1b[?1049l');
    }

    exitPromiseResolve();
  };
  cleanupRef = cleanup;

  const rerenderContainer = () => {
    inkInstance.rerender(
      React.createElement(SupervisorTuiContainer, {
        store,
        transcriptStore,
        projectDir: options.projectDir,
        onWritePty,
        onRequestQuit: cleanup,
        initialPanel: options.initialPanel,
        initialInputMode: options.initialInputMode,
        forceNavSignal: currentForceNavSignal,
      })
    );
  };

  options.ptyRunner.onExit((code) => {
    currentForceNavSignal++;
    if (code !== 0) {
      transcriptStore.handlePtyExit(code);
    }
    try {
      updateLedger(options.projectDir, (l) => {
        l.status = code === 0 ? 'COMPLETED' : 'FAILED';
      });
    } catch {
      // ignore
    }
    store.notify();
    rerenderContainer();
  });

  if (process.stdout.isTTY) {
    // Enter alt-screen
    process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
  }

  const inkInstance = render(
    React.createElement(SupervisorTuiContainer, {
      store,
      transcriptStore,
      projectDir: options.projectDir,
      onWritePty,
      onRequestQuit: cleanup,
      initialPanel: options.initialPanel,
      initialInputMode: options.initialInputMode,
      forceNavSignal: currentForceNavSignal,
    }),
    { exitOnCtrlC: false }
  );

  inkInstance.waitUntilExit().then(() => cleanup()).catch(() => cleanup());

  return {
    unmount: cleanup,
    waitUntilExit: () => exitPromise,
    store,
    virtualTerminal,
    transcriptStore,
  };
}
