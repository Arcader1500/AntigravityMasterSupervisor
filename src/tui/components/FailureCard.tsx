import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { getFailureDeliveryText, getFailureReasonText, getFailureResolutionText, getFailureSourceText, getTranscriptSegmentProbeText, type TranscriptAnchorProbe } from '../transcript-viewport.js';

export interface FailureCardProps {
  item: Extract<TranscriptItem, { kind: 'FailureCard' }>;
  isFocused?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
  anchorProbe?: TranscriptAnchorProbe;
}

export const FailureCard: React.FC<FailureCardProps> = ({
  item,
  isFocused = true,
  theme,
  glyphs: _glyphs,
  anchorProbe,
}) => {
  const activeTheme = theme ?? resolveTheme();

  if (item.status === 'resolved') {
    const text = anchorProbe?.segmentKey === 'delivery'
      ? getTranscriptSegmentProbeText(item, 'delivery', anchorProbe.sourceOffset) ?? ''
      : getFailureResolutionText(item);
    return (
      <Box>
        <Text color={activeTheme.colors.dim}>{text}</Text>
      </Box>
    );
  }

  const isMonochrome = activeTheme.mode === 'monochrome';
  const headlinePrefix = isMonochrome ? '[!] ' : '';

  const reason = getFailureReasonText(item);
  const segmentText = (segmentKey: string, fallback: string) => anchorProbe?.segmentKey === segmentKey
    ? getTranscriptSegmentProbeText(item, segmentKey, anchorProbe.sourceOffset) ?? ''
    : fallback;
  const sourceText = item.reportSource ? getFailureSourceText(item) : '';
  const deliveryText = item.delivery === 'queued' || item.delivery === 'written' || item.delivery === 'error'
    ? getFailureDeliveryText(item)
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

      <Text color={activeTheme.colors.text}>{segmentText('reason', reason)}</Text>
      {sourceText ? <Text color={activeTheme.colors.dim}>{segmentText('source', sourceText)}</Text> : null}

      {deliveryText ? <Text color={item.delivery === 'written' ? activeTheme.colors.dim : activeTheme.colors.ask}>{segmentText('delivery', deliveryText)}</Text> : null}

      {item.options.map((opt) => {
        const isHighlighted = isFocused !== false && opt.index === item.selectedOptionIndex;
        const optText = `${opt.index}  ${opt.label}`;
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
