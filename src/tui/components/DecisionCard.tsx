import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface DecisionCardProps {
  item: Extract<TranscriptItem, { kind: 'DecisionCard' }>;
  isFocused?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  item,
  isFocused = true,
  theme,
  glyphs: _glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();

  if (item.status === 'answered') {
    const answered = item.answeredText ?? '';
    const text = answered.endsWith('.') ? answered : `${answered}.`;
    return (
      <Box>
        <Text color={activeTheme.colors.dim}>You chose: {text}</Text>
      </Box>
    );
  }

  const isMonochrome = activeTheme.mode === 'monochrome';
  const headlinePrefix = isMonochrome ? '[!] ' : '';

  let contextLine = item.contextLine;
  if (contextLine) {
    if (!contextLine.startsWith('I checked first')) {
      contextLine = `I checked first: ${contextLine}`;
    }
  }

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

      <Text color={activeTheme.colors.text}>{item.question}</Text>

      {contextLine ? (
        <Text color={activeTheme.colors.dim}>{contextLine}</Text>
      ) : null}

      {item.options.map((opt) => {
        const isHighlighted = isFocused !== false && opt.index === item.selectedOptionIndex;
        const recommendedSuffix =
          opt.recommended && !opt.label.toLowerCase().includes('(recommended)')
            ? ' (recommended)'
            : '';
        const optText = `${opt.index}  ${opt.label}${recommendedSuffix}`;

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
