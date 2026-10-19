import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { DelegationCard } from '../../src/tui/components/DelegationCard.js';
import { DecisionCard } from '../../src/tui/components/DecisionCard.js';
import { FailureCard } from '../../src/tui/components/FailureCard.js';
import { Transcript, CompletionCard } from '../../src/tui/components/Transcript.js';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';
import type { TranscriptItem } from '../../src/tui/narrator.js';

describe('DelegationCard', () => {
  const theme = resolveTheme();
  const glyphs = resolveGlyphs();

  it('renders running card with round border, bold title, right-aligned wave info, nowSentence and test summary', () => {
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-1',
      kind: 'DelegationCard',
      taskId: 'task-3',
      taskNumber: 3,
      totalTasks: 5,
      wave: 2,
      totalWaves: 3,
      title: 'Route middleware',
      role: 'implementer',
      status: 'running',
      nowSentence: 'The implementer is writing src/middleware/limiter.ts, 1m 12s in.',
      elapsedFormatted: '1m 12s',
      testSummaryText: '14 of 14 tests pass so far.',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Task 3: Route middleware');
    expect(frame).toContain('wave 2 of 3');
    expect(frame).toContain('The implementer is writing src/middleware/limiter.ts, 1m 12s in.');
    expect(frame).toContain('14 of 14 tests pass so far.');
  });

  it('renders task count fallback when wave information is not present', () => {
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-1b',
      kind: 'DelegationCard',
      taskId: 'task-3',
      taskNumber: 3,
      totalTasks: 5,
      title: 'Route middleware',
      role: 'implementer',
      status: 'running',
      nowSentence: 'The implementer is writing code, 30s in.',
      elapsedFormatted: '30s',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('task 3 of 5');
  });

  it('renders paused glyph when status is paused', () => {
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-paused',
      kind: 'DelegationCard',
      taskId: 'task-2',
      taskNumber: 2,
      title: 'Token bucket core',
      role: 'implementer',
      status: 'paused',
      nowSentence: 'Paused at user request.',
      elapsedFormatted: '2m',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(glyphs.paused);
    expect(frame).toContain('Task 2: Token bucket core');
  });

  it('renders static running glyph when noMotion is true', () => {
    const noMotionTheme = { ...theme, noMotion: true };
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-nomotion',
      kind: 'DelegationCard',
      taskId: 'task-1',
      taskNumber: 1,
      title: 'Scaffold module',
      role: 'implementer',
      status: 'running',
      nowSentence: 'The implementer is working, 10s in.',
      elapsedFormatted: '10s',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={noMotionTheme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(glyphs.running);
    expect(frame).toContain('Task 1: Scaffold module');
  });

  it('collapses to a plain line with done glyph when completed, including commit SHA', () => {
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-done',
      kind: 'DelegationCard',
      taskId: 'task-3',
      taskNumber: 3,
      title: 'Route middleware',
      role: 'implementer',
      status: 'completed',
      commitSha: '7f3a9b1',
      nowSentence: '',
      elapsedFormatted: '2m 15s',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(`${glyphs.done} Task 3: Route middleware`);
    expect(frame).toContain('7f3a9b1');
  });

  it('renders second dim line when completed_with_concerns', () => {
    const item: Extract<TranscriptItem, { kind: 'DelegationCard' }> = {
      id: 'del-concerns',
      kind: 'DelegationCard',
      taskId: 'task-4',
      taskNumber: 4,
      title: 'Redis persistence',
      role: 'implementer',
      status: 'completed_with_concerns',
      nextStepText: 'Finished with concerns. Reviewer will check.',
      nowSentence: '',
      elapsedFormatted: '3m',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DelegationCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(`${glyphs.done} Task 4: Redis persistence`);
    expect(frame).toContain('Finished with concerns. Reviewer will check.');
  });
});

describe('DecisionCard', () => {
  const theme = resolveTheme();
  const glyphs = resolveGlyphs();

  it('renders pending decision card with headline, question, context, and numbered options', () => {
    const item: Extract<TranscriptItem, { kind: 'DecisionCard' }> = {
      id: 'dec-1',
      kind: 'DecisionCard',
      promptKind: 'ask_question',
      headline: 'Storage backend for rate limiting',
      question: 'Which store should we use for sliding window limits?',
      contextLine: 'the repo currently uses Redis 7.0 for cache',
      options: [
        { index: 1, label: 'Redis (cluster-ready)', recommended: true },
        { index: 2, label: 'In-memory LRU', recommended: false },
        { index: 3, label: 'Postgres table', recommended: false },
      ],
      status: 'pending',
      selectedOptionIndex: 1,
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DecisionCard item={item} isFocused={true} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Storage backend for rate limiting');
    expect(frame).toContain('Which store should we use for sliding window limits?');
    expect(frame).toContain('I checked first: the repo currently uses Redis 7.0 for cache');
    expect(frame).toContain('1  Redis (cluster-ready) (recommended)');
    expect(frame).toContain('2  In-memory LRU');
    expect(frame).toContain('3  Postgres table');
  });

  it('prefixes headline with [!] in monochrome mode', () => {
    const monoTheme = resolveTheme({ env: { NO_COLOR: '1' } });
    const item: Extract<TranscriptItem, { kind: 'DecisionCard' }> = {
      id: 'dec-mono',
      kind: 'DecisionCard',
      promptKind: 'ask_question',
      headline: 'Confirm deletion',
      question: 'Do you want to delete the file?',
      options: [
        { index: 1, label: 'Yes', recommended: true },
        { index: 2, label: 'No' },
      ],
      status: 'pending',
      selectedOptionIndex: 1,
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DecisionCard item={item} theme={monoTheme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('[!] Confirm deletion');
  });

  it('collapses to a plain line when answered, without double period', () => {
    const item: Extract<TranscriptItem, { kind: 'DecisionCard' }> = {
      id: 'dec-ans',
      kind: 'DecisionCard',
      promptKind: 'ask_question',
      headline: 'Storage backend',
      question: 'Which store?',
      options: [{ index: 1, label: 'Redis' }],
      status: 'answered',
      selectedOptionIndex: 1,
      answeredText: 'Redis (cluster-ready)',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<DecisionCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('You chose: Redis (cluster-ready).');
    expect(frame).not.toContain('..');
  });
});

describe('FailureCard', () => {
  const theme = resolveTheme();
  const glyphs = resolveGlyphs();

  it('renders pending failure card with headline, quoted error reason, and options', () => {
    const item: Extract<TranscriptItem, { kind: 'FailureCard' }> = {
      id: 'fail-1',
      kind: 'FailureCard',
      taskNumber: 4,
      role: 'implementer',
      headline: 'Task 4 is blocked',
      reason: 'Failed to connect to redis: connection refused at 127.0.0.1:6379',
      failureKind: 'blocked',
      options: [
        { index: 1, label: 'Retry the task', action: 'retry' },
        { index: 2, label: 'Skip it and continue the wave', action: 'skip' },
        { index: 3, label: 'Take over the terminal', action: 'takeover' },
      ],
      status: 'pending',
      selectedOptionIndex: 1,
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<FailureCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Task 4 is blocked');
    expect(frame).toContain('"Failed to connect to redis: connection refused at 127.0.0.1:6379"');
    expect(frame).toContain('1  Retry the task');
    expect(frame).toContain('2  Skip it and continue the wave');
    expect(frame).toContain('3  Take over the terminal');
  });

  it('prefixes headline with [!] in monochrome mode', () => {
    const monoTheme = resolveTheme({ env: { NO_COLOR: '1' } });
    const item: Extract<TranscriptItem, { kind: 'FailureCard' }> = {
      id: 'fail-mono',
      kind: 'FailureCard',
      taskNumber: 4,
      role: 'implementer',
      headline: 'Task 4 is blocked',
      reason: 'Missing environment variables',
      failureKind: 'blocked',
      options: [
        { index: 1, label: 'Retry the task', action: 'retry' },
      ],
      status: 'pending',
      selectedOptionIndex: 1,
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<FailureCard item={item} theme={monoTheme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('[!] Task 4 is blocked');
  });

  it('collapses to a plain line when resolved', () => {
    const item: Extract<TranscriptItem, { kind: 'FailureCard' }> = {
      id: 'fail-res',
      kind: 'FailureCard',
      taskNumber: 4,
      role: 'implementer',
      headline: 'Task 4 is blocked',
      reason: 'Network error',
      failureKind: 'blocked',
      options: [],
      status: 'resolved',
      selectedOptionIndex: 1,
      resolvedText: 'Retry the task',
      timestamp: '2026-10-19T10:00:00Z',
    };

    const { lastFrame } = render(<FailureCard item={item} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('You chose: Retry the task.');
  });
});

describe('Transcript', () => {
  const theme = resolveTheme();
  const glyphs = resolveGlyphs();

  it('renders hanging indent for user message and supervisor note', () => {
    const items: TranscriptItem[] = [
      {
        id: 'user-1',
        kind: 'UserMessage',
        text: 'Build a rate limiting middleware with sliding window algorithm.',
        timestamp: '2026-10-19T10:00:00Z',
      },
      {
        id: 'sup-1',
        kind: 'SupervisorNote',
        text: 'I started planning. I will ask you only about decisions the repo cannot answer.',
        timestamp: '2026-10-19T10:00:01Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} maxWidth={88} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('you');
    expect(frame).toContain('Build a rate limiting middleware with sliding window algorithm.');
    expect(frame).toContain('supervisor');
    expect(frame).toContain('I started planning.');
  });

  it('renders CommitLine with done glyph and 3 spaces between sha and message', () => {
    const items: TranscriptItem[] = [
      {
        id: 'commit-1',
        kind: 'CommitLine',
        sha: '9a8b7c6',
        taskNumber: 2,
        message: 'feat(limiter): implement sliding window token bucket',
        timestamp: '2026-10-19T10:05:00Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain(`${glyphs.done} 9a8b7c6   feat(limiter): implement sliding window token bucket`);
  });

  it('renders QuietCounter text as a single dim line directly above active DelegationCard', () => {
    const items: TranscriptItem[] = [
      {
        id: 'quiet-1',
        kind: 'QuietCounter',
        promptsApproved: 14,
        text: '14 permission prompts approved for you. None needed you.',
      },
      {
        id: 'del-active',
        kind: 'DelegationCard',
        taskId: 'task-3',
        taskNumber: 3,
        title: 'Redis persistence',
        role: 'implementer',
        status: 'running',
        nowSentence: 'The implementer is writing redis.ts, 45s in.',
        elapsedFormatted: '45s',
        timestamp: '2026-10-19T10:06:00Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('14 permission prompts approved for you. None needed you.');
    expect(frame).toContain('Task 3: Redis persistence');
  });

  it('renders CompletionCard with round border and completion details followed by plain next-steps line', () => {
    const items: TranscriptItem[] = [
      {
        id: 'comp-1',
        kind: 'CompletionCard',
        branchName: 'feat/rate-limit',
        taskCount: 6,
        commitCount: 6,
        verifierResult: 'All checks passed',
        totalElapsedFormatted: '4m 32s',
        timestamp: '2026-10-19T10:10:00Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('feat/rate-limit');
    expect(frame).toContain('6');
    expect(frame).toContain('All checks passed');
    expect(frame).toContain('4m 32s');
    expect(frame).toContain('Review the branch, then merge when you are ready.');
  });

  it('shows at most 3 live DelegationCards and collapses extra into "+N more running"', () => {
    const items: TranscriptItem[] = [
      {
        id: 'c-1',
        kind: 'DelegationCard',
        taskId: 'task-1',
        taskNumber: 1,
        title: 'Task 1',
        role: 'implementer',
        status: 'completed',
        nowSentence: '',
        elapsedFormatted: '1m',
        timestamp: '2026-10-19T10:01:00Z',
      },
      {
        id: 'c-2',
        kind: 'DelegationCard',
        taskId: 'task-2',
        taskNumber: 2,
        title: 'Task 2 Live',
        role: 'implementer',
        status: 'running',
        nowSentence: 'Running 2',
        elapsedFormatted: '30s',
        timestamp: '2026-10-19T10:02:00Z',
      },
      {
        id: 'c-3',
        kind: 'DelegationCard',
        taskId: 'task-3',
        taskNumber: 3,
        title: 'Task 3 Live',
        role: 'implementer',
        status: 'running',
        nowSentence: 'Running 3',
        elapsedFormatted: '30s',
        timestamp: '2026-10-19T10:03:00Z',
      },
      {
        id: 'c-4',
        kind: 'DelegationCard',
        taskId: 'task-4',
        taskNumber: 4,
        title: 'Task 4 Live',
        role: 'implementer',
        status: 'running',
        nowSentence: 'Running 4',
        elapsedFormatted: '30s',
        timestamp: '2026-10-19T10:04:00Z',
      },
      {
        id: 'c-5',
        kind: 'DelegationCard',
        taskId: 'task-5',
        taskNumber: 5,
        title: 'Task 5 Live',
        role: 'implementer',
        status: 'running',
        nowSentence: 'Running 5',
        elapsedFormatted: '30s',
        timestamp: '2026-10-19T10:05:00Z',
      },
      {
        id: 'c-6',
        kind: 'DelegationCard',
        taskId: 'task-6',
        taskNumber: 6,
        title: 'Task 6 Live',
        role: 'implementer',
        status: 'running',
        nowSentence: 'Running 6',
        elapsedFormatted: '30s',
        timestamp: '2026-10-19T10:06:00Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Task 1');
    expect(frame).toContain('Task 2 Live');
    expect(frame).toContain('Task 3 Live');
    expect(frame).toContain('Task 4 Live');
    expect(frame).not.toContain('Task 5 Live');
    expect(frame).not.toContain('Task 6 Live');
    expect(frame).toContain('+2 more running');
  });

  it('shows only the oldest pending decision and collapses newer into "+N more waiting"', () => {
    const items: TranscriptItem[] = [
      {
        id: 'dec-1',
        kind: 'DecisionCard',
        promptKind: 'ask_question',
        headline: 'First Question',
        question: 'Choose option A or B?',
        options: [{ index: 1, label: 'Option A' }, { index: 2, label: 'Option B' }],
        status: 'pending',
        selectedOptionIndex: 1,
        timestamp: '2026-10-19T10:01:00Z',
      },
      {
        id: 'dec-2',
        kind: 'DecisionCard',
        promptKind: 'ask_question',
        headline: 'Second Question',
        question: 'Choose option C or D?',
        options: [{ index: 1, label: 'Option C' }, { index: 2, label: 'Option D' }],
        status: 'pending',
        selectedOptionIndex: 1,
        timestamp: '2026-10-19T10:02:00Z',
      },
      {
        id: 'fail-3',
        kind: 'FailureCard',
        taskNumber: 5,
        role: 'implementer',
        headline: 'Task 5 is blocked',
        reason: 'Error occurred',
        failureKind: 'blocked',
        options: [{ index: 1, label: 'Retry', action: 'retry' }],
        status: 'pending',
        selectedOptionIndex: 1,
        timestamp: '2026-10-19T10:03:00Z',
      },
    ];

    const { lastFrame } = render(<Transcript items={items} theme={theme} glyphs={glyphs} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('First Question');
    expect(frame).not.toContain('Second Question');
    expect(frame).not.toContain('Task 5 is blocked');
    expect(frame).toContain('+2 more waiting');
  });

  it('displays pinned prompt when scrollOffset > 0 and pendingDecisionCount > 0', () => {
    const items: TranscriptItem[] = [
      {
        id: 'sup-1',
        kind: 'SupervisorNote',
        text: 'Some previous message',
        timestamp: '2026-10-19T10:00:00Z',
      },
    ];

    const { lastFrame } = render(
      <Transcript
        items={items}
        scrollOffset={5}
        pendingDecisionCount={2}
        theme={theme}
        glyphs={glyphs}
      />
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('2 needs you. Press End to jump to it.');
  });

  it('does not display pinned prompt when scrollOffset is 0', () => {
    const items: TranscriptItem[] = [
      {
        id: 'sup-1',
        kind: 'SupervisorNote',
        text: 'Some previous message',
        timestamp: '2026-10-19T10:00:00Z',
      },
    ];

    const { lastFrame } = render(
      <Transcript
        items={items}
        scrollOffset={0}
        pendingDecisionCount={2}
        theme={theme}
        glyphs={glyphs}
      />
    );
    const frame = lastFrame() ?? '';

    expect(frame).not.toContain('needs you. Press End to jump to it.');
  });

  it('clamps scrollOffset to avoid viewport blanking when scrolling past the top', () => {
    const items: TranscriptItem[] = [
      { id: '1', kind: 'SupervisorNote', text: 'Note 1', timestamp: '2026-10-19T10:00:00Z' },
      { id: '2', kind: 'SupervisorNote', text: 'Note 2', timestamp: '2026-10-19T10:01:00Z' },
      { id: '3', kind: 'SupervisorNote', text: 'Note 3', timestamp: '2026-10-19T10:02:00Z' },
      { id: '4', kind: 'SupervisorNote', text: 'Note 4', timestamp: '2026-10-19T10:03:00Z' },
      { id: '5', kind: 'SupervisorNote', text: 'Note 5', timestamp: '2026-10-19T10:04:00Z' },
    ];

    const { lastFrame } = render(
      <Transcript
        items={items}
        maxRows={2}
        scrollOffset={999}
        theme={theme}
        glyphs={glyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Note 1');
    expect(frame).toContain('Note 2');
    expect(frame).not.toContain('Note 5');
  });
});
