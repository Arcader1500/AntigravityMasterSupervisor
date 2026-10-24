import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { Transcript } from '../../src/tui/components/Transcript.js';
import type { TranscriptItem } from '../../src/tui/narrator.js';
import { resolveTheme } from '../../src/tui/theme.js';
import { clampTranscriptViewportRow, getTranscriptAnchorMeasurementKey, getTranscriptWindow, getAnchorPrefixText, transcriptSourceLength } from '../../src/tui/transcript-viewport.js';
import type { TranscriptViewportAnchor, TranscriptViewportMetrics } from '../../src/tui/transcript-viewport.js';

const anchoredItemId = 'marker-19';
const anchoredTranscript: TranscriptViewportAnchor = {
  itemId: anchoredItemId,
  segmentKey: 'text',
  sourceOffset: 0,
  viewportRow: 0,
};

const AnchoredTranscriptHarness: React.FC<{
  items: TranscriptItem[];
  width: number;
  metrics: TranscriptViewportMetrics[];
}> = ({ items, width, metrics }) => {
  const [scrollOffset, setScrollOffset] = React.useState(21);
  return (
    <Box width={width}>
      <Transcript
        items={items}
        maxRows={6}
        maxWidth={width}
        scrollOffset={scrollOffset}
        anchor={anchoredTranscript}
        onViewportMetrics={(value) => {
          metrics.push(value);
          const row = value.segments.find((segment) => segment.itemId === anchoredItemId)?.row;
          if (row !== undefined && value.anchor?.itemId === anchoredItemId) {
            const nextOffset = Math.max(0, value.totalRows - value.visibleRows - row + value.anchor.viewportRow);
            setScrollOffset((current) => current > 0 && current !== nextOffset ? nextOffset : current);
          }
        }}
      />
    </Box>
  );
};

const tallDecision: TranscriptItem = {
  id: 'tall', kind: 'DecisionCard', promptKind: 'ask_question',
  headline: 'Tall card headline', question: 'question row one\nquestion row two\nquestion row three\nquestion row four',
  options: [
    { index: 1, label: 'First option' }, { index: 2, label: 'Second option' },
    { index: 3, label: 'Third option' }, { index: 4, label: 'Fourth option' },
  ],
  status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
};

describe('transcript viewport', () => {
  it('clamps the measured row window without forcing rows into an empty or tiny viewport', () => {
    expect(getTranscriptWindow(10, 3, 999, 1)).toEqual({ totalRows: 10, visibleRows: 2, clampedOffset: 8, startRow: 0 });
    expect(getTranscriptWindow(10, 0, 999, 0)).toEqual({ totalRows: 10, visibleRows: 0, clampedOffset: 10, startRow: 0 });
    expect(getTranscriptWindow(-2, 3, -1, 8)).toEqual({ totalRows: 0, visibleRows: 0, clampedOffset: 0, startRow: 0 });
  });

  it('renders empty content within its zero-row measurement', () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const { lastFrame } = render(<Transcript items={[]} maxRows={3} onViewportMetrics={(value) => metrics.push(value)} />);
    expect(metrics.at(-1)?.totalRows).toBe(0);
    expect((lastFrame() ?? '').trim()).toBe('');
  });

  it('reserves the actual wrapped pinned-hint height from the row budget', () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const items: TranscriptItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `hint-${index}`, kind: 'SupervisorNote', text: `hint row ${index}`, timestamp: '2026-10-24T00:00:00Z',
    }));
    const { lastFrame } = render(<Transcript items={items} maxRows={5} maxWidth={24} scrollOffset={1} pendingDecisionCount={2} onViewportMetrics={(value) => metrics.push(value)} />);
    expect(metrics.at(-1)?.visibleRows).toBe(3);
    expect((lastFrame() ?? '').replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(5);
    expect(lastFrame()).toContain('2 needs you.');
  });

  it('keeps source offsets on grapheme boundaries', () => {
    const item: TranscriptItem = { id: 'unicode', kind: 'SupervisorNote', text: 'A👨‍👩‍👧‍👦e\u0301B', timestamp: '2026-10-24T00:00:00Z' };
    expect(transcriptSourceLength(item.text)).toBe(4);
    expect(getAnchorPrefixText(item, 'text', 2)).toBe('A👨‍👩‍👧‍👦');
  });

  it('keys anchor measurements by source and rendered geometry, and clamps requested viewport rows', () => {
    const measurement = { itemId: anchoredItemId, startRow: 19, height: 1, width: 88 };
    const key = getTranscriptAnchorMeasurementKey(anchoredTranscript, measurement, 'marker', 76);
    expect(key).toBeDefined();
    expect(getTranscriptAnchorMeasurementKey(anchoredTranscript, { ...measurement, width: 48 }, 'marker', 48)).not.toBe(key);
    expect(getTranscriptAnchorMeasurementKey(anchoredTranscript, measurement, 'markerx', 76)).not.toBe(key);
    expect(clampTranscriptViewportRow(-9, 6)).toBe(0);
    expect(clampTranscriptViewportRow(99, 3)).toBe(2);
  });

  it('keeps a source anchor at its requested row through append and wrapped-width reflow', async () => {
    const makeItems = (count: number): TranscriptItem[] => Array.from({ length: count }, (_, index) => ({
      id: `marker-${String(index).padStart(2, '0')}`,
      kind: 'UserMessage',
      text: `marker-${String(index).padStart(2, '0')} ${'x'.repeat(56)}`,
      timestamp: '2026-10-24T00:00:00Z',
    }));
    const metrics: TranscriptViewportMetrics[] = [];
    const view = render(<AnchoredTranscriptHarness items={makeItems(45)} width={100} metrics={metrics} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.lastFrame()).toContain(anchoredItemId);
    view.rerender(<AnchoredTranscriptHarness items={makeItems(46)} width={100} metrics={metrics} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.lastFrame()).toContain(anchoredItemId);
    view.rerender(<AnchoredTranscriptHarness items={makeItems(46)} width={60} metrics={metrics} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const frame = view.lastFrame() ?? '';
    const markerLine = frame.split('\n').find((line) => line.includes(anchoredItemId));
    expect(markerLine).toBeDefined();
    expect(frame.split('\n').find((line) => /marker-\d{2}/.test(line))).toContain(anchoredItemId);
    const finalMetrics = metrics.at(-1)!;
    expect(finalMetrics.anchor).toMatchObject({ itemId: anchoredItemId, sourceOffset: 0, viewportRow: 0 });
    expect(finalMetrics.segments).toContainEqual(expect.objectContaining({ itemId: anchoredItemId, sourceOffset: 0 }));
    expect(metrics.every((value) => value.anchor?.itemId === anchoredItemId)).toBe(true);
  });

  it('shows every row of an oversized card as the display-row offset changes', () => {
    const markers = ['Tall card headline', 'question row one', 'question row two', 'question row three', 'question row four', '1  First option', '4  Fourth option'];
    const frames = [0, 2, 4, 6, 8].map((scrollOffset) =>
      render(<Transcript items={[tallDecision]} maxRows={3} maxWidth={36} scrollOffset={scrollOffset} />).lastFrame() ?? ''
    );
    for (const frame of frames) expect(frame.replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(3);
    for (const marker of markers) expect(frames.some((frame) => frame.includes(marker))).toBe(true);
  });

  it('clips the rendered frame to the viewport while retaining oldest and newest rows', () => {
    const items: TranscriptItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `note-${index}`, kind: 'SupervisorNote', text: `row-marker-${index}`, timestamp: '2026-10-24T00:00:00Z',
    }));
    const { lastFrame } = render(<Transcript items={items} maxRows={3} scrollOffset={999} />);
    const lines = (lastFrame() ?? '').replace(/\n$/, '').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('row-marker-0');
    expect(lines[2]).toContain('row-marker-2');
  });

  it('reports Ink measured item rows and updates them when rendered text changes', async () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const item = (text: string): TranscriptItem[] => [{ id: 'same', kind: 'SupervisorNote', text, timestamp: '2026-10-24T00:00:00Z' }];
    const view = render(<Transcript items={item('short')} maxRows={3} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.rerender(<Transcript items={item('one\ntwo\nthree\nfour')} maxRows={3} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const latest = metrics.at(-1)!;
    expect(latest.totalRows).toBeGreaterThan(1);
    expect(latest.items[0]).toMatchObject({ itemId: 'same', startRow: 0 });
    expect(latest.items[0].height).toBeGreaterThan(1);
    expect(latest.segments[0]).toMatchObject({ itemId: 'same', segmentKey: 'text', row: 1 });
  });

  it('remaps a nonzero text source offset through Ink wrapping after a width change', async () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const text = 'first\nanchor marker\nlast';
    const anchor = { itemId: 'anchored', segmentKey: 'text', sourceOffset: text.indexOf('marker') + 2, viewportRow: 0 };
    const item: TranscriptItem[] = [{ id: 'anchored', kind: 'SupervisorNote', text, timestamp: '2026-10-24T00:00:00Z' }];
    const view = render(<Transcript items={item} maxRows={5} maxWidth={40} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metrics.at(-1)?.anchor).toMatchObject({ itemId: 'anchored', segmentKey: 'text', sourceOffset: anchor.sourceOffset, viewportRow: 0 });
    view.rerender(<Transcript items={item} maxRows={5} maxWidth={18} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metrics.at(-1)?.anchor?.sourceOffset).toBe(anchor.sourceOffset);
    expect(metrics.at(-1)?.anchor?.viewportRow).toBe(0);
    expect(metrics.at(-1)?.segments[0]?.row).toBeGreaterThan(metrics[0]?.segments[0]?.row ?? -1);
  });

  it('maps a decision-card question offset after the actual rendered headline rows', async () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const offset = tallDecision.kind === 'DecisionCard' ? tallDecision.question.indexOf('three') + 2 : 0;
    const anchor = { itemId: 'tall', segmentKey: 'question', sourceOffset: offset, viewportRow: 0 };
    render(<Transcript items={[tallDecision]} maxRows={12} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metrics.at(-1)?.segments).toContainEqual({ itemId: 'tall', segmentKey: 'question', sourceOffset: offset, row: 4 });
  });

  it('maps a wrapped card prefix to the same actual marker row at a narrow width', async () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const card: TranscriptItem = {
      ...tallDecision,
      id: 'narrow-card',
      question: 'This is a long question prefix that wraps across several lines at this width.\nUNIQUE-ANCHOR-MARKER is on the anchored row.\nThe card continues below it.',
    };
    const offset = card.kind === 'DecisionCard' ? card.question.indexOf('UNIQUE-ANCHOR-MARKER') + 5 : 0;
    const anchor = { itemId: card.id, segmentKey: 'question', sourceOffset: offset, viewportRow: 0 };
    const view = render(<Box width={36}><Transcript items={[card]} maxRows={4} maxWidth={36} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const targetRow = metrics.at(-1)!.segments.find((segment) => segment.segmentKey === 'question')!.row;
    const scrollOffset = metrics.at(-1)!.totalRows - metrics.at(-1)!.visibleRows - targetRow;
    view.rerender(<Box width={36}><Transcript items={[card]} maxRows={4} maxWidth={36} scrollOffset={scrollOffset} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
    expect(metrics.at(-1)?.anchor?.viewportRow).toBe(0);
    expect((view.lastFrame() ?? '').split('\n')[0]).toContain('UNIQUE-ANCHOR-MARKER');
  });

  it('maps monochrome decision and failure prefixes through the actual narrow card layout', async () => {
    const theme = resolveTheme({ env: { NO_COLOR: '1' } });
    const cases: Array<{ item: TranscriptItem; segmentKey: string; marker: string; rowToken: string }> = [
      {
        item: {
          id: 'mono-decision', kind: 'DecisionCard', promptKind: 'ask_question',
          headline: '12345678901234', question: 'UNIQUE decision question', options: [],
          status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
        },
        segmentKey: 'question', marker: 'UNIQUE', rowToken: 'question',
      },
      {
        item: {
          id: 'mono-failure', kind: 'FailureCard', role: 'implementer', headline: '12345678901234',
          reason: 'UNIQUE failure reason', failureKind: 'blocked', options: [],
          status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
        },
        segmentKey: 'reason', marker: 'UNIQUE', rowToken: 'reason',
      },
    ];

    for (const { item, segmentKey, marker, rowToken } of cases) {
      const text = segmentKey === 'question' && item.kind === 'DecisionCard' ? item.question : item.kind === 'FailureCard' ? item.reason : '';
      const anchor = { itemId: item.id, segmentKey, sourceOffset: text.length, viewportRow: 0 };
      const metrics: TranscriptViewportMetrics[] = [];
      const view = render(<Box width={20}><Transcript items={[item]} maxRows={20} maxWidth={20} theme={theme} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const lines = (view.lastFrame() ?? '').split('\n');
      expect(lines.join('\n')).toContain(marker);
      expect(lines.findIndex((line) => line.includes(rowToken))).toBe(metrics.at(-1)!.segments[0].row);
    }
  });

  it('keeps zero-offset decision and failure targets on the actual first text row', async () => {
    const cases: Array<{ item: TranscriptItem; segmentKey: string; marker: string }> = [
      {
        item: {
          id: 'zero-decision', kind: 'DecisionCard', promptKind: 'ask_question',
          headline: '12345678901234', question: 'UNIQUE question marker', options: [],
          status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
        },
        segmentKey: 'question', marker: 'UNIQUE',
      },
      {
        item: {
          id: 'zero-failure', kind: 'FailureCard', role: 'implementer',
          headline: '12345678901234', reason: 'UNIQUE failure marker', failureKind: 'blocked', options: [],
          status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
        },
        segmentKey: 'reason', marker: 'UNIQUE',
      },
    ];
    for (const { item, segmentKey, marker } of cases) {
      const metrics: TranscriptViewportMetrics[] = [];
      const view = render(<Box width={30}><Transcript items={[item]} maxRows={12} maxWidth={30} anchor={{ itemId: item.id, segmentKey, sourceOffset: 0, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const lines = (view.lastFrame() ?? '').split('\n');
      expect(lines.findIndex((line) => line.includes(marker))).toBe(metrics.at(-1)!.segments[0].row);
    }
  });

  it('maps a paused delegation title offset through its full task label and word wrap', async () => {
    const item: TranscriptItem = {
      id: 'paused-long-title', kind: 'DelegationCard', taskId: 'task-12345', taskNumber: 12345,
      totalTasks: 999999, title: 'abcdefghijklmnopqrstuvwx ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      role: 'implementer', status: 'paused', nowSentence: '', elapsedFormatted: '1m',
      timestamp: '2026-10-24T00:00:00Z',
    };
    const metrics: TranscriptViewportMetrics[] = [];
    const view = render(<Box width={30}><Transcript items={[item]} maxRows={16} maxWidth={30} anchor={{ itemId: item.id, segmentKey: 'title', sourceOffset: 3, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lines = (view.lastFrame() ?? '').split('\n');
    expect(lines.findIndex((line) => line.includes('abcd'))).toBe(metrics.at(-1)!.segments[0].row);
  });

  it('maps completed delegation report text using the rendered report line', async () => {
    const item: TranscriptItem = {
      id: 'completed-report', kind: 'DelegationCard', taskId: 'task-7', taskNumber: 7,
      title: 'Rendered task title', role: 'implementer', status: 'completed', nowSentence: '',
      elapsedFormatted: '1m', reportedVerdict: 'UNIQUE_VERDICT', reportSource: 'artifacts',
      nextStepText: 'Next step after the report.', timestamp: '2026-10-24T00:00:00Z',
    };
    const report = 'implementer reported UNIQUE_VERDICT (artifacts); review and verification are unconfirmed.';
    const anchor = { itemId: item.id, segmentKey: 'report', sourceOffset: report.indexOf('UNIQUE_VERDICT') + 'UNIQUE_VERDICT'.length, viewportRow: 0 };
    const metrics: TranscriptViewportMetrics[] = [];
    const view = render(<Box width={32}><Transcript items={[item]} maxRows={12} maxWidth={32} anchor={anchor} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lines = (view.lastFrame() ?? '').split('\n');
    expect(lines.findIndex((line) => line.includes('UNIQUE_VERDICT'))).toBe(metrics.at(-1)!.segments[0].row);
  });

  it('publishes a replacement anchor after a pending decision collapses', async () => {
    const pending: TranscriptItem = {
      id: 'collapsing-decision', kind: 'DecisionCard', promptKind: 'ask_question',
      headline: 'Question', question: 'UNIQUE pending question', options: [],
      status: 'pending', selectedOptionIndex: 1, timestamp: '2026-10-24T00:00:00Z',
    };
    const answered: TranscriptItem = { ...pending, status: 'answered', answeredText: 'Proceed' };
    const originalAnchor = { itemId: pending.id, segmentKey: 'question', sourceOffset: 7, viewportRow: 0 };
    const metrics: TranscriptViewportMetrics[] = [];
    const view = render(<Transcript items={[pending]} maxRows={8} maxWidth={40} anchor={originalAnchor} onViewportMetrics={(value) => metrics.push(value)} />);
    const before = metrics.length;
    view.rerender(<Transcript items={[answered]} maxRows={8} maxWidth={40} anchor={originalAnchor} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.rerender(<Transcript items={[answered, { id: 'appended', kind: 'SupervisorNote', text: 'Appended output', timestamp: '2026-10-24T00:00:01Z' }]} maxRows={5} maxWidth={24} anchor={originalAnchor} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metrics.length).toBeGreaterThan(before);
    expect(metrics.at(-1)?.anchor).toMatchObject({ itemId: pending.id, segmentKey: 'delivery' });
    expect(metrics.at(-1)?.segments).toHaveLength(1);
  });

  it('maps exact grapheme rows inside a long decision word using Ink output', async () => {
    const question = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPP';
    const offsets = [
      { offset: 0, marker: 'AAAA', expectedRow: 2 },
      { offset: 4, marker: 'BBBB', expectedRow: 2 },
      { offset: 20, marker: 'FFFF', expectedRow: 3 },
      { offset: 40, marker: 'KKKK', expectedRow: 4 },
    ];
    for (const { offset, marker, expectedRow } of offsets) {
      const item: TranscriptItem = {
        id: `long-token-${offset}`, kind: 'DecisionCard', promptKind: 'ask_question',
        headline: 'Title', question, options: [], status: 'pending', selectedOptionIndex: 1,
        timestamp: '2026-10-24T00:00:00Z',
      };
      const metrics: TranscriptViewportMetrics[] = [];
      const view = render(<Box width={20}><Transcript items={[item]} maxRows={20} maxWidth={20} anchor={{ itemId: item.id, segmentKey: 'question', sourceOffset: offset, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const actualRow = (view.lastFrame() ?? '').split('\n').findIndex((line) => line.includes(marker));
      expect(actualRow).toBe(expectedRow);
      expect(actualRow).toBeGreaterThanOrEqual(0);
      expect(metrics.at(-1)?.segments[0]?.row).toBe(actualRow);
    }
  });

  it('maps a long word after preceding text without changing its wrapped start', async () => {
    const word = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPP';
    const question = `lead ${word}`;
    const item: TranscriptItem = {
      id: 'preceding-long-token', kind: 'DecisionCard', promptKind: 'ask_question',
      headline: 'Title', question, options: [], status: 'pending', selectedOptionIndex: 1,
      timestamp: '2026-10-24T00:00:00Z',
    };
    const metrics: TranscriptViewportMetrics[] = [];
    const view = render(<Box width={20}><Transcript items={[item]} maxRows={20} maxWidth={20} anchor={{ itemId: item.id, segmentKey: 'question', sourceOffset: 25, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actualRow = (view.lastFrame() ?? '').split('\n').findIndex((line) => line.includes('FFFF'));
    expect(actualRow).toBe(4);
    expect(actualRow).toBeGreaterThanOrEqual(0);
    expect(metrics.at(-1)?.segments[0]?.row).toBe(actualRow);
  });

  it('maps plain notes and other retained transcript kinds through full Ink frames', async () => {
    const cases: Array<{ item: TranscriptItem; segmentKey: string; sourceOffset: number; marker: string; expectedRow: number }> = [
      {
        item: { id: 'plain-user', kind: 'UserMessage', text: 'Unique user message', timestamp: '2026-10-24T00:00:00Z' },
        segmentKey: 'text', sourceOffset: 0, marker: 'Unique', expectedRow: 0,
      },
      {
        item: { id: 'plain-note', kind: 'SupervisorNote', text: '123456789012 bbbb', timestamp: '2026-10-24T00:00:00Z' },
        segmentKey: 'text', sourceOffset: 14, marker: 'bbbb', expectedRow: 1,
      },
      {
        item: { id: 'plain-phase', kind: 'PhaseChange', phase: 'review', text: 'Unique phase text', timestamp: '2026-10-24T00:00:00Z' },
        segmentKey: 'text', sourceOffset: 0, marker: 'Unique', expectedRow: 0,
      },
      {
        item: { id: 'plain-quiet', kind: 'QuietCounter', promptsApproved: 3, text: 'Unique quiet status' },
        segmentKey: 'text', sourceOffset: 0, marker: 'Unique', expectedRow: 0,
      },
      {
        item: { id: 'plain-commit', kind: 'CommitLine', sha: 'commit-hash', message: 'Unique commit subject', timestamp: '2026-10-24T00:00:00Z' },
        segmentKey: 'line', sourceOffset: 3, marker: 'commit-hash', expectedRow: 0,
      },
      {
        item: {
          id: 'plain-completion', kind: 'CompletionCard', branchName: 'feature', taskCount: 3,
          commitCount: 2, verifierResult: 'Unique verifier text', totalElapsedFormatted: '1m',
          timestamp: '2026-10-24T00:00:00Z',
        },
        segmentKey: 'legacyStatus', sourceOffset: 0, marker: 'Legacy ledger status', expectedRow: 1,
      },
    ];

    for (const { item, segmentKey, sourceOffset, marker, expectedRow } of cases) {
      const metrics: TranscriptViewportMetrics[] = [];
      const view = render(<Box width={28}><Transcript items={[item]} maxRows={16} maxWidth={28} anchor={{ itemId: item.id, segmentKey, sourceOffset, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} /></Box>);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const actualRow = (view.lastFrame() ?? '').split('\n').findIndex((line) => line.includes(marker));
      expect(actualRow).toBe(expectedRow);
      expect(metrics.at(-1)?.segments).toContainEqual(expect.objectContaining({ itemId: item.id, segmentKey, sourceOffset, row: actualRow }));
    }
  });

  it('uses private non-TTY renderer streams without process stdio side effects', async () => {
    const item: TranscriptItem = { id: 'isolated-probe', kind: 'SupervisorNote', text: 'A full line to measure', timestamp: '2026-10-24T00:00:00Z' };
    const metrics: TranscriptViewportMetrics[] = [];
    const stdoutResizeListeners = process.stdout.listenerCount('resize');
    const stderrResizeListeners = process.stderr.listenerCount('resize');
    const stdinReadableListeners = process.stdin.listenerCount('readable');
    const wasRaw = process.stdin.isRaw;
    const stderrWrite = vi.spyOn(process.stderr, 'write');
    try {
      render(<Transcript items={[item]} maxRows={4} anchor={{ itemId: item.id, segmentKey: 'text', sourceOffset: 5, viewportRow: 0 }} onViewportMetrics={(value) => metrics.push(value)} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(metrics.at(-1)?.anchor?.itemId).toBe(item.id);
      expect(process.stdout.listenerCount('resize')).toBe(stdoutResizeListeners);
      expect(process.stderr.listenerCount('resize')).toBe(stderrResizeListeners);
      expect(process.stdin.listenerCount('readable')).toBe(stdinReadableListeners);
      expect(process.stdin.isRaw).toBe(wasRaw);
      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it('captures a nonzero source offset for the scrolled-to row without a supplied anchor', async () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const text = 'row zero\nrow one\nrow two\nrow three\nrow four';
    const items: TranscriptItem[] = [{ id: 'capture', kind: 'SupervisorNote', text, timestamp: '2026-10-24T00:00:00Z' }];
    const { lastFrame } = render(<Transcript items={items} maxRows={2} scrollOffset={1} onViewportMetrics={(value) => metrics.push(value)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const latest = metrics.at(-1)!;
    expect(latest.anchor).toMatchObject({ itemId: 'capture', segmentKey: 'text', sourceOffset: expect.any(Number), viewportRow: 0 });
    expect(latest.anchor!.sourceOffset).toBeGreaterThan(0);
    expect(latest.segments[0].row).toBe(2);
    expect(lastFrame()).toContain('row two');
  });

  it('measures a 500-item history with a bounded visible frame', () => {
    const metrics: TranscriptViewportMetrics[] = [];
    const items: TranscriptItem[] = Array.from({ length: 500 }, (_, index) => ({
      id: `history-${index}`, kind: 'SupervisorNote', text: `history row ${index}`, timestamp: '2026-10-24T00:00:00Z',
    }));
    const { lastFrame } = render(<Transcript items={items} maxRows={3} scrollOffset={999} onViewportMetrics={(value) => metrics.push(value)} />);
    expect(metrics.at(-1)?.items).toHaveLength(500);
    expect(metrics.at(-1)?.totalRows).toBe(500);
    expect((lastFrame() ?? '').replace(/\n$/, '').split('\n')).toHaveLength(3);
  });
});
