import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { getTranscriptSegmentProbeText, type TranscriptAnchorProbe } from '../transcript-viewport.js';

export interface DelegationCardProps {
  item: Extract<TranscriptItem, { kind: 'DelegationCard' }>;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
  anchorProbe?: TranscriptAnchorProbe;
}

export const DelegationCard: React.FC<DelegationCardProps> = ({
  item,
  theme,
  glyphs,
  anchorProbe,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (anchorProbe || item.status !== 'running' || activeTheme.noMotion) {
      return;
    }
    const timer = setInterval(() => {
      setFrameIdx((idx) => (idx + 1) % activeGlyphs.spinnerFrames.length);
    }, 250);
    return () => clearInterval(timer);
  }, [anchorProbe, item.status, activeTheme.noMotion, activeGlyphs.spinnerFrames.length]);

  const prefix = (key: string, fallback: string, leading = '') => anchorProbe?.segmentKey === key
    ? `${leading}${getTranscriptSegmentProbeText(item, key, anchorProbe.sourceOffset) ?? ''}`
    : fallback;

  if (item.status === 'completed' || item.status === 'completed_with_concerns') {
    const commitSuffix = item.commitSha ? `  ${item.commitSha}` : '';
    const source = item.reportSource === 'artifacts' ? 'artifacts' : item.reportSource === 'ledger' ? 'recorded ledger' : 'agent output';
    const mainLine = `• Task ${item.taskNumber}: ${item.title}${commitSuffix}`;
    const secondLine =
      `${item.role} reported ${item.reportedVerdict ?? (item.status === 'completed_with_concerns' ? 'DONE_WITH_CONCERNS' : 'completion')} (${source}); review and verification are unconfirmed.`;

    return (
      <Box flexDirection="column">
        <Text color={activeTheme.colors.text}>{prefix('title', mainLine, `• Task ${item.taskNumber}: `)}</Text>
        <Text color={activeTheme.colors.dim}>{prefix('report', secondLine)}</Text>
        {item.nextStepText && <Text color={activeTheme.colors.dim}>{prefix('nextStepText', item.nextStepText)}</Text>}
      </Box>
    );
  }

  let glyph: string;
  if (item.status === 'paused') {
    glyph = activeGlyphs.paused;
  } else if (activeTheme.noMotion) {
    glyph = activeGlyphs.running;
  } else {
    glyph = activeGlyphs.spinnerFrames[frameIdx % activeGlyphs.spinnerFrames.length];
  }

  let rightMeta = '';
  if (item.wave !== undefined && item.totalWaves !== undefined) {
    rightMeta = `wave ${item.wave} of ${item.totalWaves}`;
  } else if (item.totalTasks !== undefined) {
    rightMeta = `task ${item.taskNumber} of ${item.totalTasks}`;
  }

  return (
    <Box
      borderStyle="round"
      borderColor={activeTheme.colors.line}
      flexDirection="column"
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text
            color={
              item.status === 'paused'
                ? activeTheme.colors.ask
                : activeTheme.colors.active
            }
          >
            {`${glyph} `}
          </Text>
          <Text bold color={activeTheme.colors.text}>
            {prefix('title', `Task ${item.taskNumber}: ${item.title}`, `Task ${item.taskNumber}: `)}
          </Text>
        </Box>
        {rightMeta ? <Text color={activeTheme.colors.dim}>{rightMeta}</Text> : null}
      </Box>

      {item.nowSentence ? (
        <Text color={activeTheme.colors.text}>{prefix('nowSentence', item.nowSentence)}</Text>
      ) : null}

      {item.testSummaryText ? (
        <Text color={activeTheme.colors.text}>{prefix('testSummaryText', item.testSummaryText)}</Text>
      ) : null}

      {item.nextStepText ? (
        <Text color={activeTheme.colors.text}>{prefix('nextStepText', item.nextStepText)}</Text>
      ) : null}
    </Box>
  );
};
