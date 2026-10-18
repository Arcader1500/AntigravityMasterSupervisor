import React, { useState, useRef, useLayoutEffect } from 'react';
import { Box, useStdin } from 'ink';
import type {
  TelemetrySnapshot,
  InputMode,
  TuiPanelId,
} from '../telemetry/types.js';
import type { SupervisorLedger } from '../core/types.js';
import { HeaderBar } from './components/HeaderBar.js';
import { FooterBar } from './components/FooterBar.js';
import { MainStatusView } from './components/MainStatusView.js';
import { LivePtyView } from './components/LivePtyView.js';
import { SpecPlanView } from './components/SpecPlanView.js';
import { AuditLogView } from './components/AuditLogView.js';

export interface AppProps {
  snapshot: TelemetrySnapshot;
  ledger: SupervisorLedger;
  onWritePty: (data: string) => void;
  onRequestQuit: () => void;
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
  forceNavigationSignal?: number;
}

export const App: React.FC<AppProps> = ({
  snapshot,
  ledger,
  onWritePty,
  onRequestQuit,
  initialPanel = 1,
  initialInputMode = 'NAVIGATION',
  forceNavigationSignal,
}) => {
  const [activePanel, setActivePanel] = useState<TuiPanelId>(initialPanel);
  const [inputMode, setInputMode] = useState<InputMode>(initialInputMode);
  const [activeDoc, setActiveDoc] = useState<'spec' | 'plan'>('spec');
  const [scrollOffset, setScrollOffset] = useState<number>(0);

  // Synchronous refs to avoid stale closures and handle back-to-back synchronous keystrokes
  const activePanelRef = useRef<TuiPanelId>(activePanel);
  activePanelRef.current = activePanel;

  const inputModeRef = useRef<InputMode>(inputMode);
  inputModeRef.current = inputMode;

  const activeDocRef = useRef<'spec' | 'plan'>(activeDoc);
  activeDocRef.current = activeDoc;

  const scrollOffsetRef = useRef<number>(scrollOffset);
  scrollOffsetRef.current = scrollOffset;

  const onWritePtyRef = useRef(onWritePty);
  onWritePtyRef.current = onWritePty;

  const onRequestQuitRef = useRef(onRequestQuit);
  onRequestQuitRef.current = onRequestQuit;

  // Track prop transitions to force navigation mode immediately
  const [prevForceNavSignal, setPrevForceNavSignal] = useState(forceNavigationSignal);
  if (
    forceNavigationSignal !== undefined &&
    forceNavigationSignal !== prevForceNavSignal
  ) {
    setPrevForceNavSignal(forceNavigationSignal);
    inputModeRef.current = 'NAVIGATION';
    setInputMode('NAVIGATION');
  }

  const { stdin, setRawMode } = useStdin();

  useLayoutEffect(() => {
    if (setRawMode) {
      try {
        setRawMode(true);
      } catch {
        // ignore in non-TTY test environments
      }
    }
    return () => {
      if (setRawMode) {
        try {
          setRawMode(false);
        } catch {
          // ignore
        }
      }
    };
  }, [setRawMode]);

  useLayoutEffect(() => {
    const handleScrollUp = () => {
      if (activePanelRef.current === 3 || activePanelRef.current === 4) {
        const next = Math.max(0, scrollOffsetRef.current - 1);
        scrollOffsetRef.current = next;
        setScrollOffset(next);
      }
    };

    const handleScrollDown = () => {
      if (activePanelRef.current === 3 || activePanelRef.current === 4) {
        const next = scrollOffsetRef.current + 1;
        scrollOffsetRef.current = next;
        setScrollOffset(next);
      }
    };

    const handlePtyInput = (raw: string) => {
      const ctrlRightBracketIdx = raw.indexOf('\x1d');
      if (ctrlRightBracketIdx !== -1) {
        const prefix = raw.slice(0, ctrlRightBracketIdx);
        const suffix = raw.slice(ctrlRightBracketIdx + 1);

        if (prefix.length > 0) {
          onWritePtyRef.current(prefix);
        }

        inputModeRef.current = 'NAVIGATION';
        setInputMode('NAVIGATION');

        if (suffix.length > 0) {
          handleNavInput(suffix);
        }
      } else {
        onWritePtyRef.current(raw);
      }
    };

    const handleNavInput = (input: string) => {
      let i = 0;
      while (i < input.length) {
        // Handle ANSI escape sequence for arrow keys
        if (input.charCodeAt(i) === 0x1b) {
          const rest = input.slice(i);
          const arrowMatch = rest.match(/^\x1b(?:\[|O)([A-D])/);
          if (arrowMatch) {
            const code = arrowMatch[1];
            if (code === 'A') {
              handleScrollUp();
            } else if (code === 'B') {
              handleScrollDown();
            }
            i += arrowMatch[0].length;
            continue;
          } else {
            i++;
            continue;
          }
        }

        const char = input[i];
        i++;

        if (char === 'q' || char === 'Q' || char === '\x03') {
          onRequestQuitRef.current();
          return;
        }

        if (char === '1' || char === '2' || char === '3' || char === '4') {
          const targetPanel = parseInt(char, 10) as TuiPanelId;
          activePanelRef.current = targetPanel;
          setActivePanel(targetPanel);
          scrollOffsetRef.current = 0;
          setScrollOffset(0);
          continue;
        }

        if (char === 't' || char === 'T') {
          activePanelRef.current = 2;
          setActivePanel(2);
          inputModeRef.current = 'PTY_INTERACT';
          setInputMode('PTY_INTERACT');
          if (i < input.length) {
            const remaining = input.slice(i);
            handlePtyInput(remaining);
            return;
          }
          continue;
        }

        if (
          (char === 'i' || char === 'I' || char === '\r' || char === '\n') &&
          activePanelRef.current === 2
        ) {
          inputModeRef.current = 'PTY_INTERACT';
          setInputMode('PTY_INTERACT');
          if (i < input.length) {
            const remaining = input.slice(i);
            handlePtyInput(remaining);
            return;
          }
          continue;
        }

        if (activePanelRef.current === 3) {
          if (char === 's' || char === 'S') {
            activeDocRef.current = 'spec';
            setActiveDoc('spec');
            scrollOffsetRef.current = 0;
            setScrollOffset(0);
            continue;
          }
          if (char === 'p' || char === 'P') {
            activeDocRef.current = 'plan';
            setActiveDoc('plan');
            scrollOffsetRef.current = 0;
            setScrollOffset(0);
            continue;
          }
        }

        if (char === 'k' || char === 'K') {
          handleScrollUp();
          continue;
        }

        if (char === 'j' || char === 'J') {
          handleScrollDown();
          continue;
        }
      }
    };

    const handleData = (chunk: Buffer | string) => {
      const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      if (inputModeRef.current === 'PTY_INTERACT') {
        handlePtyInput(raw);
      } else {
        handleNavInput(raw);
      }
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [stdin]);

  return (
    <Box flexDirection="column">
      <HeaderBar
        branch={snapshot.branch}
        totalElapsedMs={snapshot.totalElapsedMs}
        status={ledger.status}
        inputMode={inputMode}
        waitingForInput={snapshot.waitingForInput}
      />

      {activePanel === 1 && <MainStatusView snapshot={snapshot} />}
      {activePanel === 2 && (
        <LivePtyView
          lines={snapshot.ptyViewportLines}
          inputMode={inputMode}
          mainAgent={snapshot.mainAgent}
          pid={snapshot.pid}
        />
      )}
      {activePanel === 3 && (
        <SpecPlanView
          specPath={snapshot.specPath}
          specContent={snapshot.specContent}
          planPath={snapshot.planPath}
          planContent={snapshot.planContent}
          activeDoc={activeDoc}
          scrollOffset={scrollOffset}
        />
      )}
      {activePanel === 4 && (
        <AuditLogView ledger={ledger} scrollOffset={scrollOffset} />
      )}

      <FooterBar
        activePanel={activePanel}
        inputMode={inputMode}
        activeDoc={activeDoc}
      />
    </Box>
  );
};
