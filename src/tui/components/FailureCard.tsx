import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface FailureCardProps {
  item: Extract<TranscriptItem, { kind: 'FailureCard' }>;
  isFocused?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export const FailureCard: React.FC<FailureCardProps> = ({
  item,
  isFocused = true,
  theme,
  glyphs: _glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();

  if (item.status === 'resolved') {
    const resolved = item.resolvedText ?? '';
    const text = resolved.endsWith('.') ? resolved : `${resolved}.`;
    return (
      <Box>
        <Text color={activeTheme.colors.dim}>You chose: {text}</Text>
      </Box>
    );
  }

  const isMonochrome = activeTheme.mode === 'monochrome';
  const headlinePrefix = isMonochrome ? '[!] ' : '';

  const isFallbackReason = item.reason.endsWith(
    'Open the agent to read its last output.'
  );
  const reason =
    isFallbackReason || (item.reason.startsWith('"') && item.reason.endsWith('"'))
      ? item.reason
      : `"${item.reason}"`;

  return (
    <Box
      borderStyle="round"
      borderColor={activeTheme.colors.ask}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color={activeTheme.colors.ask}>
        {headlinePrefix}{item.headline}
      </Text>

      <Text color={activeTheme.colors.text}>{reason}</Text>

      {item.options.map((opt) => {
        const isHighlighted = isFocused !== false && opt.index === item.selectedOptionIndex;
        const optText = `${opt.index}  ${opt.label}`;

        return (
          <Text
            key={opt.index}
            color={isHighlighted ? activeTheme.colors.active : activeTheme.colors.text}
            inverse={isHighlighted && isMonochrome}
          >
            {optText}
          </Text>
        );
      })}
    </Box>
  );
};
