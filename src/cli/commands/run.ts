import { red } from 'colorette';
import { resolveTargetDir, findAgyBinary } from '../../core/discovery.js';
import { initLedger, updateLedger } from '../../core/ledger.js';
import { createProcessRunContext, formatProcessOutcome, recordProcessOutcome } from '../../core/process-outcome.js';
import type { ProcessOutcome } from '../../core/types.js';
import { PtyRunner } from '../../pty/runner.js';
import { attachRawPassthrough } from '../../pty/raw-passthrough.js';
import type { RawPassthroughHandle } from '../../pty/types.js';
import { mountSupervisorTui, type SupervisorTuiInstance } from '../../tui/index.js';

export interface RunOptions {
  agyBin?: string;
  agent?: string;
  dryRun?: boolean;
  verbose?: boolean;
  resume?: boolean;
  cols?: number;
  rows?: number;
  noTui?: boolean;
  forceTui?: boolean;
  args?: string[];
}

/**
 * Executes the Antigravity Master Supervisor orchestrator against the target directory.
 */
export async function runCommand(
  targetDir?: string,
  options?: RunOptions
): Promise<void> {
  const projectDir = resolveTargetDir(targetDir);

  // Initialize supervisor state ledger if not present
  const ledger = initLedger(projectDir, { reset: !options?.resume });
  // 0 disables the mtime filter so a resumed session picks up all historical artifacts.
  const sessionStartedAt = options?.resume
    ? 0
    : Date.parse(ledger.createdAt) || Date.now();
  const processRun = createProcessRunContext(ledger.sessionId);

  // Persist invocation identity before discovery so even a missing executable has an outcome.
  updateLedger(projectDir, (currentLedger) => {
    currentLedger.status = options?.resume && currentLedger.status === 'EXECUTING' ? 'EXECUTING' : 'PLANNING';
    if (options?.agent) currentLedger.activeAgent = options.agent;
    currentLedger.events.push({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `Supervisor execution started${options?.agent ? ` for agent '${options.agent}'` : ''}`,
      metadata: {
        kind: 'PROCESS_STARTED',
        runId: processRun.runId,
        sessionId: processRun.sessionId,
        ...(options?.agent ? { agent: options.agent } : {}),
        ...(options?.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      },
    });
  });

  const recordStartupFailure = (message: string) => {
    console.error(red(`[✗] Supervisor execution failed: ${message}`));
    const outcome: ProcessOutcome = {
      runId: processRun.runId,
      sessionId: processRun.sessionId,
      observedAt: new Date().toISOString(),
      kind: 'startup_error',
      message,
    };
    processRun.outcome = outcome;
    try {
      recordProcessOutcome(projectDir, outcome);
    } catch (error) {
      console.error(red(`Failed to persist process outcome: ${error instanceof Error ? error.message : String(error)}`));
    }
    process.exitCode = 1;
  };

  const agyResult = findAgyBinary(options?.agyBin);
  if (!agyResult.path && !options?.dryRun) {
    recordStartupFailure('Antigravity CLI binary (agy) not found. Run "agy-supervisor doctor" or specify --agy-bin <path>.');
    return;
  }

  let ptyRunner: PtyRunner;
  try {
    ptyRunner = new PtyRunner({
      projectDir,
      agent: options?.agent ?? '',
      binaryPath: agyResult.path ?? (options?.dryRun ? 'agy' : ''),
      args: options?.args,
      dryRun: options?.dryRun ?? false,
      cols: options?.cols ?? (process.stdout.columns || 80),
      rows: options?.rows ?? (process.stdout.rows || 30),
    });
  } catch (error) {
    recordStartupFailure(error instanceof Error ? error.message : String(error));
    return;
  }

  const isInteractiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const useTui =
    options?.forceTui ?? (isInteractiveTty && !options?.noTui && !options?.dryRun);

  let tuiInstance: SupervisorTuiInstance | undefined;
  let passthroughHandle: RawPassthroughHandle | undefined;
  let removeDataListener: (() => void) | undefined;
  let removeExitListener: (() => void) | undefined;
  let terminalOutcome: ProcessOutcome | undefined;
  let cleanupStarted = false;

  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    const attempt = (action: () => void) => {
      try { action(); } catch { /* Continue restoring later resources. */ }
    };
    if (passthroughHandle) {
      const handle = passthroughHandle;
      passthroughHandle = undefined;
      attempt(() => handle.detach());
    }
    if (tuiInstance) {
      const instance = tuiInstance;
      tuiInstance = undefined;
      attempt(() => instance.unmount());
    }
    if (removeDataListener) {
      const unsubscribe = removeDataListener;
      removeDataListener = undefined;
      attempt(unsubscribe);
    }
    if (removeExitListener) {
      const unsubscribe = removeExitListener;
      removeExitListener = undefined;
      attempt(unsubscribe);
    }
    if (ptyRunner.isProcessRunning()) attempt(() => ptyRunner.kill());
  };

  const terminalize = (outcome: ProcessOutcome) => {
    if (terminalOutcome) return terminalOutcome;
    terminalOutcome = outcome;
    processRun.outcome = outcome;
    // Stop telemetry promotions before writing terminal evidence or projecting the UI note.
    try { tuiInstance?.store.handleProcessOutcome(outcome); } catch { /* Persist the primary process fact regardless. */ }
    try {
      recordProcessOutcome(projectDir, outcome);
    } catch (error) {
      console.error(red(`Failed to persist process outcome: ${error instanceof Error ? error.message : String(error)}`));
    }
    try { tuiInstance?.handleProcessOutcome?.(outcome); } catch { /* Preserve the recorded process fact. */ }
    return outcome;
  };

  const setExitCode = (outcome: ProcessOutcome) => {
    if (outcome.kind === 'interrupted') {
      process.exitCode = outcome.supervisorExitCode ?? 1;
    } else if (outcome.kind === 'startup_error') {
      process.exitCode = 1;
    } else if (outcome.exitCode !== undefined && outcome.exitCode !== 0) {
      process.exitCode = outcome.exitCode;
    }
  };

  const sigintHandler = () => handleSignal('SIGINT', 130);
  const sigtermHandler = () => handleSignal('SIGTERM', 143);
  const handleSignal = (signal: 'SIGINT' | 'SIGTERM', exitCode: number) => {
    if (terminalOutcome) return;
    terminalize({
      runId: processRun.runId,
      sessionId: processRun.sessionId,
      observedAt: new Date().toISOString(),
      kind: 'interrupted',
      supervisorSignal: signal,
      supervisorExitCode: exitCode,
    });
    setExitCode(terminalOutcome!);
    try { ptyRunner.kill(signal); } catch { /* Cleanup continues below. */ }
    cleanup();
  };

  try {
    removeExitListener = ptyRunner.onExit((code, signal) => {
      terminalize({
        runId: processRun.runId,
        sessionId: processRun.sessionId,
        observedAt: new Date().toISOString(),
        kind: 'exit',
        exitCode: code,
        ...(signal !== undefined ? { signal } : {}),
      });
    });
    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigtermHandler);

    if (useTui) {
      tuiInstance = mountSupervisorTui({
        projectDir,
        ptyRunner,
        mainAgent: options?.agent || 'agy',
        sessionStartedAt,
        processRun,
        processOutcomeOwner: 'caller',
      });
    } else {
      removeDataListener = ptyRunner.onData((data: string) => { process.stdout.write(data); });
      if (isInteractiveTty && !options?.dryRun) passthroughHandle = attachRawPassthrough(ptyRunner);
    }
    const exitCode = await ptyRunner.start();
    if (!terminalOutcome) terminalize({
      runId: processRun.runId,
      sessionId: processRun.sessionId,
      observedAt: new Date().toISOString(),
      kind: 'exit',
      exitCode,
    });
    setExitCode(terminalOutcome!);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red(`[✗] Supervisor execution failed: ${message}`));
    if (!terminalOutcome) {
      terminalize({
        runId: processRun.runId,
        sessionId: processRun.sessionId,
        observedAt: new Date().toISOString(),
        kind: 'startup_error',
        message,
      });
    }
    setExitCode(terminalOutcome!);
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigtermHandler);
    cleanup();
  }

  if (useTui && terminalOutcome) {
    try {
      process.stdout.write(`${formatProcessOutcome(terminalOutcome)}\nReview and verification not confirmed.\n`);
    } catch { /* The terminal may already be closed. */ }
  }
}

