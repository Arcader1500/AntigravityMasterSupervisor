import React from 'react';
import { Box, Text } from 'ink';
import type { InputMode, ObservationSource } from '../../telemetry/types.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import type { ProcessPresentation } from '../process-presentation.js';
import type { PauseFeedback } from '../transcript-store.js';

export function formatDuration(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '00m 00s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatCompactTimer(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export interface HeaderBarProps {
  branch?: string;
  totalElapsedMs?: number;
  status?: string;

  // Conversational props
  specApproved?: boolean;
  planApproved?: boolean;
  currentWave?: number;
  totalWaves?: number;
  currentTask?: number;
  totalTasks?: number;
  pendingDecisionCount?: number;
  isPaused?: boolean;
  zoomTarget?: { role: string; taskNumber?: number } | null;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
  processPresentation?: ProcessPresentation;
  pauseFeedback?: PauseFeedback;
  phaseSource?: ObservationSource;

  // Legacy props
  inputMode?: InputMode;
  waitingForInput?: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  branch,
  totalElapsedMs,
  status,
  specApproved,
  planApproved,
  currentWave,
  totalWaves,
  currentTask,
  totalTasks,
  pendingDecisionCount,
  isPaused,
  zoomTarget,
  theme,
  glyphs,
  processPresentation,
  pauseFeedback,
  phaseSource,
  inputMode,
  waitingForInput,
}) => {
  // Backward-compatibility guard: when inputMode is passed without conversational props,
  // render legacy header for legacy tests and early-wave App.tsx.
  const isLegacy =
    inputMode !== undefined &&
    specApproved === undefined &&
    planApproved === undefined &&
    currentWave === undefined &&
    totalWaves === undefined &&
    currentTask === undefined &&
    totalTasks === undefined &&
    pendingDecisionCount === undefined &&
    zoomTarget === undefined &&
    !isPaused;

  if (isLegacy) {
    const modeBadge = inputMode === 'PTY_INTERACT' ? 'PTY INTERACT' : 'NAV';
    const modeColor = inputMode === 'PTY_INTERACT' ? 'magenta' : 'cyan';

    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Box flexShrink={0}>
          <Text>
            <Text bold color="cyan">
              🚀 AGY SUPERVISOR
            </Text>
            <Text color="gray"> │ </Text>
            <Text>
              Branch: <Text bold color="blue">{branch || 'unknown'}</Text>
            </Text>
            <Text color="gray"> │ </Text>
            <Text>
              Total Elapsed: <Text color="yellow">{formatDuration(totalElapsedMs ?? 0)}</Text>
            </Text>
            <Text color="gray"> │ </Text>
            <Text>
              Status: <Text bold color={status === 'COMPLETED' ? 'yellow' : 'green'}>{status === 'COMPLETED' ? 'COMPLETED (legacy, unverified)' : status ?? ''}</Text>
            </Text>
          </Text>
        </Box>

        <Box flexDirection="row" gap={1} flexShrink={0}>
          {waitingForInput && (
            <Text bold color="yellow" backgroundColor="red">
              {' [WAITING FOR INPUT] '}
            </Text>
          )}
          <Text bold color={modeColor}>
            [{modeBadge}]
          </Text>
        </Box>
      </Box>
    );
  }

  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  // The ledger describes a phase; it does not certify a completed stage.
  const verifyCurrent = status === 'VERIFYING';
  const buildCurrent = status === 'EXECUTING';
  const specCurrent = status === 'CHECKPOINT_SPEC' || (status === 'PLANNING' && !specApproved);
  const planCurrent = status === 'PLANNING' && Boolean(specApproved) && !planApproved;
  const specDone = Boolean(specApproved);
  const planDone = Boolean(planApproved);
  const buildDone = false;
  const verifyDone = false;
  const inferredPhaseSource = phaseSource === 'artifacts'
    ? 'phase inferred from artifacts'
    : phaseSource === 'agent_output'
      ? 'phase inferred from agent output'
      : phaseSource === 'ledger'
        ? 'phase recorded in ledger'
        : undefined;

  let waveOrTaskText = '';
  if (currentWave !== undefined && totalWaves !== undefined) {
    waveOrTaskText = `wave ${currentWave} of ${totalWaves}`;
  } else if (currentTask !== undefined && totalTasks !== undefined) {
    waveOrTaskText = `task ${currentTask} of ${totalTasks}`;
  }

  const renderPhaseStrip = () => (
    <Text>
      <Text color={specDone || specCurrent ? activeTheme.colors.text : activeTheme.colors.dim}>Spec</Text>
      {specDone && <Text color={activeTheme.colors.dim}> recorded</Text>}
      {specCurrent && <Text color={activeTheme.colors.active}>{` ${activeGlyphs.running}`}</Text>}
      <Text>  </Text>
      <Text color={planDone || planCurrent ? activeTheme.colors.text : activeTheme.colors.dim}>Plan</Text>
      {planDone && <Text color={activeTheme.colors.dim}> recorded</Text>}
      {planCurrent && <Text color={activeTheme.colors.active}>{` ${activeGlyphs.running}`}</Text>}
      <Text>  </Text>
      <Text color={buildDone || buildCurrent ? activeTheme.colors.text : activeTheme.colors.dim}>Build</Text>
      {buildDone && <Text color={activeTheme.colors.done}>{` ${activeGlyphs.done}`}</Text>}
      {buildCurrent && <Text color={activeTheme.colors.active}>{` ${activeGlyphs.running}`}</Text>}
      {buildCurrent && inferredPhaseSource && <Text color={activeTheme.colors.dim}>{` (${inferredPhaseSource})`}</Text>}
      {buildCurrent && waveOrTaskText ? (
        <Text color={activeTheme.colors.dim}>{` ${waveOrTaskText}`}</Text>
      ) : null}
      <Text>  </Text>
      <Text color={verifyDone || verifyCurrent ? activeTheme.colors.text : activeTheme.colors.dim}>Verify</Text>
      {verifyDone && <Text color={activeTheme.colors.done}>{` ${activeGlyphs.done}`}</Text>}
      {verifyCurrent && <Text color={activeTheme.colors.active}>{` ${activeGlyphs.running}`}</Text>}
      {(specDone || planDone) && <Text color={activeTheme.colors.dim}>  (recorded ledger)</Text>}
    </Text>
  );

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingX={1}
    >
      <Box flexDirection="row" gap={2} alignItems="center">
        <Text bold>agysup</Text>
        <Text color={activeTheme.colors.dim}>{branch || 'unknown'}</Text>
        {zoomTarget ? (
          <Text color={activeTheme.colors.text}>
            {`Team / ${zoomTarget.role}${zoomTarget.taskNumber !== undefined ? `, Task ${zoomTarget.taskNumber}` : ''}`}
          </Text>
        ) : status === 'COMPLETED' ? (
          <Text color={activeTheme.colors.ask}>
            {processPresentation?.outcomeText ?? 'Legacy ledger status COMPLETED'}; {processPresentation?.sourceText ?? 'Source: recorded ledger.'} review and verification unconfirmed
          </Text>
        ) : (
          renderPhaseStrip()
        )}
        {isPaused && (
          <Text color={activeTheme.colors.ask}>{pauseFeedback === 'windows_input_only' ? 'Paused; Windows queues input' : pauseFeedback?.startsWith('pause_signal_failed') ? 'Paused; POSIX signal failed' : pauseFeedback?.startsWith('pause_signal_sent') ? 'Paused; POSIX signal attempted' : 'Paused'}</Text>
        )}
        {pendingDecisionCount && pendingDecisionCount > 0 ? (
          <Text
            inverse={activeTheme.mode === 'monochrome'}
            backgroundColor={
              activeTheme.mode === 'monochrome'
                ? undefined
                : activeTheme.colors.ask
            }
            color={
              activeTheme.mode === 'monochrome'
                ? undefined
                : activeTheme.mode === 'light'
                ? 'white'
                : 'black'
            }
          >
            {` ${pendingDecisionCount} needs you `}
          </Text>
        ) : null}
      </Box>

      <Box flexShrink={0}>
        <Text color={activeTheme.colors.dim}>
          {formatCompactTimer(totalElapsedMs ?? 0)}
        </Text>
      </Box>
    </Box>
  );
};
