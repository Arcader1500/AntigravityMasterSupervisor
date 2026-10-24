import React from 'react';
import { Box, Text } from 'ink';
import { resolveTheme, type ThemeConfig } from '../theme.js';

export interface TakeoverViewProps {
  lines: string[];
  maxRows?: number;
  theme?: ThemeConfig;
  showBanner?: boolean;
}

export const TakeoverView: React.FC<TakeoverViewProps> = ({
  lines,
  maxRows = 24,
  theme,
  showBanner = true,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const effectiveMaxRows = maxRows > 0 ? maxRows : 24;
  const visibleLines =
    lines.length > effectiveMaxRows ? lines.slice(-effectiveMaxRows) : lines;

  return (
    <Box flexDirection="column" paddingX={1}>
      {showBanner && (
        <Box marginBottom={1}>
          <Text color={activeTheme.colors.ask}>
            You are typing into the agent's terminal. Press Ctrl+] to return.
          </Text>
        </Box>
      )}

      {visibleLines.length === 0 ? (
        <Text color={activeTheme.colors.dim}>(No terminal output yet)</Text>
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

export default TakeoverView;
