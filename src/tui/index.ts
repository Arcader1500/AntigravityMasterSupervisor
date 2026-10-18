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
import { App, type AppProps } from './App.js';

export { App, type AppProps } from './App.js';
export {
  HeaderBar,
  type HeaderBarProps,
  formatDuration,
} from './components/HeaderBar.js';
export { FooterBar, type FooterBarProps } from './components/FooterBar.js';
export {
  MainStatusView,
  type MainStatusViewProps,
} from './components/MainStatusView.js';
export {
  LivePtyView,
  type LivePtyViewProps,
} from './components/LivePtyView.js';
export {
  SpecPlanView,
  type SpecPlanViewProps,
} from './components/SpecPlanView.js';
export {
  AuditLogView,
  type AuditLogViewProps,
} from './components/AuditLogView.js';
export type { TuiPanelId, InputMode } from '../telemetry/types.js';

export interface MountSupervisorTuiOptions {
  projectDir: string;
  ptyRunner: PtyRunner;
  mainAgent?: string;
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
}

export interface SupervisorTuiInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  store: TelemetryStore;
  virtualTerminal: VirtualTerminal;
}

interface SupervisorTuiContainerProps {
  store: TelemetryStore;
  projectDir: string;
  onWritePty: (data: string) => void;
  onRequestQuit: () => void;
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
  forceNavSignal: number;
}

const SupervisorTuiContainer: React.FC<SupervisorTuiContainerProps> = ({
  store,
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
      setLedger(loadLedger(projectDir));
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [store, projectDir]);

  useEffect(() => {
    setLedger(loadLedger(projectDir));
  }, [forceNavSignal, projectDir]);

  return React.createElement(App, {
    snapshot,
    ledger,
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

    exitPromiseResolve();
  };

  const onWritePty = (data: string) => {
    parser.clearWaitingForInput();
    store.notify();
    options.ptyRunner.write(data);
  };

  const rerenderContainer = () => {
    inkInstance.rerender(
      React.createElement(SupervisorTuiContainer, {
        store,
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

  const inkInstance = render(
    React.createElement(SupervisorTuiContainer, {
      store,
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
  };
}
