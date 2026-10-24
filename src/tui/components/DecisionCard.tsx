import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { getDecisionAnswerText, getDecisionContextText, getDecisionDeliveryText, getTranscriptSegmentProbeText, type TranscriptAnchorProbe } from '../transcript-viewport.js';

export interface DecisionCardProps {
  item: Extract<TranscriptItem, { kind: 'DecisionCard' }>;
  isFocused?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
  anchorProbe?: TranscriptAnchorProbe;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  item,
  isFocused = true,
  theme,
  glyphs: _glyphs,
  anchorProbe,
}) => {
  const activeTheme = theme ?? resolveTheme();

  if (item.status === 'answered') {
    const text = anchorProbe?.segmentKey === 'delivery'
      ? getTranscriptSegmentProbeText(item, 'delivery', anchorProbe.sourceOffset) ?? ''
      : getDecisionAnswerText(item);
    return (
      <Box>
        <Text color={activeTheme.colors.dim}>{text}</Text>
      </Box>
    );
  }

  const isMonochrome = activeTheme.mode === 'monochrome';
  const headlinePrefix = isMonochrome ? '[!] ' : '';

  const segmentText = (segmentKey: string, fallback: string) => anchorProbe?.segmentKey === segmentKey
    ? getTranscriptSegmentProbeText(item, segmentKey, anchorProbe.sourceOffset) ?? ''
    : fallback;
  const contextLine = getDecisionContextText(item);
  const deliveryText = item.delivery === 'queued' || item.delivery === 'written' || item.delivery === 'error'
    ? getDecisionDeliveryText(item)
    : '';

  return (
    <Box
      borderStyle="round"
      borderColor={activeTheme.colors.ask}
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color={activeTheme.colors.ask}>
        {headlinePrefix}{segmentText('headline', item.headline)}
      </Text>

      <Text color={activeTheme.colors.text}>{segmentText('question', item.question)}</Text>

      {contextLine ? (
        <Text color={activeTheme.colors.dim}>{segmentText('contextLine', contextLine)}</Text>
      ) : null}

      {deliveryText ? <Text color={item.delivery === 'written' ? activeTheme.colors.dim : activeTheme.colors.ask}>{segmentText('delivery', deliveryText)}</Text> : null}

      {item.options.map((opt) => {
        const isHighlighted = isFocused !== false && opt.index === item.selectedOptionIndex;
        const recommendedSuffix =
          opt.recommended && !opt.label.toLowerCase().includes('(recommended)')
            ? ' (recommended)'
            : '';
        const optText = `${opt.index}  ${opt.label}${recommendedSuffix}`;

        const segmentKey = `option:${opt.index}`;
        return (
          <Text
            key={opt.index}
            color={isHighlighted ? activeTheme.colors.active : activeTheme.colors.text}
            inverse={isHighlighted && isMonochrome}
          >
            {anchorProbe?.segmentKey === segmentKey
              ? `${opt.index}  ${segmentText(segmentKey, opt.label)}`
              : optText}
          </Text>
        );
      })}
    </Box>
  );
};
