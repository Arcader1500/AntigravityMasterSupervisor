import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Box, Text, useStdin, useStdout } from 'ink';
import type {
  TelemetrySnapshot,
  InputMode,
  TuiPanelId,
  TelemetryEvent,
} from '../telemetry/types.js';
import type { SupervisorLedger } from '../core/types.js';
import { resolveTheme, type ThemeConfig } from './theme.js';
import { resolveGlyphs, type GlyphSet } from './glyphs.js';
import {
  TranscriptStore,
  type TranscriptStoreSnapshot,
} from './transcript-store.js';
import { HeaderBar } from './components/HeaderBar.js';
import { FooterBar } from './components/FooterBar.js';
import { Transcript } from './components/Transcript.js';
import { TeamRail, deriveTeamMembers } from './components/TeamRail.js';
import { ZoomView } from './components/ZoomView.js';
import { TakeoverView } from './components/TakeoverView.js';
import { Composer, getComposerPlaceholder } from './components/Composer.js';
import { CommandPalette } from './components/CommandPalette.js';
import { SpecPlanView } from './components/SpecPlanView.js';
import { AuditLogView } from './components/AuditLogView.js';

export type TuiInteractionMode = 'CHAT' | 'TEAM' | 'ZOOM' | 'TAKEOVER';
export type TuiOverlayId = null | 'spec' | 'plan' | 'audit' | 'raw';

// Legacy type aliases for backward compatibility
export type { TuiPanelId, InputMode } from '../telemetry/types.js';

export interface AppProps {
  snapshot: TelemetrySnapshot;
  ledger: SupervisorLedger;
  transcriptStore?: TranscriptStore;
  onWritePty: (data: string) => void;
  onRequestQuit: () => void;
  forceNavigationSignal?: number;
  dimensions?: { columns: number; rows: number };
  env?: NodeJS.ProcessEnv;
  colorLevel?: number;
  platform?: NodeJS.Platform;

  // Legacy props
  initialPanel?: TuiPanelId;
  initialInputMode?: InputMode;
}

export const App: React.FC<AppProps> = ({
  snapshot,
  ledger,
  transcriptStore,
  onWritePty,
  onRequestQuit,
  forceNavigationSignal,
  dimensions,
  env,
  colorLevel,
  platform,
  initialInputMode,
}) => {
  const theme = resolveTheme({ env, colorLevel });
  const glyphs = resolveGlyphs({ env, platform });

  const { stdout } = useStdout();
  const [terminalDimensions, setTerminalDimensions] = useState(() => ({
    columns: dimensions?.columns ?? stdout?.columns ?? 120,
    rows: dimensions?.rows ?? stdout?.rows ?? 36,
  }));

  useEffect(() => {
    if (dimensions) {
      setTerminalDimensions(dimensions);
      return;
    }
    const onResize = () => {
      if (stdout) {
        setTerminalDimensions({
          columns: stdout.columns || 120,
          rows: stdout.rows || 36,
        });
      }
    };
    stdout?.on('resize', onResize);
    return () => {
      stdout?.off('resize', onResize);
    };
  }, [dimensions, stdout]);

  const { columns, rows } = dimensions ?? terminalDimensions;

  // Mode and view states
  const initialMode: TuiInteractionMode =
    initialInputMode === 'PTY_INTERACT' ? 'TAKEOVER' : 'CHAT';
  const [mode, setMode] = useState<TuiInteractionMode>(initialMode);
  const [activeOverlay, setActiveOverlay] = useState<TuiOverlayId>(null);
  const [overlayScrollOffset, setOverlayScrollOffset] = useState<number>(0);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState<number>(0);
  const [zoomScrollOffset, setZoomScrollOffset] = useState<number>(0);
  const [selectedMemberIndex, setSelectedMemberIndex] = useState<number>(0);
  const [composerText, setComposerText] = useState<string>('');
  const [confirmingQuit, setConfirmingQuit] = useState<boolean>(false);

  // Synchronous refs to prevent stale closure captures in input callbacks
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const activeOverlayRef = useRef(activeOverlay);
  activeOverlayRef.current = activeOverlay;

  const composerTextRef = useRef(composerText);
  composerTextRef.current = composerText;

  const confirmingQuitRef = useRef(confirmingQuit);
  confirmingQuitRef.current = confirmingQuit;

  const onWritePtyRef = useRef(onWritePty);
  onWritePtyRef.current = onWritePty;

  const onRequestQuitRef = useRef(onRequestQuit);
  onRequestQuitRef.current = onRequestQuit;

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;

  // Signal transitions: forceNavigationSignal returns to CHAT mode
  const [prevForceNavSignal, setPrevForceNavSignal] = useState(forceNavigationSignal);
  if (
    forceNavigationSignal !== undefined &&
    forceNavigationSignal !== prevForceNavSignal
  ) {
    setPrevForceNavSignal(forceNavigationSignal);
    setMode('CHAT');
    modeRef.current = 'CHAT';
  }

  // Internal TranscriptStore if not supplied in props
  const [internalStore] = useState(() => {
    if (transcriptStore) return null;
    const listeners = new Set<() => void>();
    const eventListeners = new Set<(ev: TelemetryEvent) => void>();
    const duckTelemetryStore: any = {
      getSnapshot: () => snapshotRef.current,
      onTelemetryEvent: (handler: (ev: TelemetryEvent) => void) => {
        eventListeners.add(handler);
        return () => eventListeners.delete(handler);
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return new TranscriptStore({
      telemetryStore: duckTelemetryStore,
      initialLedger: ledger,
      onWritePty: (data) => onWritePtyRef.current(data),
      onRequestQuit: () => onRequestQuitRef.current(),
      platform,
    });
  });

  const effectiveStore = transcriptStore ?? internalStore!;

  // Dispose internalStore on unmount to prevent interval and listener leaks
  useEffect(() => {
    return () => {
      internalStore?.dispose();
    };
  }, [internalStore]);

  // Hook into effectiveStore callbacks for overlays and takeover
  useEffect(() => {
    return effectiveStore.setCallbacks({
      onOpenOverlay: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => {
        setActiveOverlay(overlay);
        activeOverlayRef.current = overlay;
        setOverlayScrollOffset(0);
      },
      onEnterTakeover: () => {
        setMode('TAKEOVER');
        modeRef.current = 'TAKEOVER';
      },
      onRequestQuit: () => {
        onRequestQuitRef.current();
      },
    });
  }, [effectiveStore]);

  // Synchronize incoming ledger changes into the store
  useEffect(() => {
    effectiveStore.updateLedger(ledger);
  }, [ledger, effectiveStore]);

  // Track store snapshot reactively
  const [storeSnapshot, setStoreSnapshot] = useState<TranscriptStoreSnapshot>(() =>
    effectiveStore.getSnapshot()
  );

  useEffect(() => {
    const unsub = effectiveStore.subscribe(() => {
      setStoreSnapshot(effectiveStore.getSnapshot());
    });
    setStoreSnapshot(effectiveStore.getSnapshot());
    return unsub;
  }, [effectiveStore]);

  const { stdin, setRawMode } = useStdin();
  useLayoutEffect(() => {
    if (setRawMode) {
      try {
        setRawMode(true);
      } catch {
        // ignore in non-TTY environments
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

  // Derived members and team rail state
  const members = deriveTeamMembers(
    snapshot,
    storeSnapshot.pendingDecisionCount,
    storeSnapshot.isPaused,
    ledger.status
  );

  const safeMemberIndex = Math.min(
    Math.max(0, selectedMemberIndex),
    Math.max(0, members.length - 1)
  );
  const selectedMember = members[safeMemberIndex] ?? {
    id: 'orchestrator',
    role: 'orchestrator',
    isMain: true,
    taskNumber: undefined,
    statusText: 'running',
    needsYou: false,
  };

  const tasks = snapshot.tasks ?? [];
  const selectedTask =
    tasks.find(
      (t) =>
        t.index === selectedMember.taskNumber ||
        t.id === String(selectedMember.taskNumber)
    ) ?? (tasks.length > 0 ? tasks[0] : null);

  const hasStarted =
    storeSnapshot.hasStarted ||
    tasks.length > 0 ||
    Boolean(snapshot.activeSubagent);

  const isRailSideBySide = columns >= 110 && hasStarted;

  const currentWave = selectedTask?.wave;
  const totalWaves = tasks.reduce(
    (max, t) => (t.wave && t.wave > max ? t.wave : max),
    0
  ) || undefined;
  const activeTaskNumber =
    selectedMember.taskNumber ??
    tasks.find((t) => t.status === 'in_progress')?.index;

  const zoomTarget =
    mode === 'ZOOM'
      ? {
          role: selectedMember.role,
          taskNumber: selectedMember.taskNumber,
        }
      : null;

  const focusedDecision = effectiveStore.getFocusedDecision();
  const decisionOptionCount =
    focusedDecision &&
    focusedDecision.kind === 'DecisionCard' &&
    focusedDecision.status === 'pending'
      ? focusedDecision.options.length
      : undefined;

  const placeholder = getComposerPlaceholder({
    hasStarted,
    mode,
    decisionOptionCount,
  });

  const bodyRows = Math.max(10, rows - 5);

  const executeSlashCommand = (raw: string) => {
    const trimmed = raw.trim();
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const parts = normalized.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/spec':
        setActiveOverlay('spec');
        activeOverlayRef.current = 'spec';
        setOverlayScrollOffset(0);
        break;
      case '/plan':
        setActiveOverlay('plan');
        activeOverlayRef.current = 'plan';
        setOverlayScrollOffset(0);
        break;
      case '/audit':
        setActiveOverlay('audit');
        activeOverlayRef.current = 'audit';
        setOverlayScrollOffset(0);
        break;
      case '/raw':
        setMode('TAKEOVER');
        modeRef.current = 'TAKEOVER';
        break;
      case '/pause':
        effectiveStore.pause();
        break;
      case '/resume':
        effectiveStore.resume();
        break;
      case '/decide':
        effectiveStore.refocusDeferredDecision();
        setTranscriptScrollOffset(0);
        break;
      case '/help':
        effectiveStore.runSlashCommand('/help');
        break;
      case '/quit':
        onRequestQuitRef.current();
        break;
      default:
        effectiveStore.runSlashCommand(trimmed);
        break;
    }
  };

  const handleUpArrow = () => {
    if (activeOverlayRef.current !== null) {
      setOverlayScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (modeRef.current === 'TEAM') {
      setSelectedMemberIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (modeRef.current === 'ZOOM') {
      setZoomScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    const focused = effectiveStore.getFocusedDecision();
    if (focused && composerTextRef.current.length === 0) {
      const curOpt = focused.selectedOptionIndex || 1;
      effectiveStore.selectDecisionOption(Math.max(1, curOpt - 1));
      return;
    }
  };

  const handleDownArrow = () => {
    if (activeOverlayRef.current !== null) {
      setOverlayScrollOffset((prev) => prev + 1);
      return;
    }
    if (modeRef.current === 'TEAM') {
      setSelectedMemberIndex((prev) =>
        Math.min(members.length - 1, prev + 1)
      );
      return;
    }
    if (modeRef.current === 'ZOOM') {
      setZoomScrollOffset((prev) => prev + 1);
      return;
    }
    const focused = effectiveStore.getFocusedDecision();
    if (focused && composerTextRef.current.length === 0) {
      const curOpt = focused.selectedOptionIndex || 1;
      const maxOpt = (focused as any).options?.length ?? 9;
      effectiveStore.selectDecisionOption(Math.min(maxOpt, curOpt + 1));
      return;
    }
  };

  const handleEscape = () => {
    if (activeOverlayRef.current !== null) {
      setActiveOverlay(null);
      activeOverlayRef.current = null;
      setOverlayScrollOffset(0);
      return;
    }
    if (modeRef.current === 'TEAM' || modeRef.current === 'ZOOM') {
      setMode('CHAT');
      modeRef.current = 'CHAT';
      return;
    }
    const focused = effectiveStore.getFocusedDecision();
    if (focused) {
      effectiveStore.deferFocusedDecision();
      return;
    }
  };

  useLayoutEffect(() => {
    const processNavChunk = (input: string) => {
      let i = 0;
      while (i < input.length) {
        // ANSI escape sequences
        if (input.charCodeAt(i) === 0x1b) {
          const rest = input.slice(i);

          // PageUp / PageDown: \x1b[5~ / \x1b[6~
          const pageMatch = rest.match(/^\x1b\[([56])~/);
          if (pageMatch) {
            if (pageMatch[1] === '5') {
              if (activeOverlayRef.current !== null) {
                setOverlayScrollOffset((prev) => Math.max(0, prev - 10));
              } else {
                setTranscriptScrollOffset((prev) => prev + 5);
              }
            } else {
              if (activeOverlayRef.current !== null) {
                setOverlayScrollOffset((prev) => prev + 10);
              } else {
                setTranscriptScrollOffset((prev) => Math.max(0, prev - 5));
              }
            }
            i += pageMatch[0].length;
            continue;
          }

          // End key: \x1b[F or \x1b[4~ or \x1bOF
          const endMatch = rest.match(/^\x1b(?:\[F|\[4~|OF)/);
          if (endMatch) {
            setTranscriptScrollOffset(0);
            effectiveStore.refocusDeferredDecision();
            i += endMatch[0].length;
            continue;
          }

          // Arrow keys: \x1b[A, \x1b[B, \x1bOA, \x1bOB
          const arrowMatch = rest.match(/^\x1b(?:\[|O)([A-D])/);
          if (arrowMatch) {
            const code = arrowMatch[1];
            if (code === 'A') {
              handleUpArrow();
            } else if (code === 'B') {
              handleDownArrow();
            }
            i += arrowMatch[0].length;
            continue;
          }

          // Bare Esc key
          if (rest.length === 1 || (rest[1] !== '[' && rest[1] !== 'O')) {
            handleEscape();
            i++;
            continue;
          }
        }

        const char = input[i];
        i++;

        // Ctrl+C confirmation: \x03
        if (char === '\x03') {
          if (confirmingQuitRef.current) {
            onRequestQuitRef.current();
            return;
          }
          confirmingQuitRef.current = true;
          setConfirmingQuit(true);
          continue;
        }
        if (confirmingQuitRef.current) {
          confirmingQuitRef.current = false;
          setConfirmingQuit(false);
        }

        // Ctrl+T: \x14
        if (char === '\x14') {
          setMode('TAKEOVER');
          modeRef.current = 'TAKEOVER';
          continue;
        }

        // Ctrl+R: \x12
        if (char === '\x12') {
          if (modeRef.current === 'ZOOM') {
            setActiveOverlay('raw');
            activeOverlayRef.current = 'raw';
            setOverlayScrollOffset(0);
          }
          continue;
        }

        // Tab: \t
        if (char === '\t') {
          if (modeRef.current === 'CHAT') {
            setMode('TEAM');
            modeRef.current = 'TEAM';
          } else if (modeRef.current === 'TEAM') {
            setMode('CHAT');
            modeRef.current = 'CHAT';
          }
          continue;
        }

        // Active overlay view keys
        if (activeOverlayRef.current !== null) {
          if (
            activeOverlayRef.current === 'spec' ||
            activeOverlayRef.current === 'plan'
          ) {
            if (char === 's' || char === 'S') {
              setActiveOverlay('spec');
              activeOverlayRef.current = 'spec';
              setOverlayScrollOffset(0);
              continue;
            }
            if (char === 'p' || char === 'P') {
              setActiveOverlay('plan');
              activeOverlayRef.current = 'plan';
              setOverlayScrollOffset(0);
              continue;
            }
          }
          if (char === 'k' || char === 'K') {
            setOverlayScrollOffset((prev) => Math.max(0, prev - 1));
            continue;
          }
          if (char === 'j' || char === 'J') {
            setOverlayScrollOffset((prev) => prev + 1);
            continue;
          }
          continue;
        }

        // TEAM mode
        if (modeRef.current === 'TEAM') {
          if (char === '\r' || char === '\n') {
            setMode('ZOOM');
            modeRef.current = 'ZOOM';
            continue;
          }
          continue;
        }

        // Decision card interactions in CHAT mode
        const focused = effectiveStore.getFocusedDecision();
        if (focused && composerTextRef.current.length === 0) {
          if (char === '\r' || char === '\n') {
            effectiveStore.answerFocusedDecision();
            continue;
          }
          if (char >= '1' && char <= '9') {
            const digit = parseInt(char, 10);
            effectiveStore.selectDecisionOption(digit);
            continue;
          }
        }

        // Backspace handling
        if (char === '\x7f' || char === '\b') {
          const next = composerTextRef.current.slice(0, -1);
          composerTextRef.current = next;
          setComposerText(next);
          if (next.length === 0 && focused) {
            effectiveStore.selectDecisionOption(1);
          }
          continue;
        }

        // Enter / newline submission
        if (char === '\r' || char === '\n') {
          const currentText = composerTextRef.current;
          if (currentText.endsWith('\\')) {
            const next = currentText.slice(0, -1) + '\n';
            composerTextRef.current = next;
            setComposerText(next);
            continue;
          }
          if (currentText.startsWith('/')) {
            executeSlashCommand(currentText);
            composerTextRef.current = '';
            setComposerText('');
            continue;
          }
          if (focused) {
            effectiveStore.answerFocusedDecision(
              currentText.length > 0 ? currentText : undefined
            );
            composerTextRef.current = '';
            setComposerText('');
            continue;
          }
          if (currentText.length > 0) {
            effectiveStore.submitUserMessage(currentText);
            composerTextRef.current = '';
            setComposerText('');
            continue;
          }
          continue;
        }

        // Printable character appending
        if (char.charCodeAt(0) >= 32) {
          const next = composerTextRef.current + char;
          composerTextRef.current = next;
          setComposerText(next);
          continue;
        }
      }
    };

    const handleData = (chunk: Buffer | string) => {
      const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');

      if (modeRef.current === 'TAKEOVER') {
        const ctrlRightBracketIdx = raw.indexOf('\x1d');
        if (ctrlRightBracketIdx !== -1) {
          const prefix = raw.slice(0, ctrlRightBracketIdx);
          const suffix = raw.slice(ctrlRightBracketIdx + 1);

          if (prefix.length > 0) {
            onWritePtyRef.current(prefix);
          }

          setMode('CHAT');
          modeRef.current = 'CHAT';

          if (suffix.length > 0) {
            processNavChunk(suffix);
          }
        } else {
          onWritePtyRef.current(raw);
        }
        return;
      }

      processNavChunk(raw);
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [stdin]);

  // Minimum size guard
  if (columns < 80 || rows < 24) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.colors.ask}>
          Make this window at least 80 columns by 24 rows.
        </Text>
      </Box>
    );
  }

  // Render main layout
  return (
    <Box flexDirection="column" width={columns}>
      {/* Header Bar */}
      <HeaderBar
        branch={snapshot.branch}
        totalElapsedMs={snapshot.totalElapsedMs}
        status={ledger.status}
        specApproved={ledger.checkpoints?.spec?.status === 'APPROVED'}
        planApproved={ledger.checkpoints?.plan?.status === 'APPROVED'}
        currentWave={currentWave}
        totalWaves={totalWaves}
        currentTask={activeTaskNumber}
        totalTasks={tasks.length}
        pendingDecisionCount={storeSnapshot.pendingDecisionCount}
        isPaused={storeSnapshot.isPaused}
        zoomTarget={zoomTarget}
        theme={theme}
        glyphs={glyphs}
      />

      {/* Main Body Area */}
      {activeOverlay === 'spec' || activeOverlay === 'plan' ? (
        <SpecPlanView
          specPath={snapshot.specPath}
          specContent={snapshot.specContent}
          planPath={snapshot.planPath}
          planContent={snapshot.planContent}
          activeDoc={activeOverlay}
          scrollOffset={overlayScrollOffset}
          maxRows={bodyRows}
        />
      ) : activeOverlay === 'audit' ? (
        <AuditLogView
          ledger={ledger}
          scrollOffset={overlayScrollOffset}
          maxRows={bodyRows}
        />
      ) : activeOverlay === 'raw' || mode === 'TAKEOVER' ? (
        <TakeoverView
          lines={snapshot.ptyViewportLines}
          maxRows={bodyRows}
          theme={theme}
        />
      ) : mode === 'TEAM' && !isRailSideBySide ? (
        <TeamRail
          members={members}
          tasks={tasks}
          ledgerStatus={ledger.status}
          selectedMemberIndex={safeMemberIndex}
          isFocused={true}
          handledCounts={storeSnapshot.handledCounts}
          width={columns}
          theme={theme}
          glyphs={glyphs}
        />
      ) : (
        <Box flexDirection="row" flexGrow={1}>
          {mode === 'ZOOM' ? (
            <Box flexGrow={1}>
              <ZoomView
                role={selectedMember.role}
                taskNumber={selectedMember.taskNumber}
                taskTitle={selectedTask?.title}
                elapsedFormatted={selectedMember.elapsedFormatted || '0s'}
                steps={
                  snapshot.agentSteps?.[selectedMember.role] ??
                  snapshot.agentSteps?.[selectedMember.id] ??
                  []
                }
                ptyLines={snapshot.ptyViewportLines}
                scrollOffset={zoomScrollOffset}
                theme={theme}
                glyphs={glyphs}
              />
            </Box>
          ) : (
            <Box flexGrow={1}>
              <Transcript
                items={storeSnapshot.items}
                scrollOffset={transcriptScrollOffset}
                maxRows={bodyRows}
                maxWidth={columns - (isRailSideBySide ? 34 : 2)}
                pendingDecisionCount={storeSnapshot.pendingDecisionCount}
                focusedDecisionId={storeSnapshot.focusedDecision?.id ?? null}
                theme={theme}
                glyphs={glyphs}
              />
            </Box>
          )}

          {isRailSideBySide && (
            <TeamRail
              members={members}
              tasks={tasks}
              ledgerStatus={ledger.status}
              selectedMemberIndex={safeMemberIndex}
              isFocused={mode === 'TEAM'}
              zoomTask={mode === 'ZOOM' ? selectedTask : null}
              handledCounts={storeSnapshot.handledCounts}
              width={32}
              theme={theme}
              glyphs={glyphs}
            />
          )}
        </Box>
      )}

      {/* Composer and Command Palette (hidden during takeover and active overlays) */}
      {mode !== 'TAKEOVER' && activeOverlay === null && (
        <Box flexDirection="column">
          {composerText.startsWith('/') && (
            <CommandPalette query={composerText} theme={theme} />
          )}
          <Composer
            value={composerText}
            placeholder={placeholder}
            maxWidth={columns - 4}
            isFocused={mode === 'CHAT' || mode === 'ZOOM'}
            theme={theme}
            glyphs={glyphs}
          />
        </Box>
      )}

      {/* Footer Bar */}
      <FooterBar
        mode={mode}
        hasFocusedDecision={Boolean(storeSnapshot.focusedDecision)}
        isPaused={storeSnapshot.isPaused}
        confirmingQuit={confirmingQuit}
        activeOverlay={activeOverlay}
        theme={theme}
      />
    </Box>
  );
};
