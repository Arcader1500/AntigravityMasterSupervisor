import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface DelegationCardProps {
  item: Extract<TranscriptItem, { kind: 'DelegationCard' }>;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export const DelegationCard: React.FC<DelegationCardProps> = ({
  item,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (item.status !== 'running' || activeTheme.noMotion) {
      return;
    }
    const timer = setInterval(() => {
      setFrameIdx((idx) => (idx + 1) % activeGlyphs.spinnerFrames.length);
    }, 250);
    return () => clearInterval(timer);
  }, [item.status, activeTheme.noMotion, activeGlyphs.spinnerFrames.length]);

  if (item.status === 'completed' || item.status === 'completed_with_concerns') {
    const commitSuffix = item.commitSha ? `  ${item.commitSha}` : '';
    const mainLine = `${activeGlyphs.done} Task ${item.taskNumber}: ${item.title}${commitSuffix}`;
    const secondLine =
      item.status === 'completed_with_concerns'
        ? item.nextStepText || 'Finished with concerns. Reviewer will check.'
        : null;

    return (
      <Box flexDirection="column">
        <Text color={activeTheme.colors.done}>{mainLine}</Text>
        {secondLine && <Text color={activeTheme.colors.dim}>{secondLine}</Text>}
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
            {`Task ${item.taskNumber}: ${item.title}`}
          </Text>
        </Box>
        {rightMeta ? <Text color={activeTheme.colors.dim}>{rightMeta}</Text> : null}
      </Box>

      {item.nowSentence ? (
        <Text color={activeTheme.colors.text}>{item.nowSentence}</Text>
      ) : null}

      {item.testSummaryText ? (
        <Text color={activeTheme.colors.text}>{item.testSummaryText}</Text>
      ) : null}

      {item.nextStepText ? (
        <Text color={activeTheme.colors.text}>{item.nextStepText}</Text>
      ) : null}
    </Box>
  );
};
