import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { DelegationCard } from './DelegationCard.js';
import { DecisionCard } from './DecisionCard.js';
import { FailureCard } from './FailureCard.js';

export function estimateElementRows(item: TranscriptItem, textWidth: number): number {
  switch (item.kind) {
    case 'UserMessage':
    case 'SupervisorNote':
    case 'PhaseChange':
      return Math.max(1, Math.ceil(item.text.length / textWidth));
    case 'CommitLine':
    case 'QuietCounter':
      return 1;
    case 'DelegationCard':
      if (item.status === 'running' || item.status === 'paused') {
        return 4 + (item.testSummaryText ? 1 : 0);
      }
      return item.status === 'completed_with_concerns' ? 2 : 1;
    case 'DecisionCard':
      if (item.status === 'pending' || item.status === 'deferred') {
        return 4 + (item.contextLine ? 1 : 0) + item.options.length;
      }
      return 1;
    case 'FailureCard':
      if (item.status === 'pending' || item.status === 'deferred') {
        return 4 + item.options.length;
      }
      return 1;
    case 'CompletionCard':
      return 6;
  }
}

export interface CompletionCardProps {
  item: Extract<TranscriptItem, { kind: 'CompletionCard' }>;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export const CompletionCard: React.FC<CompletionCardProps> = ({
  item,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor={activeTheme.colors.done}
        flexDirection="column"
        paddingX={1}
      >
        <Text bold color={activeTheme.colors.done}>
          {`${activeGlyphs.done} Completed on ${item.branchName || 'branch'}`}
        </Text>
        <Text color={activeTheme.colors.text}>
          {`Tasks: ${item.taskCount}   Commits: ${item.commitCount}   Elapsed: ${item.totalElapsedFormatted}`}
        </Text>
        <Text color={activeTheme.colors.text}>
          {`Verifier: ${item.verifierResult}`}
        </Text>
      </Box>
      <Text color={activeTheme.colors.text}>
        Review the branch, then merge when you are ready.
      </Text>
    </Box>
  );
};

export interface TranscriptProps {
  items: TranscriptItem[];
  scrollOffset?: number;
  maxRows?: number;
  maxWidth?: number;
  pendingDecisionCount?: number;
  focusedDecisionId?: string | null;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export const Transcript: React.FC<TranscriptProps> = ({
  items,
  scrollOffset = 0,
  maxRows,
  maxWidth,
  pendingDecisionCount = 0,
  focusedDecisionId = null,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  const textWidth = Math.min(76, Math.max(1, (maxWidth ?? 88) - 12));

  // Determine counts for live delegation cards
  const totalLiveRunning = items.filter(
    (i) =>
      i.kind === 'DelegationCard' &&
      (i.status === 'running' || i.status === 'paused')
  ).length;

  // Determine counts for pending decisions
  const totalPendingDecisions = items.filter(
    (i) =>
      (i.kind === 'DecisionCard' &&
        (i.status === 'pending' || i.status === 'deferred')) ||
      (i.kind === 'FailureCard' &&
        (i.status === 'pending' || i.status === 'deferred'))
  ).length;

  const showPinnedPrompt = scrollOffset > 0 && pendingDecisionCount > 0;

  let liveRunningSeen = 0;
  let pendingDecisionsSeen = 0;

  const renderedEntries: Array<{ element: React.ReactNode; rows: number }> = [];
  const push = (element: React.ReactNode, rows: number) => {
    renderedEntries.push({ element, rows });
  };

  for (const item of items) {
    if (item.kind === 'UserMessage') {
      push(
        <Box key={item.id} flexDirection="row">
          <Box width={12} flexShrink={0}>
            <Text color={activeTheme.colors.dim}>you</Text>
          </Box>
          <Box width={textWidth} flexShrink={0}>
            <Text color={activeTheme.colors.text}>{item.text}</Text>
          </Box>
        </Box>,
        estimateElementRows(item, textWidth)
      );
    } else if (item.kind === 'SupervisorNote' || item.kind === 'PhaseChange') {
      push(
        <Box key={item.id} flexDirection="row">
          <Box width={12} flexShrink={0}>
            <Text color={activeTheme.colors.active}>supervisor</Text>
          </Box>
          <Box width={textWidth} flexShrink={0}>
            <Text color={activeTheme.colors.text}>{item.text}</Text>
          </Box>
        </Box>,
        estimateElementRows(item, textWidth)
      );
    } else if (item.kind === 'CommitLine') {
      push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.done}>
            {`${activeGlyphs.done} ${item.sha}   ${item.message}`}
          </Text>
        </Box>,
        estimateElementRows(item, textWidth)
      );
    } else if (item.kind === 'QuietCounter') {
      push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.dim}>{item.text}</Text>
        </Box>,
        estimateElementRows(item, textWidth)
      );
    } else if (item.kind === 'DelegationCard') {
      const isLive = item.status === 'running' || item.status === 'paused';
      if (isLive) {
        liveRunningSeen++;
        if (liveRunningSeen <= 3) {
          push(
            <DelegationCard
              key={item.id}
              item={item}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />,
            estimateElementRows(item, textWidth)
          );
          if (liveRunningSeen === 3 && totalLiveRunning > 3) {
            push(
              <Box key="more-running">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalLiveRunning - 3} more running`}
                </Text>
              </Box>,
              1
            );
          }
        }
      } else {
        push(
          <DelegationCard
            key={item.id}
            item={item}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />,
          estimateElementRows(item, textWidth)
        );
      }
    } else if (item.kind === 'DecisionCard') {
      if (item.status === 'pending' || item.status === 'deferred') {
        pendingDecisionsSeen++;
        if (pendingDecisionsSeen === 1) {
          const isFocused =
            focusedDecisionId !== null && focusedDecisionId !== undefined
              ? focusedDecisionId === item.id
              : true;

          push(
            <DecisionCard
              key={item.id}
              item={item}
              isFocused={isFocused}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />,
            estimateElementRows(item, textWidth)
          );

          if (totalPendingDecisions > 1) {
            push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>,
              1
            );
          }
        }
      } else {
        push(
          <DecisionCard
            key={item.id}
            item={item}
            isFocused={false}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />,
          estimateElementRows(item, textWidth)
        );
      }
    } else if (item.kind === 'FailureCard') {
      if (item.status === 'pending' || item.status === 'deferred') {
        pendingDecisionsSeen++;
        if (pendingDecisionsSeen === 1) {
          const isFocused =
            focusedDecisionId !== null && focusedDecisionId !== undefined
              ? focusedDecisionId === item.id
              : true;

          push(
            <FailureCard
              key={item.id}
              item={item}
              isFocused={isFocused}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />,
            estimateElementRows(item, textWidth)
          );

          if (totalPendingDecisions > 1) {
            push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>,
              1
            );
          }
        }
      } else {
        push(
          <FailureCard
            key={item.id}
            item={item}
            isFocused={false}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />,
          estimateElementRows(item, textWidth)
        );
      }
    } else if (item.kind === 'CompletionCard') {
      push(
        <CompletionCard
          key={item.id}
          item={item}
          theme={activeTheme}
          glyphs={activeGlyphs}
        />,
        estimateElementRows(item, textWidth)
      );
    }
  }

  // Fit the visible window to maxRows using estimated row heights. Walk back
  // from the scroll position and always include at least one entry so a single
  // tall card never blanks the viewport.
  let visibleEntries = renderedEntries;
  if (maxRows !== undefined && maxRows > 0) {
    const reservedRows = showPinnedPrompt ? 1 : 0;
    const availableRows = Math.max(1, maxRows - reservedRows);
    const totalEntries = renderedEntries.length;
    const maxScroll = Math.max(0, totalEntries - availableRows);
    const safeScrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
    const end = totalEntries - safeScrollOffset;

    let start = end;
    let rowsUsed = 0;
    for (let i = end - 1; i >= 0; i--) {
      const nextRows = rowsUsed + renderedEntries[i].rows;
      if (start < end && nextRows > availableRows) {
        break;
      }
      rowsUsed = nextRows;
      start = i;
    }
    visibleEntries = renderedEntries.slice(start, end);
  }

  return (
    <Box flexDirection="column">
      {visibleEntries.map((entry) => entry.element)}
      {showPinnedPrompt && (
        <Box>
          <Text color={activeTheme.colors.ask}>
            {`${pendingDecisionCount} needs you. Press End to jump to it.`}
          </Text>
        </Box>
      )}
    </Box>
  );
};
