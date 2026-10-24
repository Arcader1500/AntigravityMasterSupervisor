import { randomUUID } from 'node:crypto';
import { loadLedger, saveLedgerAtomic } from './ledger.js';
import type { ProcessOutcome, ProcessRunContext, SupervisorLedger } from './types.js';

const MAX_STARTUP_ERROR_LENGTH = 500;

export function createProcessRunContext(sessionId: string): ProcessRunContext {
  return { runId: randomUUID(), sessionId };
}

export function recordProcessOutcome(
  projectDir: string,
  outcome: ProcessOutcome
): { ledger: SupervisorLedger; recorded: boolean } {
  const ledger = loadLedger(projectDir);
  if (ledger.sessionId !== outcome.sessionId) {
    throw new Error(`Process outcome session ${outcome.sessionId} does not match current ledger session ${ledger.sessionId}`);
  }

  if (ledger.events.some((event) => event.metadata?.kind === 'PROCESS_OUTCOME' && event.metadata.runId === outcome.runId)) {
    return { ledger, recorded: false };
  }

  const metadata: Record<string, unknown> = {
    kind: 'PROCESS_OUTCOME',
    runId: outcome.runId,
    sessionId: outcome.sessionId,
    outcomeKind: outcome.kind,
  };
  if (outcome.kind === 'exit') {
    if (outcome.exitCode !== undefined) metadata.exitCode = outcome.exitCode;
    if (outcome.signal !== undefined) metadata.signal = outcome.signal;
    ledger.status = outcome.exitCode === 0 ? 'IDLE' : 'FAILED';
  } else if (outcome.kind === 'interrupted') {
    if (outcome.supervisorSignal !== undefined) metadata.supervisorSignal = outcome.supervisorSignal;
    if (outcome.supervisorExitCode !== undefined) metadata.supervisorExitCode = outcome.supervisorExitCode;
    ledger.status = 'IDLE';
  } else {
    metadata.message = outcome.message.slice(0, MAX_STARTUP_ERROR_LENGTH);
    ledger.status = 'FAILED';
  }

  ledger.activeAgent = null;
  ledger.updatedAt = outcome.observedAt;
  ledger.events.push({
    timestamp: outcome.observedAt,
    level: outcome.kind === 'exit' && outcome.exitCode === 0 ? 'INFO' : outcome.kind === 'interrupted' ? 'WARN' : 'ERROR',
    message: formatProcessOutcome(outcome),
    metadata,
  });
  saveLedgerAtomic(projectDir, ledger);
  return { ledger, recorded: true };
}

export function formatProcessOutcome(outcome: ProcessOutcome): string {
  if (outcome.kind === 'startup_error') return `Agent process failed to start: ${outcome.message.slice(0, MAX_STARTUP_ERROR_LENGTH)}`;
  if (outcome.kind === 'interrupted') {
    const details = [outcome.supervisorSignal, outcome.supervisorExitCode === undefined ? undefined : `exit code ${outcome.supervisorExitCode}`]
      .filter((value): value is string => value !== undefined);
    return `Agent process interrupted${details.length ? ` by ${details.join(', ')}` : ''}`;
  }
  if (outcome.exitCode !== undefined) return `Agent process exited with code ${outcome.exitCode}`;
  if (outcome.signal !== undefined) return `Agent process terminated by signal ${outcome.signal}`;
  return 'Agent process termination is unknown (no exit code or signal reported)';
}
