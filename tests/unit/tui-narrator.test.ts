import { describe, it, expect } from 'vitest';
import {
  createInitialNarratorState,
  reduceNarrator,
  type NarratorState,
  type TranscriptItem,
} from '../../src/tui/narrator.js';
import {
  FIRST_LAUNCH_NOTE,
  CONTEXT_RESET_NOTE,
  COMPLETION_NEXT_STEPS_NOTE,
  HELP_TEXT_NOTE,
  TOOL_VERB_MAP,
  formatNowSentence,
  formatTestSummarySentence,
  formatPhaseChangeNote,
  formatBlockedFallbackReason,
} from '../../src/tui/narrator-copy.js';

describe('narrator copy templates', () => {
  it('exports canonical copy constants matching UX spec', () => {
    expect(FIRST_LAUNCH_NOTE).toBe(
      'What do you want built? Describe it in your own words. I will ask you only about decisions the repo cannot answer.'
    );
    expect(CONTEXT_RESET_NOTE).toBe(
      'The plan is approved. I started a fresh orchestrator so it has the full context window. The planning conversation is not carried over.'
    );
    expect(COMPLETION_NEXT_STEPS_NOTE).toBe(
      'Review the branch, then merge when you are ready.'
    );
    expect(HELP_TEXT_NOTE).toContain('Keyboard shortcuts');
    expect(HELP_TEXT_NOTE).toContain('/spec');
    expect(HELP_TEXT_NOTE).toContain('/plan');
    expect(HELP_TEXT_NOTE).toContain('/audit');
    expect(HELP_TEXT_NOTE).toContain('/raw');
    expect(HELP_TEXT_NOTE).toContain('/decide');
  });

  it('maps tool names to plain verbs', () => {
    expect(TOOL_VERB_MAP['view_file']).toBe('reading');
    expect(TOOL_VERB_MAP['read_file']).toBe('reading');
    expect(TOOL_VERB_MAP['write_to_file']).toBe('writing');
    expect(TOOL_VERB_MAP['edit_file']).toBe('writing');
    expect(TOOL_VERB_MAP['replace_file_content']).toBe('writing');
  });

  it('formats now sentence for file operations', () => {
    expect(formatNowSentence('implementer', 'write_to_file', 'src/middleware/limiter.ts', '1m 12s')).toBe(
      'The implementer is writing src/middleware/limiter.ts, 1m 12s in.'
    );
    expect(formatNowSentence('implementer', 'view_file', 'src/auth.ts', '1m 12s')).toBe(
      'The implementer is reading src/auth.ts, 1m 12s in.'
    );
  });

  it('formats now sentence for test and typecheck commands', () => {
    expect(formatNowSentence('implementer', 'run_command', 'npx vitest run', '1m 12s')).toBe(
      'The implementer is running tests, 1m 12s in.'
    );
    expect(formatNowSentence('implementer', 'run_command', 'npx tsc --noEmit', '1m 12s')).toBe(
      'The implementer is running the typecheck, 1m 12s in.'
    );
  });

  it('formats now sentence for code graph MCP tools', () => {
    expect(
      formatNowSentence('researcher', 'semantic_search_nodes_tool', 'TokenBucket', '45s')
    ).toBe('The researcher is looking up TokenBucket in the code graph, 45s in.');
  });

  it('formats now sentence fallback by role', () => {
    expect(formatNowSentence('code-reviewer', undefined, undefined, '30s')).toBe(
      'The code-reviewer is reviewing, 30s in.'
    );
    expect(formatNowSentence('verifier', undefined, undefined, '10s')).toBe(
      'The verifier is verifying, 10s in.'
    );
    expect(formatNowSentence('planner', undefined, undefined, '5s')).toBe(
      'The planner is planning the tasks, 5s in.'
    );
    expect(formatNowSentence('unknown-agent', undefined, undefined, '5s')).toBe(
      'The unknown-agent is working, 5s in.'
    );
  });

  it('formats test summary sentence', () => {
    expect(formatTestSummarySentence('implementer', 14, 0)).toBe(
      '14 of 14 tests pass so far.'
    );
    expect(formatTestSummarySentence('implementer', 12, 2)).toBe(
      '2 tests failing, the implementer is fixing them.'
    );
    expect(formatTestSummarySentence('implementer', 13, 1)).toBe(
      '1 test failing, the implementer is fixing them.'
    );
  });

  it('formats blocked fallback reason when no error line was parsed', () => {
    expect(formatBlockedFallbackReason('implementer')).toBe(
      'The implementer reported it is blocked and did not say why. Open the agent to read its last output.'
    );
  });

  it('formats phase change notes', () => {
    expect(formatPhaseChangeNote('CHECKPOINT_SPEC', 'PLANNING')).toBe(
      'Spec approved. Planning the tasks.'
    );
    expect(formatPhaseChangeNote('PLANNING', 'EXECUTING', undefined, 5, 3)).toBe(
      'Plan approved. Executing 5 tasks across 3 waves.'
    );
  });
});

describe('narrator reducer - Section 5 event-to-item mapping', () => {
  it('initial state contains only the initial SupervisorNote and hasStarted is false', () => {
    const state = createInitialNarratorState('2026-10-19T10:00:00.000Z');
    expect(state.hasStarted).toBe(false);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual({
      id: expect.any(String),
      kind: 'SupervisorNote',
      text: FIRST_LAUNCH_NOTE,
      timestamp: '2026-10-19T10:00:00.000Z',
    });
    expect(state.pendingDecisionCount).toBe(0);
    expect(state.latestBellDecisionId).toBeNull();
  });

  it('USER_MESSAGE appends a UserMessage item and sets hasStarted to true', () => {
    const initial = createInitialNarratorState();
    const next = reduceNarrator(initial, {
      type: 'USER_MESSAGE',
      text: 'Build a rate limiting middleware with Redis',
      timestamp: '2026-10-19T10:01:00.000Z',
    });

    expect(next.hasStarted).toBe(true);
    expect(next.items).toHaveLength(2);
    expect(next.items[1]).toEqual({
      id: expect.any(String),
      kind: 'UserMessage',
      text: 'Build a rate limiting middleware with Redis',
      timestamp: '2026-10-19T10:01:00.000Z',
    });
  });

  it('SUBAGENT_DISPATCHED creates a running DelegationCard with wave info when available', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [
        { id: 't1', index: 1, title: 'Redis schema', status: 'completed', wave: 1, totalWaves: 3 },
        { id: 't2', index: 2, title: 'Token bucket', status: 'completed', wave: 1, totalWaves: 3 },
        { id: 't3', index: 3, title: 'Route middleware', status: 'in_progress', wave: 2, totalWaves: 3 },
      ],
    });

    const next = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'Invoking subagent implementer for Task 3: Route middleware',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    expect(next.hasStarted).toBe(true);
    const card = next.items.find((i) => i.kind === 'DelegationCard');
    expect(card).toBeDefined();
    if (card && card.kind === 'DelegationCard') {
      expect(card.taskNumber).toBe(3);
      expect(card.title).toBe('Route middleware');
      expect(card.wave).toBe(2);
      expect(card.totalWaves).toBe(3);
      expect(card.status).toBe('running');
      expect(card.role).toBe('implementer');
    }
  });

  it('SUBAGENT_DISPATCHED creates a running DelegationCard with task N of M when waves are absent', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [
        { id: 't1', index: 1, title: 'Task 1', status: 'completed' },
        { id: 't2', index: 2, title: 'Task 2', status: 'completed' },
        { id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' },
        { id: 't4', index: 4, title: 'Task 4', status: 'pending' },
        { id: 't5', index: 5, title: 'Task 5', status: 'pending' },
      ],
    });

    const next = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'Invoking subagent implementer for task 3',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    const card = next.items.find((i) => i.kind === 'DelegationCard');
    expect(card).toBeDefined();
    if (card && card.kind === 'DelegationCard') {
      expect(card.taskNumber).toBe(3);
      expect(card.totalTasks).toBe(5);
      expect(card.wave).toBeUndefined();
      expect(card.totalWaves).toBeUndefined();
    }
  });

  it('TOOL_CALLED, COMMAND_STARTED, and TEST_SUMMARY update live DelegationCard in place', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 3',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    const countBefore = state.items.length;

    // Tool call (write_to_file)
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'TOOL_CALLED',
        agent: 'implementer',
        toolName: 'write_to_file',
        target: 'src/middleware/limiter.ts',
        timestamp: '2026-10-19T10:06:12.000Z',
      },
      elapsedFormatted: '1m 12s',
    });
    expect(state.items).toHaveLength(countBefore);
    let card = state.items.find((i) => i.kind === 'DelegationCard') as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
    expect(card.nowSentence).toBe('The implementer is writing src/middleware/limiter.ts, 1m 12s in.');

    // Command started (vitest)
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'COMMAND_STARTED',
        agent: 'implementer',
        command: 'npx vitest run',
        timestamp: '2026-10-19T10:06:20.000Z',
      },
      elapsedFormatted: '1m 20s',
    });
    expect(state.items).toHaveLength(countBefore);
    card = state.items.find((i) => i.kind === 'DelegationCard') as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
    expect(card.nowSentence).toBe('The implementer is running tests, 1m 20s in.');

    // Test summary
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'TEST_SUMMARY',
        agent: 'implementer',
        passed: 14,
        failed: 0,
        timestamp: '2026-10-19T10:06:30.000Z',
      },
      elapsedFormatted: '1m 30s',
    });
    expect(state.items).toHaveLength(countBefore);
    card = state.items.find((i) => i.kind === 'DelegationCard') as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
    expect(card.testSummaryText).toBe('14 of 14 tests pass so far.');
  });

  it('SUBAGENT_COMPLETED with DONE collapses DelegationCard', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 3',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_COMPLETED',
        role: 'implementer',
        verdict: 'DONE',
        elapsedMs: 72000,
        timestamp: '2026-10-19T10:06:12.000Z',
      },
      elapsedFormatted: '1m 12s',
    });

    const card = state.items.find((i) => i.kind === 'DelegationCard') as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
    expect(card.status).toBe('completed');
    expect(card.elapsedFormatted).toBe('1m 12s');
  });

  it('SUBAGENT_COMPLETED with DONE_WITH_CONCERNS collapses with status and note', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 3',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_COMPLETED',
        role: 'implementer',
        verdict: 'DONE_WITH_CONCERNS',
        elapsedMs: 72000,
        timestamp: '2026-10-19T10:06:12.000Z',
      },
      elapsedFormatted: '1m 12s',
    });

    const card = state.items.find((i) => i.kind === 'DelegationCard') as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
    expect(card.status).toBe('completed_with_concerns');
    expect(card.nextStepText).toBe('Finished with concerns. Reviewer will check.');
  });

  it('SUBAGENT_COMPLETED with BLOCKED converts card into FailureCard quoting lastErrorLine', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't4', index: 4, title: 'Integration tests', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 4',
        timestamp: '2026-10-19T10:10:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_COMPLETED',
        role: 'implementer',
        verdict: 'BLOCKED',
        elapsedMs: 30000,
        timestamp: '2026-10-19T10:10:30.000Z',
      },
      elapsedFormatted: '30s',
      lastErrorLine: 'connection refused on localhost:6379',
    });

    expect(state.pendingDecisionCount).toBe(1);
    expect(state.latestBellDecisionId).toBeDefined();

    const failure = state.items.find((i) => i.kind === 'FailureCard') as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(failure).toBeDefined();
    expect(failure.taskNumber).toBe(4);
    expect(failure.role).toBe('implementer');
    expect(failure.failureKind).toBe('blocked');
    expect(failure.reason).toBe('connection refused on localhost:6379');
    expect(failure.options).toEqual([
      { index: 1, label: 'Retry the task', action: 'retry' },
      { index: 2, label: 'Skip it and continue the wave', action: 'skip' },
      { index: 3, label: 'Take over the terminal', action: 'takeover' },
    ]);
  });

  it('SUBAGENT_COMPLETED with NEEDS_CONTEXT falls back to default reason if none provided', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't4', index: 4, title: 'Integration tests', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 4',
        timestamp: '2026-10-19T10:10:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_COMPLETED',
        role: 'implementer',
        verdict: 'NEEDS_CONTEXT',
        elapsedMs: 20000,
        timestamp: '2026-10-19T10:10:20.000Z',
      },
      elapsedFormatted: '20s',
      lastErrorLine: null,
    });

    const failure = state.items.find((i) => i.kind === 'FailureCard') as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(failure).toBeDefined();
    expect(failure.failureKind).toBe('needs_context');
    expect(failure.reason).toBe(
      'The implementer reported it is blocked and did not say why. Open the agent to read its last output.'
    );
  });

  it('NEW_COMMIT appends a CommitLine and links to card', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't2', index: 2, title: 'Token bucket', status: 'in_progress' }],
    });

    state = reduceNarrator(state, {
      type: 'NEW_COMMIT',
      sha: 'f4e5d6a',
      subject: 'Task 2 committed: token bucket',
      timestamp: '2026-10-19T10:08:00.000Z',
    });

    const commitLine = state.items.find((i) => i.kind === 'CommitLine') as Extract<TranscriptItem, { kind: 'CommitLine' }>;
    expect(commitLine).toBeDefined();
    expect(commitLine.sha).toBe('f4e5d6a');
    expect(commitLine.taskNumber).toBe(2);
    expect(commitLine.message).toBe('Task 2 committed: token bucket');
  });

  it('LEDGER_STATUS_CHANGED appends PhaseChange, emits context reset when starting execution, and appends CompletionCard when done', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [
        { id: 't1', index: 1, title: 'Task 1', status: 'completed' },
        { id: 't2', index: 2, title: 'Task 2', status: 'completed' },
      ],
    });

    // Planning -> Executing
    state = reduceNarrator(state, {
      type: 'LEDGER_STATUS_CHANGED',
      prevStatus: 'PLANNING',
      status: 'EXECUTING',
      timestamp: '2026-10-19T10:04:00.000Z',
    });

    const phase = state.items.find((i) => i.kind === 'PhaseChange') as Extract<TranscriptItem, { kind: 'PhaseChange' }>;
    expect(phase).toBeDefined();
    expect(phase.phase).toBe('EXECUTING');

    const resetNote = state.items.find(
      (i) => i.kind === 'SupervisorNote' && i.text === CONTEXT_RESET_NOTE
    );
    expect(resetNote).toBeDefined();

    // Add a commit line to check commitCount on completion
    state = reduceNarrator(state, {
      type: 'NEW_COMMIT',
      sha: 'abc1234',
      subject: 'Task 1 done',
      timestamp: '2026-10-19T10:05:00.000Z',
    });

    // Executing -> Completed
    state = reduceNarrator(state, {
      type: 'LEDGER_STATUS_CHANGED',
      prevStatus: 'EXECUTING',
      status: 'COMPLETED',
      branchName: 'feature/rate-limiter',
      totalElapsedFormatted: '12m 45s',
      timestamp: '2026-10-19T10:20:00.000Z',
    });

    const completion = state.items.find((i) => i.kind === 'CompletionCard') as Extract<TranscriptItem, { kind: 'CompletionCard' }>;
    expect(completion).toBeDefined();
    expect(completion.branchName).toBe('feature/rate-limiter');
    expect(completion.taskCount).toBe(2);
    expect(completion.commitCount).toBe(1);
    expect(completion.totalElapsedFormatted).toBe('12m 45s');
    expect(completion.verifierResult).toBeDefined();
  });

  it('LEDGER_STATUS_CHANGED from IDLE to PLANNING at startup updates ledgerStatus without a PhaseChange item', () => {
    const initial = createInitialNarratorState();
    expect(initial.hasStarted).toBe(false);
    expect(initial.tasks).toHaveLength(0);

    const next = reduceNarrator(initial, {
      type: 'LEDGER_STATUS_CHANGED',
      prevStatus: 'IDLE',
      status: 'PLANNING',
      timestamp: '2026-10-19T10:00:30.000Z',
    });

    expect(next.ledgerStatus).toBe('PLANNING');
    expect(next.items.some((i) => i.kind === 'PhaseChange')).toBe(false);
    expect(next.items).toHaveLength(initial.items.length);
  });

  it('LEDGER_STATUS_CHANGED from IDLE to EXECUTING at startup updates ledgerStatus without a PhaseChange item', () => {
    const initial = createInitialNarratorState();
    expect(initial.hasStarted).toBe(false);
    expect(initial.tasks).toHaveLength(0);

    const next = reduceNarrator(initial, {
      type: 'LEDGER_STATUS_CHANGED',
      prevStatus: 'IDLE',
      status: 'EXECUTING',
      timestamp: '2026-10-19T10:00:45.000Z',
    });

    expect(next.ledgerStatus).toBe('EXECUTING');
    expect(next.items.some((i) => i.kind === 'PhaseChange')).toBe(false);
    expect(next.items).toHaveLength(initial.items.length);
  });

  it('DECISION_PROMPT appends DecisionCard and increments pendingDecisionCount', () => {
    let state = createInitialNarratorState();

    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'DECISION_PROMPT',
        promptKind: 'ask_question',
        headline: 'The supervisor needs a product decision',
        question: 'When a key goes over its limit, what should the API return?',
        contextLine: 'I checked first: docs/api.md has no rule.',
        options: [
          { index: 1, label: '429 with Retry-After header', recommended: true },
          { index: 2, label: '403 Forbidden with JSON' },
        ],
        timestamp: '2026-10-19T10:07:00.000Z',
      },
      elapsedFormatted: '2m 00s',
    });

    expect(state.pendingDecisionCount).toBe(1);
    expect(state.latestBellDecisionId).toBeDefined();

    const decision = state.items.find((i) => i.kind === 'DecisionCard') as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(decision).toBeDefined();
    expect(decision.status).toBe('pending');
    expect(decision.selectedOptionIndex).toBe(1);
    expect(decision.options).toHaveLength(2);

    // Streaming update for same question does not double count
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'DECISION_PROMPT',
        promptKind: 'ask_question',
        headline: 'The supervisor needs a product decision',
        question: 'When a key goes over its limit, what should the API return?',
        options: [
          { index: 1, label: '429 with Retry-After header', recommended: true },
          { index: 2, label: '403 Forbidden with JSON' },
          { index: 3, label: '503 Service Unavailable' },
        ],
        timestamp: '2026-10-19T10:07:02.000Z',
      },
      elapsedFormatted: '2m 02s',
    });

    expect(state.pendingDecisionCount).toBe(1);
    const updated = state.items.find((i) => i.kind === 'DecisionCard') as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(updated.options).toHaveLength(3);

    // Answer decision
    state = reduceNarrator(state, {
      type: 'DECISION_ANSWERED',
      id: decision.id,
      answerText: '429 with Retry-After header',
    });

    expect(state.pendingDecisionCount).toBe(0);
    const answered = state.items.find((i) => i.id === decision.id) as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(answered.status).toBe('answered');
    expect(answered.answeredText).toBe('429 with Retry-After header');
  });

  it('DECISION_ANSWERED on FailureCard resolves card and decrements pending count', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'PTY_EXITED',
      exitCode: 1,
      lastErrorLine: 'fatal error',
      timestamp: '2026-10-19T10:15:00.000Z',
    });

    expect(state.pendingDecisionCount).toBe(1);
    const failure = state.items.find((i) => i.kind === 'FailureCard') as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(failure).toBeDefined();

    state = reduceNarrator(state, {
      type: 'DECISION_ANSWERED',
      id: failure.id,
      answerText: 'Retry the task',
    });

    expect(state.pendingDecisionCount).toBe(0);
    const resolved = state.items.find((i) => i.id === failure.id) as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedText).toBe('Retry the task');
  });

  it('QUIET_COUNT_UPDATED maintains single QuietCounter immediately above active card and omits at 0', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TASKS_UPDATED',
      tasks: [{ id: 't1', index: 1, title: 'Task 1', status: 'in_progress' }],
    });
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'SUBAGENT_DISPATCHED',
        role: 'implementer',
        rawLine: 'task 1',
        timestamp: '2026-10-19T10:05:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    // Update quiet count
    state = reduceNarrator(state, {
      type: 'QUIET_COUNT_UPDATED',
      promptsApproved: 14,
    });

    const cardIndex = state.items.findIndex((i) => i.kind === 'DelegationCard');
    const quietIndex = state.items.findIndex((i) => i.kind === 'QuietCounter');

    expect(quietIndex).toBe(cardIndex - 1);
    const quiet = state.items[quietIndex] as Extract<TranscriptItem, { kind: 'QuietCounter' }>;
    expect(quiet.promptsApproved).toBe(14);
    expect(quiet.text).toContain('14 permission prompts approved');

    // Update with 0 prompts removes it
    state = reduceNarrator(state, {
      type: 'QUIET_COUNT_UPDATED',
      promptsApproved: 0,
    });

    expect(state.items.some((i) => i.kind === 'QuietCounter')).toBe(false);
  });

  it('PTY_EXITED with non-zero exit code appends FailureCard with takeover/retry/quit options', () => {
    let state = createInitialNarratorState();

    state = reduceNarrator(state, {
      type: 'PTY_EXITED',
      exitCode: 137,
      lastErrorLine: 'Killed by OOM',
      timestamp: '2026-10-19T10:12:00.000Z',
    });

    expect(state.pendingDecisionCount).toBe(1);
    const failure = state.items.find((i) => i.kind === 'FailureCard') as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(failure).toBeDefined();
    expect(failure.failureKind).toBe('pty_exit');
    expect(failure.reason).toContain('Killed by OOM');
    expect(failure.options).toEqual([
      { index: 1, label: 'Retry the task', action: 'retry' },
      { index: 2, label: 'Take over the terminal', action: 'takeover' },
      { index: 3, label: 'Quit', action: 'quit' },
    ]);
  });

  it('supports DECISION_SELECTION_CHANGED, DECISION_DEFERRED, and DECISION_REFOCUSED', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'DECISION_PROMPT',
        promptKind: 'ask_question',
        headline: 'Test question',
        question: 'Choose an option',
        options: [
          { index: 1, label: 'Option A' },
          { index: 2, label: 'Option B' },
        ],
        timestamp: '2026-10-19T10:00:00.000Z',
      },
      elapsedFormatted: '0s',
    });

    const decisionId = state.items.find((i) => i.kind === 'DecisionCard')!.id;

    // Selection changed
    state = reduceNarrator(state, {
      type: 'DECISION_SELECTION_CHANGED',
      id: decisionId,
      selectedOptionIndex: 2,
    });
    let card = state.items.find((i) => i.id === decisionId) as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(card.selectedOptionIndex).toBe(2);

    // Defer
    state = reduceNarrator(state, {
      type: 'DECISION_DEFERRED',
      id: decisionId,
    });
    card = state.items.find((i) => i.id === decisionId) as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(card.status).toBe('deferred');

    // Refocus
    state = reduceNarrator(state, {
      type: 'DECISION_REFOCUSED',
    });
    card = state.items.find((i) => i.id === decisionId) as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
    expect(card.status).toBe('pending');
    expect(state.latestBellDecisionId).toBe(decisionId);
  });

  it('DECISION_DEFERRED and DECISION_REFOCUSED work on a FailureCard', () => {
    let state = createInitialNarratorState();
    state = reduceNarrator(state, {
      type: 'PTY_EXITED',
      exitCode: 1,
      lastErrorLine: 'fatal error',
      timestamp: '2026-10-19T10:15:00.000Z',
    });

    const failure = state.items.find(
      (i) => i.kind === 'FailureCard'
    ) as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(failure).toBeDefined();
    expect(failure.status).toBe('pending');

    state = reduceNarrator(state, {
      type: 'DECISION_DEFERRED',
      id: failure.id,
    });
    let card = state.items.find(
      (i) => i.id === failure.id
    ) as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(card.status).toBe('deferred');

    state = reduceNarrator(state, {
      type: 'DECISION_REFOCUSED',
    });
    card = state.items.find(
      (i) => i.id === failure.id
    ) as Extract<TranscriptItem, { kind: 'FailureCard' }>;
    expect(card.status).toBe('pending');
    expect(state.latestBellDecisionId).toBe(failure.id);
  });
});
