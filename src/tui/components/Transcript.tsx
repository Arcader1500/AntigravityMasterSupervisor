import React, { useLayoutEffect, useRef, useState } from 'react';
import { PassThrough, Writable } from 'node:stream';
import { Box, Text, measureElement, render as renderInk } from 'ink';
import type { TranscriptItem } from '../narrator.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';
import { COMPLETION_NEXT_STEPS_NOTE } from '../narrator-copy.js';
import { DelegationCard } from './DelegationCard.js';
import { DecisionCard } from './DecisionCard.js';
import { FailureCard } from './FailureCard.js';
import {
  clampTranscriptViewportRow,
  getTranscriptAnchorMeasurementKey,
  getTranscriptSegments,
  resolveTranscriptViewportAnchor,
  getTranscriptWindow,
  sameTranscriptMeasurements,
  transcriptSourceLength,
  type TranscriptItemMeasurement,
  type TranscriptViewportAnchor,
  type TranscriptViewportMetrics,
  type TranscriptAnchorProbe,
  TRANSCRIPT_ANCHOR_MARKER,
  markTranscriptTextAtOffset,
} from '../transcript-viewport.js';

interface CaptureSearch {
  key: string;
  itemId: string;
  segmentKey: string;
  low: number;
  high: number;
  offset: number;
}

interface CapturedAnchor {
  key: string;
  anchor: TranscriptViewportAnchor;
}

function renderAnchorMarkerRow(element: React.ReactElement, width: number): number | undefined {
  let output = '';
  const stdout = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const stdin = new PassThrough();
  Object.assign(stdout, { columns: Math.max(1, width), rows: 1000, isTTY: false, getColorDepth: () => 0 });
  let instance: ReturnType<typeof renderInk> | undefined;
  try {
    instance = renderInk(element, {
      stdout: stdout as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stderr as NodeJS.WriteStream,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    const marker = output.indexOf(TRANSCRIPT_ANCHOR_MARKER);
    return marker < 0 ? undefined : output.slice(0, marker).split('\n').length - 1;
  } finally {
    instance?.unmount();
    instance?.cleanup();
    stdin.destroy();
    stderr.destroy();
    stdout.destroy();
  }
}

function cachedAnchorMarkerRow(
  cache: Map<string, number>,
  key: string,
  element: React.ReactElement,
  width: number
): number | undefined {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const row = renderAnchorMarkerRow(element, width);
  if (row !== undefined) {
    cache.set(key, row);
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  return row;
}

function markFirstTextChild(node: React.ReactNode, text: string, markedText: string): React.ReactNode {
  let found = false;
  const visit = (child: React.ReactNode): React.ReactNode => {
    if (!found && typeof child === 'string' && child === text) {
      found = true;
      return markedText;
    }
    if (!React.isValidElement(child)) return child;
    const children = React.Children.map(child.props.children, visit);
    return found ? React.cloneElement(child, undefined, children) : child;
  };
  return visit(node);
}

export interface CompletionCardProps {
  item: Extract<TranscriptItem, { kind: 'CompletionCard' }>;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
  anchorProbe?: TranscriptAnchorProbe;
}

export const CompletionCard: React.FC<CompletionCardProps> = ({
  item,
  theme,
  anchorProbe,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const segmentText = (key: string, text: string) => anchorProbe?.segmentKey === key
    ? markTranscriptTextAtOffset(text, anchorProbe.sourceOffset)
    : text;

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor={activeTheme.colors.line}
        flexDirection="column"
        paddingX={1}
      >
        <Text bold color={activeTheme.colors.text}>
          {segmentText('legacyStatus', `Legacy ledger status: COMPLETED on ${item.branchName || 'branch'}`)}
        </Text>
        <Text color={activeTheme.colors.dim}>
          {segmentText('recordedCounts', `Recorded counts: ${item.taskCount} tasks   ${item.commitCount} commits   ${item.totalElapsedFormatted} elapsed`)}
        </Text>
        <Text color={activeTheme.colors.text}>
          {segmentText('verifierResult', `Recorded verifier text (unverified): ${item.verifierResult}`)}
        </Text>
      </Box>
      <Text color={activeTheme.colors.dim}>{segmentText('source', 'Source: recorded ledger.')}</Text>
      <Text color={activeTheme.colors.dim}>
        {segmentText('reviewStatus', COMPLETION_NEXT_STEPS_NOTE)}
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
  onViewportMetrics?: (metrics: TranscriptViewportMetrics) => void;
  anchor?: TranscriptViewportAnchor;
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
  onViewportMetrics,
  anchor,
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

  const renderedEntries: Array<{ element: React.ReactNode; itemId: string }> = [];
  const push = (element: React.ReactNode) => {
    const itemId = React.isValidElement(element) && element.key != null
      ? String(element.key)
      : `entry-${renderedEntries.length}`;
    renderedEntries.push({ element, itemId });
  };

  const itemNodes = useRef(new Map<string, React.ElementRef<typeof Box>>());
  const hintNode = useRef<React.ElementRef<typeof Box>>(null);
  const anchorProbeRequest = useRef('');
  const captureStartRequest = useRef('');
  const captureOffsetRequest = useRef('');
  const anchorProbeCache = useRef(new Map<string, number>());
  const [captureItemStarts, setCaptureItemStarts] = useState<{ key: string; starts: Array<{ segmentKey: string; row: number; length: number }> }>();
  const [captureItemOffset, setCaptureItemOffset] = useState<{ key: string; row: number }>();
  const mounted = useRef(true);
  const [measurements, setMeasurements] = useState<TranscriptItemMeasurement[]>([]);
  const [measuredHintRows, setMeasuredHintRows] = useState(1);
  const [measuredAnchor, setMeasuredAnchor] = useState<{ key: string; row: number }>();
  const measurementsCurrent = useRef(false);
  const [captureSearch, setCaptureSearch] = useState<CaptureSearch>();
  const [capturedAnchor, setCapturedAnchor] = useState<CapturedAnchor>();

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
      );
    } else if (item.kind === 'CommitLine') {
      push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.done}>
            {`${activeGlyphs.done} ${item.sha}   ${item.message}`}
          </Text>
        </Box>,
      );
    } else if (item.kind === 'QuietCounter') {
      push(
        <Box key={item.id}>
          <Text color={activeTheme.colors.dim}>{item.text}</Text>
        </Box>,
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
          );
          if (liveRunningSeen === 3 && totalLiveRunning > 3) {
            push(
              <Box key="more-running">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalLiveRunning - 3} more running`}
                </Text>
              </Box>
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
          );

          if (totalPendingDecisions > 1) {
            push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>
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
          );

          if (totalPendingDecisions > 1) {
            push(
              <Box key="more-waiting">
                <Text color={activeTheme.colors.dim}>
                  {`+${totalPendingDecisions - 1} more waiting`}
                </Text>
              </Box>
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
      );
    }
  }

  const hintRows = showPinnedPrompt ? measuredHintRows : 0;

  useLayoutEffect(() => {
    const next: TranscriptItemMeasurement[] = [];
    let startRow = 0;
    let allItemsMeasured = true;
    for (const entry of renderedEntries) {
      const node = itemNodes.current.get(entry.itemId);
      const height = node ? measureElement(node).height : 0;
      const width = node ? measureElement(node).width : 0;
      if (height > 0) {
        next.push({ itemId: entry.itemId, startRow, height, width });
        startRow += height;
      } else {
        allItemsMeasured = false;
      }
    }
    const same = sameTranscriptMeasurements(measurements, next);
    measurementsCurrent.current = allItemsMeasured && same;
    if (!same) setMeasurements(next);
  });

  useLayoutEffect(() => {
    if (!showPinnedPrompt || !hintNode.current) return;
    const height = measureElement(hintNode.current).height;
    if (height > 0 && height !== measuredHintRows) setMeasuredHintRows(height);
  });

  const contentTotalRows = measurements.reduce((sum, item) => sum + item.height, 0);
  const contentWindow = getTranscriptWindow(contentTotalRows, maxRows ?? contentTotalRows, scrollOffset, hintRows);
  const targetMeasurement = measurements.find((item) => contentWindow.startRow >= item.startRow && contentWindow.startRow < item.startRow + item.height)
    ?? measurements[measurements.length - 1];
  const targetItem = targetMeasurement ? items.find((item) => item.id === targetMeasurement.itemId) : undefined;
  const targetText = targetItem ? getTranscriptSegments(targetItem).map((segment) => segment.text).join('\u0000') : '';
  const captureKey = targetMeasurement && targetItem
    ? `${targetMeasurement.itemId}:${contentWindow.startRow}:${targetMeasurement.width}:${targetMeasurement.height}:${targetText}:${JSON.stringify(targetItem)}:${activeTheme.mode}:${activeGlyphs.running}:${activeGlyphs.paused}`
    : '';
  const activeAnchor = anchor ?? (captureSearch?.key === captureKey
    ? { itemId: captureSearch.itemId, segmentKey: captureSearch.segmentKey, sourceOffset: captureSearch.offset, viewportRow: 0 }
    : capturedAnchor?.key === captureKey ? capturedAnchor.anchor : undefined);
  const resolvedAnchor = anchor
    ? resolveTranscriptViewportAnchor(anchor, items, measurements, measuredAnchor?.row)
    : activeAnchor;
  const anchorItem = resolvedAnchor ? items.find((item) => item.id === resolvedAnchor.itemId) : undefined;
  const anchorItemMeasurement = resolvedAnchor
    ? measurements.find((item) => item.itemId === resolvedAnchor.itemId)
    : undefined;
  const anchorProbeWidth = Math.max(1, anchorItemMeasurement?.width ?? maxWidth ?? 88);
  const anchorLayoutSignature = anchorItem ? JSON.stringify(anchorItem) : undefined;
  const anchorMeasurementKey = resolvedAnchor && anchorLayoutSignature !== undefined
    ? getTranscriptAnchorMeasurementKey(resolvedAnchor, anchorItemMeasurement, `${anchorLayoutSignature}\u0000${activeTheme.mode}\u0000${activeGlyphs.running}\u0000${activeGlyphs.paused}`, anchorProbeWidth)
    : undefined;
  const anchorRow = anchorMeasurementKey && measuredAnchor?.key === anchorMeasurementKey
    ? measuredAnchor.row
    : undefined;

  const probeItemElement = (item: TranscriptItem, probe: TranscriptAnchorProbe): React.ReactElement | undefined => {
    const entry = renderedEntries.find((candidate) => candidate.itemId === item.id);
    if (!entry || !React.isValidElement(entry.element)) return undefined;
    if (item.kind === 'DecisionCard' || item.kind === 'FailureCard' || item.kind === 'DelegationCard' || item.kind === 'CompletionCard') {
      return React.cloneElement(entry.element as React.ReactElement<Record<string, unknown>>, { anchorProbe: probe });
    }
    const segment = getTranscriptSegments(item).find((candidate) => candidate.segmentKey === probe.segmentKey);
    if (!segment) return undefined;
    let displayText = segment.displayText ?? `${segment.leadingText ?? ''}${segment.text}`;
    let displayOffset = probe.sourceOffset + transcriptSourceLength(segment.leadingText ?? '');
    if (item.kind === 'CommitLine' && probe.segmentKey === 'line') {
      displayText = `${activeGlyphs.done} ${item.sha}   ${item.message}`;
      const sourceLeadLength = transcriptSourceLength('✓ ');
      const displayLeadLength = transcriptSourceLength(`${activeGlyphs.done} `);
      displayOffset = probe.sourceOffset < sourceLeadLength
        ? 0
        : displayLeadLength + probe.sourceOffset - sourceLeadLength;
    }
    const markedText = markTranscriptTextAtOffset(displayText, displayOffset);
    return markFirstTextChild(entry.element, displayText, markedText) as React.ReactElement;
  };

  useLayoutEffect(() => {
    if (!resolvedAnchor || !anchorItem || !anchorMeasurementKey) return;
    const itemStart = measurements.find((item) => item.itemId === resolvedAnchor.itemId)?.startRow ?? 0;
    const probeElement = probeItemElement(anchorItem, resolvedAnchor);
    if (probeElement) {
      const activeProbeKey = `active:${anchorMeasurementKey}`;
      const cachedRow = anchorProbeCache.current.get(activeProbeKey);
      if (cachedRow !== undefined) {
        const nextRow = itemStart + cachedRow;
        if (measuredAnchor?.key !== anchorMeasurementKey || measuredAnchor.row !== nextRow) setMeasuredAnchor({ key: anchorMeasurementKey, row: nextRow });
      } else if (anchorProbeRequest.current !== anchorMeasurementKey) {
        anchorProbeRequest.current = anchorMeasurementKey;
        queueMicrotask(() => {
          if (!mounted.current || anchorProbeRequest.current !== anchorMeasurementKey) return;
          const row = cachedAnchorMarkerRow(anchorProbeCache.current, activeProbeKey, probeElement, anchorProbeWidth);
          if (!mounted.current || anchorProbeRequest.current !== anchorMeasurementKey || row === undefined) return;
          setMeasuredAnchor({ key: anchorMeasurementKey, row: itemStart + row });
        });
      }
      return;
    }
  });

  useLayoutEffect(() => {
    if (anchor || !targetItem || !targetMeasurement || !captureKey || capturedAnchor?.key === captureKey) return;
    if (captureSearch?.key !== captureKey) {
      if (captureItemStarts?.key !== captureKey) {
        if (captureStartRequest.current !== captureKey) {
          captureStartRequest.current = captureKey;
          queueMicrotask(() => {
            if (!mounted.current || captureStartRequest.current !== captureKey) return;
            const starts = getTranscriptSegments(targetItem).flatMap((segment) => {
              const element = probeItemElement(targetItem, { segmentKey: segment.segmentKey, sourceOffset: 0 });
              const row = element ? cachedAnchorMarkerRow(anchorProbeCache.current, `capture-start:${captureKey}:${segment.segmentKey}`, element, targetMeasurement.width) : undefined;
              return row === undefined ? [] : [{ segmentKey: segment.segmentKey, row: targetMeasurement.startRow + row, length: transcriptSourceLength(segment.text) }];
            });
            if (mounted.current && captureStartRequest.current === captureKey) setCaptureItemStarts({ key: captureKey, starts });
          });
        }
        return;
      }
      const starts = captureItemStarts!.starts;
      const candidate = starts.filter((segment) => segment.length > 0 && segment.row <= contentWindow.startRow).at(-1)
        ?? starts.find((segment) => segment.length > 0);
      if (candidate) setCaptureSearch({
        key: captureKey,
        itemId: targetItem.id,
        segmentKey: candidate.segmentKey,
        low: 0,
        high: candidate.length,
        offset: Math.floor(candidate.length / 2),
      });
      return;
    }
    const itemStart = targetMeasurement.startRow;
    const probeElement = probeItemElement(targetItem, { segmentKey: captureSearch.segmentKey, sourceOffset: captureSearch.offset });
    const offsetProbeKey = `${captureKey}:${captureSearch.segmentKey}:${captureSearch.offset}`;
    if (captureItemOffset?.key !== offsetProbeKey) {
      if (captureOffsetRequest.current !== offsetProbeKey) {
        captureOffsetRequest.current = offsetProbeKey;
        queueMicrotask(() => {
          if (!mounted.current || captureOffsetRequest.current !== offsetProbeKey) return;
          const row = probeElement ? cachedAnchorMarkerRow(anchorProbeCache.current, `capture-offset:${offsetProbeKey}`, probeElement, targetMeasurement.width) : undefined;
          if (mounted.current && captureOffsetRequest.current === offsetProbeKey && row !== undefined) setCaptureItemOffset({ key: offsetProbeKey, row });
        });
      }
      return;
    }
    const measuredRow = captureItemOffset!.row;
    if (measuredRow === undefined) return;
    const row = itemStart + measuredRow;
    const low = row < contentWindow.startRow ? captureSearch.offset + 1 : captureSearch.low;
    const high = row >= contentWindow.startRow ? captureSearch.offset : captureSearch.high;
    if (high - low <= 1) {
      setCapturedAnchor({ key: captureKey, anchor: { itemId: targetItem.id, segmentKey: captureSearch.segmentKey, sourceOffset: high, viewportRow: 0 } });
      setCaptureSearch(undefined);
    } else {
      setCaptureSearch({ ...captureSearch, low, high, offset: Math.floor((low + high) / 2) });
    }
  });

  useLayoutEffect(() => {
    if (!onViewportMetrics) return;
    // A width/content change first produces stale dimensions. Wait for the measured
    // item rows and matching anchor probe before publishing coordinates to the owner.
    if (!measurementsCurrent.current || (resolvedAnchor && anchorRow === undefined)) return;
    const metrics: TranscriptViewportMetrics = {
      ...contentWindow,
      items: measurements,
      segments: resolvedAnchor && anchorRow !== undefined
        ? [{ itemId: resolvedAnchor.itemId, segmentKey: resolvedAnchor.segmentKey, sourceOffset: resolvedAnchor.sourceOffset, row: anchorRow }]
        : [],
      ...(resolvedAnchor && anchorRow !== undefined ? {
        anchor: { ...resolvedAnchor, viewportRow: clampTranscriptViewportRow(resolvedAnchor.viewportRow, contentWindow.visibleRows) },
      } : {}),
    };
    onViewportMetrics(metrics);
  }, [contentWindow.totalRows, contentWindow.visibleRows, contentWindow.clampedOffset, contentWindow.startRow, measurements, resolvedAnchor?.itemId, resolvedAnchor?.segmentKey, resolvedAnchor?.sourceOffset, resolvedAnchor?.viewportRow, anchorRow, onViewportMetrics]);

  return (
    <Box flexDirection="column">
      {maxRows !== undefined ? (
        <Box height={contentWindow.visibleRows} overflowY="hidden" flexShrink={0}>
          <Box flexDirection="column" flexShrink={0} marginTop={-contentWindow.startRow}>
            {renderedEntries.map((entry) => (
              <Box key={entry.itemId} flexDirection="column" flexShrink={0} ref={(node) => {
                if (node) itemNodes.current.set(entry.itemId, node);
                else itemNodes.current.delete(entry.itemId);
              }}>{entry.element}</Box>
            ))}
          </Box>
        </Box>
      ) : renderedEntries.map((entry) => (
        <Box key={entry.itemId} flexDirection="column" flexShrink={0} ref={(node) => {
          if (node) itemNodes.current.set(entry.itemId, node);
          else itemNodes.current.delete(entry.itemId);
        }}>{entry.element}</Box>
      ))}
      {showPinnedPrompt && <Box ref={hintNode} width={maxWidth}><Text color={activeTheme.colors.ask}>{`${pendingDecisionCount} needs you. Press End to jump to it.`}</Text></Box>}
    </Box>
  );
};
