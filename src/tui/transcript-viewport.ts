import type { TranscriptItem } from './narrator.js';
import { COMPLETION_NEXT_STEPS_NOTE } from './narrator-copy.js';

export interface TranscriptWindow {
  totalRows: number;
  visibleRows: number;
  clampedOffset: number;
  startRow: number;
}

export interface TranscriptViewportAnchor {
  itemId: string;
  /** Stable field key from getTranscriptSegments; sourceOffset counts grapheme clusters in that field. */
  segmentKey: string;
  sourceOffset: number;
  viewportRow: number;
}

export interface TranscriptItemMeasurement {
  itemId: string;
  startRow: number;
  height: number;
  width: number;
}

export interface TranscriptSegmentMeasurement {
  itemId: string;
  segmentKey: string;
  sourceOffset: number;
  row: number;
}

export interface TranscriptViewportMetrics extends TranscriptWindow {
  items: TranscriptItemMeasurement[];
  segments: TranscriptSegmentMeasurement[];
  anchor?: TranscriptViewportAnchor;
}

export interface TranscriptTextSegment {
  segmentKey: string;
  text: string;
  leadingText?: string;
  displayText?: string;
}

export interface TranscriptAnchorProbe {
  segmentKey: string;
  sourceOffset: number;
}

export const TRANSCRIPT_ANCHOR_MARKER = '\u001b[999m';
export const TRANSCRIPT_ANCHOR_MARKER_RESET = '\u001b[0m';

export function markTranscriptTextAtOffset(text: string, sourceOffset: number): string {
  const graphemes = Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
  const offset = Math.max(0, Math.min(graphemes.length, Math.floor(Number.isFinite(sourceOffset) ? sourceOffset : 0)));
  const prefix = graphemes.slice(0, offset).join('');
  const target = graphemes[offset] ?? '\u200b';
  const suffix = graphemes.slice(offset + (offset < graphemes.length ? 1 : 0)).join('');
  return `${prefix}${TRANSCRIPT_ANCHOR_MARKER}\u200b${target}${TRANSCRIPT_ANCHOR_MARKER_RESET}${suffix}`;
}

/** Identifies the exact rendered layout used to measure an anchor prefix. */
export function getTranscriptAnchorMeasurementKey(
  anchor: TranscriptViewportAnchor,
  measurement: TranscriptItemMeasurement | undefined,
  prefix: string,
  probeWidth: number
): string | undefined {
  if (!measurement) return undefined;
  return [
    anchor.itemId,
    anchor.segmentKey,
    anchor.sourceOffset,
    measurement.startRow,
    measurement.height,
    measurement.width,
    probeWidth,
    prefix,
  ].join('\u0000');
}

export function clampTranscriptViewportRow(row: number, visibleRows: number): number {
  const rows = Math.max(0, Math.floor(Number.isFinite(visibleRows) ? visibleRows : 0));
  const requested = Math.floor(Number.isFinite(row) ? row : 0);
  return Math.max(0, Math.min(Math.max(0, rows - 1), requested));
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function transcriptSourceLength(text: string): number {
  return Array.from(graphemeSegmenter.segment(text)).length;
}

export function getDecisionContextText(item: Extract<TranscriptItem, { kind: 'DecisionCard' }>): string {
  if (!item.contextLine) return '';
  return item.contextLine.startsWith('I checked first') ? item.contextLine : `I checked first: ${item.contextLine}`;
}

export function getDecisionDeliveryText(item: Extract<TranscriptItem, { kind: 'DecisionCard' }>): string {
  if (item.delivery === 'queued') return 'Response queued locally; agent acceptance is unconfirmed.';
  if (item.delivery === 'written') return 'Input write callback returned; agent acceptance is unconfirmed.';
  return `Input delivery error: ${item.deliveryError ?? 'delivery is unknown'}; agent acceptance is unconfirmed.`;
}

export function getDecisionAnswerText(item: Extract<TranscriptItem, { kind: 'DecisionCard' }>): string {
  const answer = item.answeredText ?? '';
  const text = answer.endsWith('.') ? answer : `${answer}.`;
  return `Input sent: ${text} Agent acceptance is unconfirmed.`;
}

export function getFailureReasonText(item: Extract<TranscriptItem, { kind: 'FailureCard' }>): string {
  return item.isFallback || (item.reason.startsWith('"') && item.reason.endsWith('"'))
    ? item.reason
    : `"${item.reason}"`;
}

export function getFailureSourceText(item: Extract<TranscriptItem, { kind: 'FailureCard' }>): string {
  const source = item.reportSource === 'agent_output' ? 'agent output' : item.reportSource === 'artifacts' ? 'artifacts' : 'recorded ledger';
  return `Source: ${source}.`;
}

export function getFailureDeliveryText(item: Extract<TranscriptItem, { kind: 'FailureCard' }>): string {
  if (item.delivery === 'queued') return 'Response queued locally; agent acceptance is unconfirmed.';
  if (item.delivery === 'written') return 'Input write callback returned; agent acceptance is unconfirmed.';
  return `Input delivery error: ${item.deliveryError ?? 'delivery is unknown'}; agent acceptance is unconfirmed.`;
}

export function getFailureResolutionText(item: Extract<TranscriptItem, { kind: 'FailureCard' }>): string {
  const answer = item.resolvedText ?? '';
  const text = answer.endsWith('.') ? answer : `${answer}.`;
  return `Input sent: ${text} Agent acceptance is unconfirmed.`;
}

export function getDelegationReportText(item: Extract<TranscriptItem, { kind: 'DelegationCard' }>): string {
  const source = item.reportSource === 'artifacts' ? 'artifacts' : item.reportSource === 'ledger' ? 'recorded ledger' : 'agent output';
  return `${item.role} reported ${item.reportedVerdict ?? (item.status === 'completed_with_concerns' ? 'DONE_WITH_CONCERNS' : 'completion')} (${source}); review and verification are unconfirmed.`;
}

export function getTranscriptSegments(item: TranscriptItem): TranscriptTextSegment[] {
  switch (item.kind) {
    case 'UserMessage':
    case 'SupervisorNote':
    case 'PhaseChange':
    case 'QuietCounter':
      return [{ segmentKey: 'text', text: item.text }];
    case 'CommitLine':
      return [{ segmentKey: 'line', text: `✓ ${item.sha}   ${item.message}` }];
    case 'DelegationCard':
      return item.status === 'completed' || item.status === 'completed_with_concerns'
        ? [
            { segmentKey: 'title', text: item.title, leadingText: `• Task ${item.taskNumber}: `, displayText: `• Task ${item.taskNumber}: ${item.title}${item.commitSha ? `  ${item.commitSha}` : ''}` },
            { segmentKey: 'report', text: getDelegationReportText(item) },
            ...(item.nextStepText ? [{ segmentKey: 'nextStepText', text: item.nextStepText }] : []),
          ]
        : [
            { segmentKey: 'title', text: item.title, leadingText: `Task ${item.taskNumber}: `, displayText: `Task ${item.taskNumber}: ${item.title}` },
            ...(item.nowSentence ? [{ segmentKey: 'nowSentence', text: item.nowSentence }] : []),
            ...(item.testSummaryText ? [{ segmentKey: 'testSummaryText', text: item.testSummaryText }] : []),
            ...(item.nextStepText ? [{ segmentKey: 'nextStepText', text: item.nextStepText }] : []),
          ];
    case 'DecisionCard':
      if (item.status === 'answered') {
        const answer = item.answeredText ?? '';
        return [{ segmentKey: 'delivery', text: getDecisionAnswerText(item) }];
      }
      return [
        { segmentKey: 'headline', text: item.headline },
        { segmentKey: 'question', text: item.question },
        ...(item.contextLine ? [{ segmentKey: 'contextLine', text: getDecisionContextText(item), leadingText: item.contextLine.startsWith('I checked first') ? '' : 'I checked first: ', displayText: getDecisionContextText(item) }] : []),
        ...(item.delivery === 'queued' || item.delivery === 'written' || item.delivery === 'error' ? [{ segmentKey: 'delivery', text: getDecisionDeliveryText(item) }] : []),
        ...item.options.map((option) => ({ segmentKey: `option:${option.index}`, text: option.label, leadingText: `${option.index}  `, displayText: `${option.index}  ${option.label}${option.recommended && !option.label.toLowerCase().includes('(recommended)') ? ' (recommended)' : ''}` })),
      ];
    case 'FailureCard':
      if (item.status === 'resolved') {
        return [{ segmentKey: 'delivery', text: getFailureResolutionText(item) }];
      }
      return [
        { segmentKey: 'headline', text: item.headline },
        { segmentKey: 'reason', text: getFailureReasonText(item) },
        ...(item.reportSource ? [{ segmentKey: 'source', text: getFailureSourceText(item) }] : []),
        ...(item.delivery === 'queued' || item.delivery === 'written' || item.delivery === 'error' ? [{ segmentKey: 'delivery', text: getFailureDeliveryText(item) }] : []),
        ...item.options.map((option) => ({ segmentKey: `option:${option.index}`, text: option.label, leadingText: `${option.index}  `, displayText: `${option.index}  ${option.label}` })),
      ];
    case 'CompletionCard':
      return [
        { segmentKey: 'legacyStatus', text: `Legacy ledger status: COMPLETED on ${item.branchName || 'branch'}` },
        { segmentKey: 'recordedCounts', text: `Recorded counts: ${item.taskCount} tasks   ${item.commitCount} commits   ${item.totalElapsedFormatted} elapsed` },
        { segmentKey: 'verifierResult', text: `Recorded verifier text (unverified): ${item.verifierResult}` },
        { segmentKey: 'source', text: 'Source: recorded ledger.' },
        { segmentKey: 'reviewStatus', text: COMPLETION_NEXT_STEPS_NOTE },
      ];
  }
}

export function getAnchorPrefixText(item: TranscriptItem, segmentKey: string, sourceOffset: number): string | undefined {
  const segments = getTranscriptSegments(item);
  const index = segments.findIndex((segment) => segment.segmentKey === segmentKey);
  if (index < 0) return undefined;
  const target = segments[index];
  const graphemes = Array.from(graphemeSegmenter.segment(target.text), ({ segment }) => segment);
  const offset = Math.max(0, Math.min(graphemes.length, Math.floor(Number.isFinite(sourceOffset) ? sourceOffset : 0)));
  const prefix = [
    ...segments.slice(0, index).map((segment) => segment.displayText ?? `${segment.leadingText ?? ''}${segment.text}`),
    `${target.leadingText ?? ''}${graphemes.slice(0, offset).join('')}`,
  ].join('\n');
  return offset === 0 ? `${prefix} ` : prefix;
}

export function getTranscriptSegment(item: TranscriptItem, segmentKey: string): TranscriptTextSegment | undefined {
  return getTranscriptSegments(item).find((segment) => segment.segmentKey === segmentKey);
}

export function getTranscriptSegmentPrefix(item: TranscriptItem, segmentKey: string, sourceOffset: number): string | undefined {
  const segment = getTranscriptSegment(item, segmentKey);
  if (!segment) return undefined;
  const graphemes = Array.from(graphemeSegmenter.segment(segment.text), ({ segment: grapheme }) => grapheme);
  const offset = Math.max(0, Math.min(graphemes.length, Math.floor(Number.isFinite(sourceOffset) ? sourceOffset : 0)));
  return graphemes.slice(0, offset).join('');
}

/** Marks a source position with a zero-width ANSI code so Ink can report its actual rendered row. */
export function getTranscriptSegmentProbeText(item: TranscriptItem, segmentKey: string, sourceOffset: number): string | undefined {
  const segment = getTranscriptSegment(item, segmentKey);
  if (!segment) return undefined;
  return markTranscriptTextAtOffset(segment.text, sourceOffset);
}

export function resolveTranscriptViewportAnchor(
  anchor: TranscriptViewportAnchor | undefined,
  items: readonly TranscriptItem[],
  measurements: readonly TranscriptItemMeasurement[],
  priorAnchorRow?: number
): TranscriptViewportAnchor | undefined {
  if (!anchor || items.length === 0) return undefined;
  const retainedItem = items.find((item) => item.id === anchor.itemId);
  const retainedSegment = retainedItem && getTranscriptSegment(retainedItem, anchor.segmentKey);
  if (retainedItem && retainedSegment) return anchor;

  const rowHint = Number.isFinite(priorAnchorRow)
    ? priorAnchorRow!
    : measurements.find((measurement) => measurement.itemId === anchor.itemId)?.startRow ?? 0;
  const nearestMeasurement = measurements
    .filter((measurement) => items.some((item) => item.id === measurement.itemId))
    .reduce<TranscriptItemMeasurement | undefined>((nearest, measurement) =>
      !nearest || Math.abs(measurement.startRow - rowHint) < Math.abs(nearest.startRow - rowHint)
        ? measurement
        : nearest,
    undefined);
  const nearestItem = retainedItem ?? items.find((item) => item.id === nearestMeasurement?.itemId) ?? items[0];
  const nearestSegment = getTranscriptSegments(nearestItem).find((segment) => segment.text.length > 0)
    ?? getTranscriptSegments(nearestItem)[0];
  if (!nearestSegment) return undefined;
  return {
    itemId: nearestItem.id,
    segmentKey: nearestSegment.segmentKey,
    sourceOffset: 0,
    viewportRow: anchor.viewportRow,
  };
}

export function getTranscriptWindow(
  totalRows: number,
  viewportRows: number,
  scrollOffset: number,
  hintRows: number
): TranscriptWindow {
  const total = Math.max(0, Math.floor(Number.isFinite(totalRows) ? totalRows : 0));
  const viewport = Math.max(0, Math.floor(Number.isFinite(viewportRows) ? viewportRows : 0));
  const hint = Math.min(viewport, Math.max(0, Math.floor(Number.isFinite(hintRows) ? hintRows : 0)));
  const visibleRows = viewport - hint;
  const maxOffset = Math.max(0, total - visibleRows);
  const clampedOffset = Math.max(0, Math.min(maxOffset, Math.floor(Number.isFinite(scrollOffset) ? scrollOffset : 0)));
  return {
    totalRows: total,
    visibleRows,
    clampedOffset,
    startRow: Math.max(0, total - visibleRows - clampedOffset),
  };
}

export function sameTranscriptMeasurements(
  left: readonly TranscriptItemMeasurement[],
  right: readonly TranscriptItemMeasurement[]
): boolean {
  return left.length === right.length && left.every((item, index) =>
    item.itemId === right[index].itemId && item.startRow === right[index].startRow && item.height === right[index].height && item.width === right[index].width
  );
}

