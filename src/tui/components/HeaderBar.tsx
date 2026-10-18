import React from 'react';
import { Box, Text } from 'ink';
import type { InputMode } from '../../telemetry/types.js';

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

export interface HeaderBarProps {
  branch: string;
  totalElapsedMs: number;
  status: string;
  inputMode: InputMode;
  waitingForInput: boolean;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  branch,
  totalElapsedMs,
  status,
  inputMode,
  waitingForInput,
}) => {
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
            Total Elapsed: <Text color="yellow">{formatDuration(totalElapsedMs)}</Text>
          </Text>
          <Text color="gray"> │ </Text>
          <Text>
            Status: <Text bold color="green">{status}</Text>
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
};
