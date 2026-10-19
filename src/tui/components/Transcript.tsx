import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { DelegationCard } from './DelegationCard.js';
import { DecisionCard } from './DecisionCard.js';
import { FailureCard } from './FailureCard.js';

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
      (i.kind === 'FailureCard' && i.status === 'pending')
  ).length;

  let liveRunningSeen = 0;
  let pendingDecisionsSeen = 0;

  const renderedElements: React.ReactNode[] = [];

  for (const item of items) {
    if (item.kind === 'UserMessage') {
      renderedElements.push(
        <Box key={item.id} flexDirection="row">
          <Box width={12} flexShrink={0}>
            <Text color={activeTheme.colors.dim}>you</Text>
          </Box>
          <Box width={textWidth} flexShrink={0}>
            <Text color={activeTheme.colors.text}>{item.text}</Text>
          </Box>
        </Box>
      );
    } else if (item.kind === 'SupervisorNote' || item.kind === 'PhaseChange') {
      renderedElements.push(
        <Box key={item.id} flexDirection="row">
          <Box width={12} flexShrink={0}>
            <Text color={activeTheme.colors.active}>supervisor</Text>
          </Box>
          <Box width={textWidth} flexShrink={0}>
            <Text color={activeTheme.colors.text}>{item.text}</Text>
          </Box>
        </Box>
      );
    } else if (item.kind === 'CommitLine') {
      renderedElements.push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.done}>
            {`${activeGlyphs.done} ${item.sha}   ${item.message}`}
          </Text>
        </Box>
      );
    } else if (item.kind === 'QuietCounter') {
      renderedElements.push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.dim}>{item.text}</Text>
        </Box>
      );
    } else if (item.kind === 'DelegationCard') {
      const isLive = item.status === 'running' || item.status === 'paused';
      if (isLive) {
        liveRunningSeen++;
        if (liveRunningSeen <= 3) {
          renderedElements.push(
            <DelegationCard
              key={item.id}
              item={item}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />
          );
          if (liveRunningSeen === 3 && totalLiveRunning > 3) {
            renderedElements.push(
              <Box key="more-running">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalLiveRunning - 3} more running`}
                </Text>
              </Box>
            );
          }
        }
      } else {
        renderedElements.push(
          <DelegationCard
            key={item.id}
            item={item}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />
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

          renderedElements.push(
            <DecisionCard
              key={item.id}
              item={item}
              isFocused={isFocused}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />
          );

          if (totalPendingDecisions > 1) {
            renderedElements.push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>
            );
          }
        }
      } else {
        renderedElements.push(
          <DecisionCard
            key={item.id}
            item={item}
            isFocused={false}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />
        );
      }
    } else if (item.kind === 'FailureCard') {
      if (item.status === 'pending') {
        pendingDecisionsSeen++;
        if (pendingDecisionsSeen === 1) {
          const isFocused =
            focusedDecisionId !== null && focusedDecisionId !== undefined
              ? focusedDecisionId === item.id
              : true;

          renderedElements.push(
            <FailureCard
              key={item.id}
              item={item}
              isFocused={isFocused}
              theme={activeTheme}
              glyphs={activeGlyphs}
            />
          );

          if (totalPendingDecisions > 1) {
            renderedElements.push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>
            );
          }
        }
      } else {
        renderedElements.push(
          <FailureCard
            key={item.id}
            item={item}
            isFocused={false}
            theme={activeTheme}
            glyphs={activeGlyphs}
          />
        );
      }
    } else if (item.kind === 'CompletionCard') {
      renderedElements.push(
        <CompletionCard
          key={item.id}
          item={item}
          theme={activeTheme}
          glyphs={activeGlyphs}
        />
      );
    }
  }

  // Handle maxRows and scrollOffset slicing if maxRows is defined
  let visibleElements = renderedElements;
  if (maxRows !== undefined && maxRows > 0 && renderedElements.length > maxRows) {
    const end = Math.max(0, renderedElements.length - scrollOffset);
    const start = Math.max(0, end - maxRows);
    visibleElements = renderedElements.slice(start, end);
  }

  const showPinnedPrompt = scrollOffset > 0 && pendingDecisionCount > 0;

  return (
    <Box flexDirection="column">
      {visibleElements}
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
