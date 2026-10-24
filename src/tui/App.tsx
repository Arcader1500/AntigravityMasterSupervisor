import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Box, Text, measureElement, useStdin, useStdout } from 'ink';
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
import { CommandPalette, filterSlashCommands } from './components/CommandPalette.js';
import { SpecPlanView } from './components/SpecPlanView.js';
import { AuditLogView } from './components/AuditLogView.js';
import { deriveProcessPresentation } from './process-presentation.js';
import { createInputDecoder } from './input-events.js';
import type { NormalizedInputEvent } from './input-events.js';
import type {
  TranscriptViewportAnchor,
  TranscriptViewportMetrics,
} from './transcript-viewport.js';

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
  const [paletteIndex, setPaletteIndex] = useState<number>(0);
  const [confirmingQuit, setConfirmingQuit] = useState<boolean>(false);
  const inputDecoder = useRef(createInputDecoder());
  const currentInputEvent = useRef<NormalizedInputEvent>();
  const viewportAnchorRef = useRef<TranscriptViewportAnchor>();
  const [viewportAnchor, setViewportAnchor] = useState<TranscriptViewportAnchor>();
  const headerLayout = useRef<React.ElementRef<typeof Box>>(null);
  const composerLayout = useRef<React.ElementRef<typeof Box>>(null);
  const footerLayout = useRef<React.ElementRef<typeof Box>>(null);
  const [chromeRows, setChromeRows] = useState(4);

  // Synchronous refs to prevent stale closure captures in input callbacks
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const activeOverlayRef = useRef(activeOverlay);
  activeOverlayRef.current = activeOverlay;

  const composerTextRef = useRef(composerText);
  composerTextRef.current = composerText;

  const paletteIndexRef = useRef(paletteIndex);
  paletteIndexRef.current = paletteIndex;

  const setComposerValue = (next: string) => {
    composerTextRef.current = next;
    setComposerText(next);
    paletteIndexRef.current = 0;
    setPaletteIndex(0);
  };

  const safePaletteIndex = (matchCount: number): number =>
    Math.min(Math.max(0, paletteIndexRef.current), Math.max(0, matchCount - 1));

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
    const previousRawMode = Boolean(
      (stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw
    );
    if (setRawMode && !previousRawMode) {
      try {
        setRawMode(true);
      } catch {
        // ignore in non-TTY environments
      }
    }
    return () => {
      if (setRawMode && !previousRawMode) {
        try {
          setRawMode(false);
        } catch {
          // ignore
        }
      }
    };
  }, [setRawMode, stdin]);

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

  const showRules = rows > 8 && activeOverlay === null && mode !== 'TAKEOVER';
  const showSplitRule = showRules && isRailSideBySide;
  const leftPaneCols = Math.max(1, columns - 33);
  const topRuleText = showSplitRule
    ? glyphs.hr.repeat(leftPaneCols) + glyphs.teeDown + glyphs.hr.repeat(32)
    : glyphs.hr.repeat(columns);
  const bottomRuleText = showSplitRule
    ? glyphs.hr.repeat(leftPaneCols) + glyphs.teeUp + glyphs.hr.repeat(32)
    : glyphs.hr.repeat(columns);

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
  const processPresentation = deriveProcessPresentation(ledger, snapshot);
  const progressSource =
    snapshot.tasks?.length || snapshot.planPath || snapshot.planContent
      ? 'artifacts' as const
      : undefined;
  const decisionOptionCount =
    focusedDecision &&
    (focusedDecision.kind === 'DecisionCard' ||
      focusedDecision.kind === 'FailureCard') &&
    focusedDecision.status === 'pending'
      ? focusedDecision.options.length
      : undefined;

  const placeholder = getComposerPlaceholder({
    hasStarted,
    mode,
    decisionOptionCount,
  });

  useLayoutEffect(() => {
    const measuredRows = [
      headerLayout.current,
      composerLayout.current,
      footerLayout.current,
    ]
      .reduce((sum, node) => sum + (node ? measureElement(node).height : 0), 0);
    if (measuredRows > 0 && measuredRows !== chromeRows) setChromeRows(measuredRows);
  });
  const bodyRows = Math.max(0, rows - chromeRows - (showRules ? 2 : 0));

  const onTranscriptViewportMetrics = (metrics: TranscriptViewportMetrics) => {
    if (transcriptScrollOffset <= 0) {
      if (viewportAnchorRef.current) {
        viewportAnchorRef.current = undefined;
        setViewportAnchor(undefined);
      }
      return;
    }
    const measuredAnchor = metrics.anchor;
    if (!measuredAnchor) return;
    const prior = viewportAnchorRef.current;
    const requestedViewportRow =
      prior?.itemId === measuredAnchor.itemId &&
      prior.segmentKey === measuredAnchor.segmentKey
      ? prior.viewportRow
      : measuredAnchor.viewportRow;
    const anchor = {
      ...measuredAnchor,
      viewportRow: Math.max(
        0,
        Math.min(Math.max(0, metrics.visibleRows - 1), requestedViewportRow)
      ),
    };
    viewportAnchorRef.current = anchor;
    if (
      prior?.itemId !== anchor.itemId ||
      prior.segmentKey !== anchor.segmentKey ||
      prior.sourceOffset !== anchor.sourceOffset ||
      prior.viewportRow !== anchor.viewportRow
    ) {
      setViewportAnchor(anchor);
    }
    const row = metrics.segments.find(
      (segment) =>
        segment.itemId === anchor.itemId &&
        segment.segmentKey === anchor.segmentKey &&
        segment.sourceOffset === anchor.sourceOffset
    )?.row;
    if (row !== undefined) {
      const rebased = Math.max(0, metrics.totalRows - metrics.visibleRows - row + anchor.viewportRow);
      setTranscriptScrollOffset((current) => current > 0 && current !== rebased ? rebased : current);
    }
  };

  const scrollTranscriptBy = (delta: number) => {
    viewportAnchorRef.current = undefined;
    setViewportAnchor(undefined);
    setTranscriptScrollOffset((current) => Math.max(0, current + delta));
  };

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
    if (modeRef.current === 'CHAT' && composerTextRef.current.startsWith('/')) {
      const matches = filterSlashCommands(composerTextRef.current);
      if (matches.length > 0) {
        const next =
          (paletteIndexRef.current - 1 + matches.length) % matches.length;
        paletteIndexRef.current = next;
        setPaletteIndex(next);
        return;
      }
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
    if (modeRef.current === 'CHAT' && composerTextRef.current.startsWith('/')) {
      const matches = filterSlashCommands(composerTextRef.current);
      if (matches.length > 0) {
        const next = (paletteIndexRef.current + 1) % matches.length;
        paletteIndexRef.current = next;
        setPaletteIndex(next);
        return;
      }
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
                scrollTranscriptBy(5);
              }
            } else {
              if (activeOverlayRef.current !== null) {
                setOverlayScrollOffset((prev) => prev + 10);
              } else {
                scrollTranscriptBy(-5);
              }
            }
            i += pageMatch[0].length;
            continue;
          }

          // End key: \x1b[F or \x1b[4~ or \x1bOF
          const endMatch = rest.match(/^\x1b(?:\[F|\[4~|OF)/);
          if (endMatch) {
            setTranscriptScrollOffset(0);
            viewportAnchorRef.current = undefined;
            setViewportAnchor(undefined);
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

        // Collapse a Windows-style CRLF pair into a single Enter.
        if (char === '\r' && i < input.length && input[i] === '\n') {
          i++;
        }

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
          if (modeRef.current === 'CHAT' && composerTextRef.current.startsWith('/')) {
            const matches = filterSlashCommands(composerTextRef.current);
            if (matches.length > 0) {
              const next = matches[safePaletteIndex(matches.length)].command;
              setComposerValue(next);
              continue;
            }
          }
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
            effectiveStore.answerFocusedDecision(undefined, {
              id: currentInputEvent.current!.id,
              decisionId: focused.id,
            });
            continue;
          }
          if (char >= '1' && char <= '9') {
            const digit = parseInt(char, 10);
            if (digit <= focused.options.length) {
              effectiveStore.selectDecisionOption(digit);
            }
            continue;
          }
        }

        // Backspace handling
        if (char === '\x7f' || char === '\b') {
          const next = composerTextRef.current.slice(0, -1);
          setComposerValue(next);
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
            setComposerValue(next);
            continue;
          }
          if (currentText.startsWith('/')) {
            const matches = filterSlashCommands(currentText);
            const command =
              matches.length > 0
                ? matches[safePaletteIndex(matches.length)].command
                : currentText;
            executeSlashCommand(command);
            setComposerValue('');
            continue;
          }
          if (focused) {
            effectiveStore.answerFocusedDecision(
              currentText.length > 0 ? currentText : undefined,
              { id: currentInputEvent.current!.id, decisionId: focused.id }
            );
            setComposerValue('');
            continue;
          }
          if (currentText.length > 0) {
            effectiveStore.submitUserMessage(currentText, currentInputEvent.current?.id);
            setComposerValue('');
            continue;
          }
          continue;
        }

        // Printable character appending
        if (char.charCodeAt(0) >= 32) {
          const next = composerTextRef.current + char;
          setComposerValue(next);
          continue;
        }
      }
    };

    function processDecodedChunk(raw: string): void {
      const events = inputDecoder.current.push(raw);
      let rawCursor = 0;
      for (const event of events) {
        const eventStart = raw.indexOf(event.raw, rawCursor);
        const eventEnd = eventStart < 0 ? rawCursor : eventStart + event.raw.length;
        let nextRaw = eventEnd;
        if (event.raw === '\r' && raw[nextRaw] === '\n') nextRaw++;

        currentInputEvent.current = event;
        if (
          event.kind === 'text' &&
          /[\r\n]/.test(event.raw) &&
          (modeRef.current === 'CHAT' || modeRef.current === 'ZOOM') &&
          activeOverlayRef.current === null
        ) {
          setComposerValue(composerTextRef.current + event.raw.replace(/\r\n?/g, '\n'));
        } else {
          processNavChunk(event.raw);
        }
        rawCursor = nextRaw;

        // A mode change can happen in the middle of a single stdin chunk.
        if (modeRef.current === 'TAKEOVER') {
          processTakeoverBytes(raw.slice(nextRaw));
          return;
        }
      }
    }

    function processTakeoverBytes(raw: string): void {
      const delimiter = raw.indexOf('\x1d');
      if (delimiter < 0) {
        if (raw) onWritePtyRef.current(raw);
        return;
      }
      const prefix = raw.slice(0, delimiter);
      if (prefix) onWritePtyRef.current(prefix);
      setMode('CHAT');
      modeRef.current = 'CHAT';
      inputDecoder.current.reset();
      const suffix = raw.slice(delimiter + 1);
      if (suffix) processDecodedChunk(suffix);
    }

    const handleData = (chunk: Buffer | string) => {
      const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      if (modeRef.current === 'TAKEOVER') processTakeoverBytes(raw);
      else processDecodedChunk(raw);
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [stdin]);

  // Render main layout
  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      {/* Header Bar */}
      <Box ref={headerLayout} flexDirection="column" flexShrink={0}>
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
          pauseFeedback={storeSnapshot.delivery.pauseFeedback}
          phaseSource={snapshot.phaseSource}
          processPresentation={processPresentation}
          zoomTarget={zoomTarget}
          theme={theme}
          glyphs={glyphs}
        />
      </Box>

      {/* Top structural rule */}
      {showRules && (
        <Text color={theme.colors.line}>{topRuleText}</Text>
      )}

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
          width={columns}
        />
      ) : activeOverlay === 'audit' ? (
        <AuditLogView
          ledger={ledger}
          snapshot={snapshot}
          processPresentation={processPresentation}
          scrollOffset={overlayScrollOffset}
          maxRows={bodyRows}
          width={columns}
        />
      ) : activeOverlay === 'raw' || mode === 'TAKEOVER' ? (
        <TakeoverView
          lines={snapshot.ptyViewportLines}
          maxRows={bodyRows}
          theme={theme}
          showBanner={false}
        />
      ) : mode === 'TEAM' && !isRailSideBySide ? (
        <Box height={bodyRows} overflowY="hidden" flexShrink={0}>
        <TeamRail
          members={members}
          tasks={tasks}
          ledgerStatus={ledger.status}
          selectedMemberIndex={safeMemberIndex}
          isFocused={true}
          handledCounts={storeSnapshot.handledCounts}
          progressSource={progressSource}
          width={columns}
          theme={theme}
          glyphs={glyphs}
        />
        </Box>
      ) : (
        <Box
          flexDirection="row"
          flexGrow={1}
          height={bodyRows}
          overflow="hidden"
        >
          <Box
            flexGrow={1}
            width={isRailSideBySide ? leftPaneCols : undefined}
          >
            {mode === 'ZOOM' ? (
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
            ) : (
              <Transcript
                items={storeSnapshot.items}
                scrollOffset={transcriptScrollOffset}
                maxRows={bodyRows}
                maxWidth={columns - (isRailSideBySide ? 34 : 2)}
                pendingDecisionCount={storeSnapshot.pendingDecisionCount}
                focusedDecisionId={storeSnapshot.focusedDecision?.id ?? null}
                theme={theme}
                glyphs={glyphs}
                anchor={viewportAnchor}
                onViewportMetrics={onTranscriptViewportMetrics}
              />
            )}
          </Box>

          {isRailSideBySide && (
            <Box
              width={1}
              height={bodyRows}
              flexDirection="column"
              overflow="hidden"
            >
              {Array.from({ length: bodyRows }, (_, idx) => (
                <Text key={idx} color={theme.colors.line}>
                  {glyphs.vr}
                </Text>
              ))}
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
              progressSource={progressSource}
              width={32}
              theme={theme}
              glyphs={glyphs}
            />
          )}
        </Box>
      )}

      {/* Bottom structural rule */}
      {showRules && (
        <Text color={theme.colors.line}>{bottomRuleText}</Text>
      )}

      {/* Composer and Command Palette (hidden during takeover and active overlays) */}
      {mode !== 'TAKEOVER' && activeOverlay === null && (
        <Box ref={composerLayout} flexDirection="column" flexShrink={0}>
          {composerText.startsWith('/') && (
            <CommandPalette
              query={composerText}
              selectedIndex={paletteIndex}
              theme={theme}
            />
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
      {rows > 8 && (
        <Box ref={footerLayout} flexDirection="column" flexShrink={0}>
          <FooterBar
            mode={mode}
            hasFocusedDecision={Boolean(storeSnapshot.focusedDecision)}
            decisionOptionCount={decisionOptionCount}
            isPaused={storeSnapshot.isPaused}
            confirmingQuit={confirmingQuit}
            activeOverlay={activeOverlay}
            pauseFeedback={storeSnapshot.delivery.pauseFeedback}
            theme={theme}
          />
        </Box>
      )}
    </Box>
  );
};
