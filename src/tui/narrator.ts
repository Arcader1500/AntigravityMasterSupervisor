import type { PlanTaskItem, TelemetryEvent } from '../telemetry/types.js';
import {
  FIRST_LAUNCH_NOTE,
  CONTEXT_RESET_NOTE,
  formatNowSentence,
  formatTestSummarySentence,
  formatBlockedFallbackReason,
  formatPhaseChangeNote,
} from './narrator-copy.js';

export type TranscriptItem =
  | {
      id: string;
      kind: 'UserMessage';
      text: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'SupervisorNote';
      text: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'PhaseChange';
      text: string;
      phase: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'DelegationCard';
      taskId: string;
      taskNumber: number;
      totalTasks?: number;
      title: string;
      wave?: number;
      totalWaves?: number;
      role: string;
      status: 'running' | 'paused' | 'completed' | 'completed_with_concerns';
      nowSentence: string;
      elapsedFormatted: string;
      testSummaryText?: string;
      nextStepText?: string;
      commitSha?: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'CommitLine';
      sha: string;
      taskNumber?: number;
      message: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'DecisionCard';
      promptKind: 'ask_question' | 'permission' | 'checkpoint_spec';
      headline: string;
      question: string;
      contextLine?: string;
      options: Array<{ index: number; label: string; recommended?: boolean }>;
      status: 'pending' | 'deferred' | 'answered';
      selectedOptionIndex: number; // 1-based default 1 when composer empty
      answeredText?: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'QuietCounter';
      promptsApproved: number;
      questionsAnswered?: number;
      planFixes?: number;
      text: string;
    }
  | {
      id: string;
      kind: 'FailureCard';
      taskNumber?: number;
      role: string;
      headline: string;
      reason: string;
      failureKind: 'blocked' | 'needs_context' | 'verify_failed' | 'pty_exit';
      options: Array<{ index: number; label: string; action: 'retry' | 'skip' | 'takeover' | 'quit' }>;
      status: 'pending' | 'resolved';
      selectedOptionIndex: number;
      resolvedText?: string;
      timestamp: string;
    }
  | {
      id: string;
      kind: 'CompletionCard';
      branchName: string;
      taskCount: number;
      commitCount: number;
      verifierResult: string;
      totalElapsedFormatted: string;
      timestamp: string;
    };

export interface NarratorState {
  hasStarted: boolean;
  items: TranscriptItem[];
  pendingDecisionCount: number;
  latestBellDecisionId: string | null;
  tasks: PlanTaskItem[];
  activeTaskNumber: number;
  ledgerStatus: string;
}

export type NarratorInputEvent =
  | { type: 'USER_MESSAGE'; text: string; timestamp: string }
  | { type: 'TELEMETRY_EVENT'; event: TelemetryEvent; elapsedFormatted: string; lastErrorLine?: string | null }
  | { type: 'TASKS_UPDATED'; tasks: PlanTaskItem[] }
  | { type: 'NEW_COMMIT'; sha: string; subject: string; timestamp: string }
  | { type: 'LEDGER_STATUS_CHANGED'; status: string; prevStatus: string; branchName?: string; totalElapsedFormatted?: string; timestamp: string }
  | { type: 'PTY_EXITED'; exitCode: number; lastErrorLine?: string | null; timestamp: string }
  | { type: 'DECISION_SELECTION_CHANGED'; id: string; selectedOptionIndex: number }
  | { type: 'DECISION_DEFERRED'; id: string }
  | { type: 'DECISION_REFOCUSED' }
  | { type: 'DECISION_ANSWERED'; id: string; answerText: string }
  | { type: 'QUIET_COUNT_UPDATED'; promptsApproved: number; questionsAnswered?: number; planFixes?: number }
  | { type: 'APPEND_SUPERVISOR_NOTE'; text: string; timestamp: string }
  | { type: 'TICK_ELAPSED'; elapsedFormatted: string };

export function createInitialNarratorState(initialTimestamp?: string): NarratorState {
  const timestamp = initialTimestamp ?? new Date().toISOString();
  return {
    hasStarted: false,
    items: [
      {
        id: `supervisor-note-initial-${timestamp}`,
        kind: 'SupervisorNote',
        text: FIRST_LAUNCH_NOTE,
        timestamp,
      },
    ],
    pendingDecisionCount: 0,
    latestBellDecisionId: null,
    tasks: [],
    activeTaskNumber: 0,
    ledgerStatus: 'IDLE',
  };
}

function repositionQuietCounter(items: TranscriptItem[]): TranscriptItem[] {
  const quietIndex = items.findIndex((i) => i.kind === 'QuietCounter');
  if (quietIndex === -1) return items;

  const quietItem = items[quietIndex];
  const withoutQuiet = items.filter((_, idx) => idx !== quietIndex);

  const activeCardIndex = withoutQuiet.findIndex(
    (i) => i.kind === 'DelegationCard' && (i.status === 'running' || i.status === 'paused')
  );

  if (activeCardIndex !== -1) {
    const result = [...withoutQuiet];
    result.splice(activeCardIndex, 0, quietItem);
    return result;
  }

  return [...withoutQuiet, quietItem];
}

function getWaveCount(tasks: PlanTaskItem[]): number | undefined {
  const waves = tasks.map((t) => t.wave).filter((w): w is number => typeof w === 'number' && w > 0);
  if (waves.length === 0) return undefined;
  return Math.max(...waves);
}

function resolveTask(
  state: NarratorState,
  explicitTaskNumber?: number
): {
  taskNumber: number;
  title: string;
  wave?: number;
  totalWaves?: number;
  totalTasks?: number;
  taskId: string;
} {
  let matchedTask: PlanTaskItem | undefined;

  if (explicitTaskNumber !== undefined && explicitTaskNumber > 0) {
    matchedTask =
      state.tasks.find((t) => t.index === explicitTaskNumber) ||
      state.tasks[explicitTaskNumber - 1];
  }

  if (!matchedTask && state.activeTaskNumber > 0) {
    matchedTask =
      state.tasks.find((t) => t.index === state.activeTaskNumber) ||
      state.tasks[state.activeTaskNumber - 1];
  }

  if (!matchedTask) {
    matchedTask = state.tasks.find((t) => t.status === 'in_progress');
  }

  if (!matchedTask) {
    matchedTask = state.tasks.find((t) => t.status === 'pending');
  }

  const taskNumber = explicitTaskNumber ?? matchedTask?.index ?? (state.activeTaskNumber > 0 ? state.activeTaskNumber : 1);
  const title = matchedTask?.title ?? `Task ${taskNumber}`;
  const totalTasks = state.tasks.length > 0 ? state.tasks.length : undefined;
  const totalWaves = matchedTask?.totalWaves ?? getWaveCount(state.tasks);
  const wave = matchedTask?.wave;
  const taskId = matchedTask?.id ?? `task-${taskNumber}`;

  return { taskNumber, title, wave, totalWaves, totalTasks, taskId };
}

function reduceTelemetryEvent(
  state: NarratorState,
  event: TelemetryEvent,
  elapsedFormatted: string,
  lastErrorLine?: string | null
): NarratorState {
  switch (event.type) {
    case 'SUBAGENT_DISPATCHED': {
      const taskMatch = event.rawLine ? event.rawLine.match(/task\s+(\d+)/i) : null;
      const explicitTaskNum = taskMatch ? parseInt(taskMatch[1], 10) : undefined;
      const { taskNumber, title, wave, totalWaves, totalTasks, taskId } = resolveTask(
        state,
        explicitTaskNum
      );

      const nowSentence = formatNowSentence(event.role, undefined, undefined, elapsedFormatted);

      const existingCardIndex = state.items.findIndex(
        (i) => i.kind === 'DelegationCard' && i.status === 'running' && i.taskNumber === taskNumber
      );

      let items: TranscriptItem[];
      if (existingCardIndex !== -1) {
        items = [...state.items];
        items[existingCardIndex] = {
          ...items[existingCardIndex],
          role: event.role,
          nowSentence,
          elapsedFormatted,
          timestamp: event.timestamp,
        } as TranscriptItem;
      } else {
        const newCard: TranscriptItem = {
          id: `delegation-${taskNumber}-${event.timestamp}`,
          kind: 'DelegationCard',
          taskId,
          taskNumber,
          totalTasks,
          title,
          wave,
          totalWaves,
          role: event.role,
          status: 'running',
          nowSentence,
          elapsedFormatted,
          timestamp: event.timestamp,
        };
        items = [...state.items, newCard];
      }

      return {
        ...state,
        hasStarted: true,
        activeTaskNumber: taskNumber,
        items: repositionQuietCounter(items),
      };
    }

    case 'TOOL_CALLED': {
      const items = [...state.items];
      let targetIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          if (item.role.toLowerCase() === event.agent.toLowerCase()) {
            targetIndex = i;
            break;
          }
          if (targetIndex === -1) {
            targetIndex = i;
          }
        }
      }

      if (targetIndex !== -1) {
        const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
        const target = event.target || event.mcpQuery;
        items[targetIndex] = {
          ...card,
          nowSentence: formatNowSentence(card.role, event.toolName, target, elapsedFormatted),
          elapsedFormatted,
        };
      }

      return { ...state, items };
    }

    case 'COMMAND_STARTED': {
      const items = [...state.items];
      let targetIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          if (item.role.toLowerCase() === event.agent.toLowerCase()) {
            targetIndex = i;
            break;
          }
          if (targetIndex === -1) {
            targetIndex = i;
          }
        }
      }

      if (targetIndex !== -1) {
        const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
        items[targetIndex] = {
          ...card,
          nowSentence: formatNowSentence(card.role, 'run_command', event.command, elapsedFormatted),
          elapsedFormatted,
        };
      }

      return { ...state, items };
    }

    case 'COMMAND_FINISHED': {
      if (!event.testSummary) {
        return state;
      }
      const items = [...state.items];
      let targetIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex !== -1) {
        const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
        items[targetIndex] = {
          ...card,
          testSummaryText: formatTestSummarySentence(
            card.role,
            event.testSummary.passed,
            event.testSummary.failed
          ),
          elapsedFormatted,
        };
      }

      return { ...state, items };
    }

    case 'TEST_SUMMARY': {
      const items = [...state.items];
      let targetIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex !== -1) {
        const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
        items[targetIndex] = {
          ...card,
          testSummaryText: formatTestSummarySentence(card.role, event.passed, event.failed),
          elapsedFormatted,
        };
      }

      return { ...state, items };
    }

    case 'SUBAGENT_COMPLETED': {
      const items = [...state.items];
      let targetIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          if (item.role.toLowerCase() === event.role.toLowerCase()) {
            targetIndex = i;
            break;
          }
          if (targetIndex === -1) {
            targetIndex = i;
          }
        }
      }

      if (
        event.verdict === 'DONE' ||
        event.verdict === 'APPROVE' ||
        event.verdict === 'PASS'
      ) {
        if (targetIndex !== -1) {
          const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
          items[targetIndex] = {
            ...card,
            status: 'completed',
            elapsedFormatted,
          };
        }
        return { ...state, items: repositionQuietCounter(items) };
      }

      if (event.verdict === 'DONE_WITH_CONCERNS') {
        if (targetIndex !== -1) {
          const card = items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>;
          items[targetIndex] = {
            ...card,
            status: 'completed_with_concerns',
            nextStepText: 'Finished with concerns. Reviewer will check.',
            elapsedFormatted,
          };
        }
        return { ...state, items: repositionQuietCounter(items) };
      }

      if (
        event.verdict === 'BLOCKED' ||
        event.verdict === 'NEEDS_CONTEXT' ||
        event.verdict === 'FAIL' ||
        event.verdict === 'REQUEST_CHANGES'
      ) {
        const card =
          targetIndex !== -1
            ? (items[targetIndex] as Extract<TranscriptItem, { kind: 'DelegationCard' }>)
            : null;

        const taskNumber =
          card?.taskNumber ?? (state.activeTaskNumber > 0 ? state.activeTaskNumber : undefined);
        const cardId = card?.id ?? `failure-${event.timestamp}`;

        let failureKind: 'blocked' | 'needs_context' | 'verify_failed' = 'blocked';
        if (event.verdict === 'NEEDS_CONTEXT') {
          failureKind = 'needs_context';
        } else if (event.verdict === 'FAIL') {
          failureKind = 'verify_failed';
        }

        const reason =
          event.reason && event.reason.trim()
            ? event.reason.trim()
            : lastErrorLine && lastErrorLine.trim()
            ? lastErrorLine.trim()
            : formatBlockedFallbackReason(event.role);

        const headline = taskNumber
          ? `Task ${taskNumber} is ${failureKind === 'blocked' ? 'blocked' : failureKind === 'needs_context' ? 'needs context' : 'failed'}`
          : `${event.role} is ${failureKind === 'blocked' ? 'blocked' : failureKind === 'needs_context' ? 'needs context' : 'failed'}`;

        const failureCard: TranscriptItem = {
          id: cardId,
          kind: 'FailureCard',
          taskNumber,
          role: event.role,
          headline,
          reason,
          failureKind,
          options: [
            { index: 1, label: 'Retry the task', action: 'retry' },
            { index: 2, label: 'Skip it and continue the wave', action: 'skip' },
            { index: 3, label: 'Take over the terminal', action: 'takeover' },
          ],
          status: 'pending',
          selectedOptionIndex: 1,
          timestamp: event.timestamp,
        };

        if (targetIndex !== -1) {
          items[targetIndex] = failureCard;
        } else {
          items.push(failureCard);
        }

        return {
          ...state,
          items: repositionQuietCounter(items),
          pendingDecisionCount: state.pendingDecisionCount + 1,
          latestBellDecisionId: cardId,
        };
      }

      return state;
    }

    case 'DECISION_PROMPT': {
      const items = [...state.items];
      const existingIndex = items.findIndex(
        (i) => i.kind === 'DecisionCard' && i.status === 'pending' && i.question === event.question
      );

      if (existingIndex !== -1) {
        const existing = items[existingIndex] as Extract<TranscriptItem, { kind: 'DecisionCard' }>;
        items[existingIndex] = {
          ...existing,
          headline: event.headline || existing.headline,
          contextLine: event.contextLine ?? existing.contextLine,
          options: event.options,
          timestamp: event.timestamp,
        };
        return {
          ...state,
          items: repositionQuietCounter(items),
          latestBellDecisionId: existing.id,
        };
      }

      const cardId = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newCard: TranscriptItem = {
        id: cardId,
        kind: 'DecisionCard',
        promptKind: event.promptKind,
        headline: event.headline,
        question: event.question,
        contextLine: event.contextLine,
        options: event.options,
        status: 'pending',
        selectedOptionIndex: 1,
        timestamp: event.timestamp,
      };

      return {
        ...state,
        items: repositionQuietCounter([...items, newCard]),
        pendingDecisionCount: state.pendingDecisionCount + 1,
        latestBellDecisionId: cardId,
      };
    }

    default:
      return state;
  }
}

export function reduceNarrator(state: NarratorState, event: NarratorInputEvent): NarratorState {
  switch (event.type) {
    case 'USER_MESSAGE': {
      const userItem: TranscriptItem = {
        id: `user-${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'UserMessage',
        text: event.text,
        timestamp: event.timestamp,
      };
      return {
        ...state,
        hasStarted: true,
        items: repositionQuietCounter([...state.items, userItem]),
      };
    }

    case 'TASKS_UPDATED': {
      let activeTaskNumber = state.activeTaskNumber;
      const inProg = event.tasks.find((t) => t.status === 'in_progress');
      if (inProg && inProg.index) {
        activeTaskNumber = inProg.index;
      }

      const items = state.items.map((item) => {
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          const matched =
            event.tasks.find((t) => t.index === item.taskNumber) ||
            event.tasks.find((t) => t.id === item.taskId);
          if (matched) {
            return {
              ...item,
              title: matched.title,
              wave: matched.wave,
              totalWaves: matched.totalWaves ?? getWaveCount(event.tasks),
              totalTasks: event.tasks.length > 0 ? event.tasks.length : item.totalTasks,
            };
          }
        }
        return item;
      });

      return {
        ...state,
        tasks: event.tasks,
        activeTaskNumber,
        items,
      };
    }

    case 'NEW_COMMIT': {
      const match = event.subject.match(/Task\s+(\d+)/i);
      const parsedTaskNum = match ? parseInt(match[1], 10) : undefined;
      const taskNumber =
        parsedTaskNum ?? (state.activeTaskNumber > 0 ? state.activeTaskNumber : undefined);

      const commitItem: TranscriptItem = {
        id: `commit-${event.sha}-${event.timestamp}`,
        kind: 'CommitLine',
        sha: event.sha,
        taskNumber,
        message: event.subject,
        timestamp: event.timestamp,
      };

      const updatedItems = [...state.items, commitItem].map((item) => {
        if (item.kind === 'DelegationCard' && taskNumber !== undefined && item.taskNumber === taskNumber) {
          return { ...item, commitSha: event.sha };
        }
        return item;
      });

      return {
        ...state,
        items: repositionQuietCounter(updatedItems),
      };
    }

    case 'LEDGER_STATUS_CHANGED': {
      let items = [...state.items];
      const phaseChangeText = formatPhaseChangeNote(
        event.prevStatus,
        event.status,
        undefined,
        state.tasks.length,
        getWaveCount(state.tasks)
      );

      items.push({
        id: `phase-${event.status}-${event.timestamp}`,
        kind: 'PhaseChange',
        text: phaseChangeText,
        phase: event.status,
        timestamp: event.timestamp,
      });

      if (
        (event.prevStatus === 'PLANNING' || event.prevStatus === 'CHECKPOINT_SPEC') &&
        event.status === 'EXECUTING'
      ) {
        items.push({
          id: `context-reset-${event.timestamp}`,
          kind: 'SupervisorNote',
          text: CONTEXT_RESET_NOTE,
          timestamp: event.timestamp,
        });
      }

      if (event.status === 'COMPLETED') {
        items = items.map((item) => {
          if (item.kind === 'DelegationCard' && (item.status === 'running' || item.status === 'paused')) {
            return { ...item, status: 'completed' };
          }
          return item;
        });

        const commitCount = items.filter((i) => i.kind === 'CommitLine').length;
        items.push({
          id: `completion-${event.timestamp}`,
          kind: 'CompletionCard',
          branchName: event.branchName || '',
          taskCount: state.tasks.length,
          commitCount,
          verifierResult: 'All checks passed',
          totalElapsedFormatted: event.totalElapsedFormatted || '0s',
          timestamp: event.timestamp,
        });
      }

      return {
        ...state,
        ledgerStatus: event.status,
        items: repositionQuietCounter(items),
      };
    }

    case 'PTY_EXITED': {
      if (event.exitCode === 0) {
        return state;
      }

      const ptyFailureId = `pty-exit-${event.timestamp}`;
      const reason =
        event.lastErrorLine && event.lastErrorLine.trim()
          ? event.lastErrorLine.trim()
          : `The process exited unexpectedly with code ${event.exitCode}.`;

      const failureCard: TranscriptItem = {
        id: ptyFailureId,
        kind: 'FailureCard',
        taskNumber: state.activeTaskNumber > 0 ? state.activeTaskNumber : undefined,
        role: 'orchestrator',
        headline: `Process exited with code ${event.exitCode}`,
        reason,
        failureKind: 'pty_exit',
        options: [
          { index: 1, label: 'Retry the task', action: 'retry' },
          { index: 2, label: 'Take over the terminal', action: 'takeover' },
          { index: 3, label: 'Quit', action: 'quit' },
        ],
        status: 'pending',
        selectedOptionIndex: 1,
        timestamp: event.timestamp,
      };

      return {
        ...state,
        items: repositionQuietCounter([...state.items, failureCard]),
        pendingDecisionCount: state.pendingDecisionCount + 1,
        latestBellDecisionId: ptyFailureId,
      };
    }

    case 'DECISION_SELECTION_CHANGED': {
      const items = state.items.map((item) => {
        if (item.id === event.id) {
          if (item.kind === 'DecisionCard' || item.kind === 'FailureCard') {
            return { ...item, selectedOptionIndex: event.selectedOptionIndex };
          }
        }
        return item;
      });
      return { ...state, items };
    }

    case 'DECISION_DEFERRED': {
      const items = state.items.map((item) => {
        if (item.id === event.id && item.kind === 'DecisionCard') {
          return { ...item, status: 'deferred' as const };
        }
        return item;
      });
      return { ...state, items };
    }

    case 'DECISION_REFOCUSED': {
      let refocusedId: string | null = null;
      const items = state.items.map((item) => {
        if (!refocusedId && item.kind === 'DecisionCard' && item.status === 'deferred') {
          refocusedId = item.id;
          return { ...item, status: 'pending' as const };
        }
        return item;
      });
      return {
        ...state,
        items,
        latestBellDecisionId: refocusedId ?? state.latestBellDecisionId,
      };
    }

    case 'DECISION_ANSWERED': {
      let decremented = false;
      const items = state.items.map((item) => {
        if (item.id === event.id) {
          if (item.kind === 'DecisionCard' && item.status !== 'answered') {
            decremented = true;
            return {
              ...item,
              status: 'answered' as const,
              answeredText: event.answerText,
            };
          }
          if (item.kind === 'FailureCard' && item.status !== 'resolved') {
            decremented = true;
            return {
              ...item,
              status: 'resolved' as const,
              resolvedText: event.answerText,
            };
          }
        }
        return item;
      });

      return {
        ...state,
        items: repositionQuietCounter(items),
        pendingDecisionCount: decremented
          ? Math.max(0, state.pendingDecisionCount - 1)
          : state.pendingDecisionCount,
        latestBellDecisionId:
          state.latestBellDecisionId === event.id ? null : state.latestBellDecisionId,
      };
    }

    case 'QUIET_COUNT_UPDATED': {
      if (event.promptsApproved === 0) {
        return {
          ...state,
          items: state.items.filter((i) => i.kind !== 'QuietCounter'),
        };
      }

      const text =
        event.questionsAnswered !== undefined
          ? `${event.promptsApproved} permission prompts approved for you. ${event.questionsAnswered} questions answered.`
          : `${event.promptsApproved} permission prompts approved for you. None needed you.`;

      const quietItem: TranscriptItem = {
        id: 'quiet-counter',
        kind: 'QuietCounter',
        promptsApproved: event.promptsApproved,
        questionsAnswered: event.questionsAnswered,
        planFixes: event.planFixes,
        text,
      };

      const withoutQuiet = state.items.filter((i) => i.kind !== 'QuietCounter');
      const activeCardIndex = withoutQuiet.findIndex(
        (i) => i.kind === 'DelegationCard' && (i.status === 'running' || i.status === 'paused')
      );

      let items: TranscriptItem[];
      if (activeCardIndex !== -1) {
        items = [...withoutQuiet];
        items.splice(activeCardIndex, 0, quietItem);
      } else {
        items = [...withoutQuiet, quietItem];
      }

      return {
        ...state,
        items,
      };
    }

    case 'APPEND_SUPERVISOR_NOTE': {
      const noteItem: TranscriptItem = {
        id: `supervisor-note-${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'SupervisorNote',
        text: event.text,
        timestamp: event.timestamp,
      };
      return {
        ...state,
        items: repositionQuietCounter([...state.items, noteItem]),
      };
    }

    case 'TICK_ELAPSED': {
      const items = state.items.map((item) => {
        if (item.kind === 'DelegationCard' && item.status === 'running') {
          return {
            ...item,
            elapsedFormatted: event.elapsedFormatted,
            nowSentence: item.nowSentence.replace(/, [^,]+ in\.$/, `, ${event.elapsedFormatted} in.`),
          };
        }
        return item;
      });
      return { ...state, items };
    }

    case 'TELEMETRY_EVENT': {
      return reduceTelemetryEvent(state, event.event, event.elapsedFormatted, event.lastErrorLine);
    }

    default:
      return state;
  }
}
