import React from 'react';
import { Box, Text } from 'ink';
import type { InputMode } from '../../telemetry/types.js';

export interface LivePtyViewProps {
  lines: string[];
  inputMode: InputMode;
  mainAgent: string;
  pid?: number;
  maxRows?: number;
}

export const LivePtyView: React.FC<LivePtyViewProps> = ({
  lines,
  inputMode,
  mainAgent,
  pid,
  maxRows = 24,
}) => {
  const isInteract = inputMode === 'PTY_INTERACT';
  const borderColor = isInteract ? 'green' : 'cyan';

  const effectiveMaxRows = maxRows > 0 ? maxRows : 24;
  const visibleLines =
    lines.length > effectiveMaxRows ? lines.slice(-effectiveMaxRows) : lines;

  const isEmpty =
    visibleLines.length === 0 ||
    visibleLines.every((line) => line.trim() === '');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {/* Top Banner: Mode badge & PID/Agent info */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={isInteract ? 'green' : 'cyan'}>
          {isInteract ? '● PTY INTERACT' : '○ NAVIGATION'}
        </Text>
        <Text color="gray">
          Agent: <Text color="white" bold>{mainAgent}</Text>
          {pid !== undefined ? (
            <Text color="gray">
              {' | PID: '}
              <Text color="white">{pid}</Text>
            </Text>
          ) : null}
        </Text>
      </Box>

      {/* Mode hint line */}
      <Box marginBottom={1}>
        {isInteract ? (
          <Text bold color="green">
            INTERACTING WITH AGY — Press [Ctrl+]] to return to Supervisor TUI
          </Text>
        ) : (
          <Text color="cyan">
            Press [i] or [Enter] to interact with agy terminal
          </Text>
        )}
      </Box>

      {/* Terminal Viewport */}
      {isEmpty ? (
        <Box paddingY={1}>
          <Text color="gray">
            (No terminal output yet)
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {visibleLines.map((line, idx) => (
            <Text key={idx}>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default LivePtyView;
