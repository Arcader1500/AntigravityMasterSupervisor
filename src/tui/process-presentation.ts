import type { ProcessOutcome, SupervisorLedger } from '../core/types.js';
import { formatProcessOutcome } from '../core/process-outcome.js';
import type { ObservationSource, TelemetrySnapshot } from '../telemetry/types.js';

export interface ProcessPresentation {
  outcomeText: string;
  sourceText: string;
  reviewText: string;
  progressText: string;
  progressKind: 'reported' | 'recorded';
  legacyCompleted: boolean;
}

interface PersistedProcessState {
  runId?: string;
  started: boolean;
  outcomeRunId?: string;
  outcome?: ProcessOutcome;
}

function latestPersistedProcessState(ledger: SupervisorLedger): PersistedProcessState {
  const event = [...ledger.events].reverse().find((entry) => {
    const metadata = entry.metadata;
    return (metadata?.kind === 'PROCESS_STARTED' || metadata?.kind === 'PROCESS_OUTCOME') &&
      metadata.sessionId === ledger.sessionId && typeof metadata.runId === 'string';
  });
  if (!event?.metadata) return { started: false };
  const metadata = event.metadata;
  const runId = metadata.runId as string;
  if (metadata.kind === 'PROCESS_STARTED') return { runId, started: true };

  const base = { runId, sessionId: ledger.sessionId, observedAt: event.timestamp };
  if (metadata.outcomeKind === 'exit') {
    return { runId, started: false, outcomeRunId: runId, outcome: {
      ...base,
      kind: 'exit',
      ...(typeof metadata.exitCode === 'number' ? { exitCode: metadata.exitCode } : {}),
      ...(typeof metadata.signal === 'number' ? { signal: metadata.signal } : {}),
    } };
  }
  if (metadata.outcomeKind === 'interrupted') {
    return { runId, started: false, outcomeRunId: runId, outcome: {
      ...base,
      kind: 'interrupted',
      ...(typeof metadata.supervisorSignal === 'string' ? { supervisorSignal: metadata.supervisorSignal } : {}),
      ...(typeof metadata.supervisorExitCode === 'number' ? { supervisorExitCode: metadata.supervisorExitCode } : {}),
    } };
  }
  if (metadata.outcomeKind === 'startup_error' && typeof metadata.message === 'string') {
    return { runId, started: false, outcomeRunId: runId, outcome: { ...base, kind: 'startup_error', message: metadata.message } };
  }
  return { runId, started: false, outcomeRunId: runId };
}

function sourceLabel(source: ObservationSource | undefined): string {
  switch (source) {
    case 'agent_output': return 'agent output';
    case 'artifacts': return 'artifacts';
    case 'ledger': return 'recorded ledger';
    default: return 'source unavailable';
  }
}

export function deriveProcessPresentation(
  ledger: SupervisorLedger,
  snapshot?: TelemetrySnapshot
): ProcessPresentation {
  const persisted = latestPersistedProcessState(ledger);
  const snapshotOutcome = snapshot?.processOutcome;
  const outcome = persisted.outcome ?? (
    persisted.started
      ? snapshotOutcome?.runId === persisted.runId ? snapshotOutcome : undefined
      : persisted.outcomeRunId
        ? snapshotOutcome?.runId === persisted.outcomeRunId ? snapshotOutcome : undefined
        : snapshotOutcome
  );
  const processStarted = !outcome && persisted.started;
  const incompleteOutcome = !outcome && persisted.outcomeRunId !== undefined;
  const legacyCompleted = !outcome && !processStarted && !incompleteOutcome && ledger.status === 'COMPLETED';
  const outcomeText = outcome
    ? formatProcessOutcome(outcome)
    : incompleteOutcome
      ? `Process outcome record for run ${persisted.outcomeRunId} is incomplete.`
      : processStarted
        ? `Process start recorded for run ${persisted.runId}; no outcome is recorded for this run.`
        : legacyCompleted
          ? 'Legacy ledger status: COMPLETED; process outcome is not recorded.'
          : ledger.status === 'IDLE'
            ? 'No process outcome recorded; this session may not have started a child process.'
            : 'Process outcome is not recorded.';
  const source = outcome
    ? persisted.outcomeRunId === outcome.runId ? 'ledger' : snapshot?.processOutcomeSource
    : processStarted || incompleteOutcome
      ? 'ledger'
    : snapshot?.phaseSource ?? 'ledger';
  const taskCount = snapshot?.tasks?.length ?? 0;
  const completedCount = snapshot?.tasks?.filter((task) => task.status === 'completed').length ?? 0;
  const progressKind = 'recorded' as const;
  const progress = taskCount > 0
    ? `${completedCount} of ${taskCount} tasks are recorded complete in artifacts progress`
    : `Ledger status ${ledger.status} is recorded`;

  return {
    outcomeText,
    sourceText: `Source: ${sourceLabel(source)}.`,
    reviewText: 'Review and verification are unconfirmed.',
    progressText: `${progress}; this does not establish review or verification.`,
    progressKind,
    legacyCompleted,
  };
}
