import { red } from 'colorette';
import { resolveTargetDir, findAgyBinary } from '../../core/discovery.js';
import { initLedger, updateLedger } from '../../core/ledger.js';
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
  const sessionStartedAt = options?.resume
    ? 0
    : Date.parse(ledger.createdAt) || Date.now();

  const agyResult = findAgyBinary(options?.agyBin);
  if (!agyResult.path && !options?.dryRun) {
    console.error(
      red(
        '[✗] Antigravity CLI binary (agy) not found. Run "agy-supervisor doctor" or specify --agy-bin <path>.'
      )
    );
    process.exitCode = 1;
    return;
  }

  const ptyRunner = new PtyRunner({
    projectDir,
    agent: options?.agent ?? '',
    binaryPath: agyResult.path ?? (options?.dryRun ? 'agy' : ''),
    args: options?.args,
    dryRun: options?.dryRun ?? false,
    cols: options?.cols ?? (process.stdout.columns || 80),
    rows: options?.rows ?? (process.stdout.rows || 30),
  });

  const isInteractiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const useTui =
    options?.forceTui ?? (isInteractiveTty && !options?.noTui && !options?.dryRun);

  let tuiInstance: SupervisorTuiInstance | undefined;
  let passthroughHandle: RawPassthroughHandle | undefined;

  if (useTui) {
    tuiInstance = mountSupervisorTui({
      projectDir,
      ptyRunner,
      mainAgent: options?.agent || 'agy',
      sessionStartedAt,
    });
  } else {
    // Stream PTY output directly to stdout
    ptyRunner.onData((data: string) => {
      process.stdout.write(data);
    });

    if (isInteractiveTty && !options?.dryRun) {
      passthroughHandle = attachRawPassthrough(ptyRunner);
    }
  }

  const cleanup = () => {
    if (passthroughHandle) {
      try {
        passthroughHandle.detach();
      } catch {
        // Safe to ignore detach errors
      }
      passthroughHandle = undefined;
    }
    if (tuiInstance) {
      try {
        tuiInstance.unmount();
      } catch {
        // Safe to ignore unmount errors
      }
      tuiInstance = undefined;
    }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Safe to ignore
      }
    }
    try {
      ptyRunner.kill();
    } catch {
      // Safe to ignore kill errors
    }
    try {
      updateLedger(projectDir, (ledger) => {
        ledger.status = 'IDLE';
        ledger.activeAgent = null;
        ledger.events.push({
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: 'Supervisor execution interrupted by signal',
        });
      });
    } catch {
      // Safe to ignore ledger errors on shutdown
    }
  };

  const handleSignal = (signalCode: number) => {
    cleanup();
    process.exit(signalCode);
  };

  const sigintHandler = () => handleSignal(130);
  const sigtermHandler = () => handleSignal(143);

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  try {
    updateLedger(projectDir, (ledger) => {
      ledger.status =
        options?.resume && ledger.status === 'EXECUTING' ? 'EXECUTING' : 'PLANNING';
      if (options?.agent) {
        ledger.activeAgent = options.agent;
      }
      ledger.events.push({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Supervisor execution started${options?.agent ? ` for agent '${options.agent}'` : ''}`,
        ...(options?.agent || options?.dryRun !== undefined
          ? { metadata: { agent: options?.agent, dryRun: options?.dryRun } }
          : {}),
      });
    });

    const exitCode = await ptyRunner.start();

    updateLedger(projectDir, (ledger) => {
      ledger.status = exitCode === 0 ? 'COMPLETED' : 'FAILED';
      ledger.activeAgent = null;
      ledger.events.push({
        timestamp: new Date().toISOString(),
        level: exitCode === 0 ? 'INFO' : 'ERROR',
        message: `Supervisor execution ended with exit code ${exitCode}`,
      });
    });

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red(`[✗] Supervisor execution failed: ${message}`));
    try {
      updateLedger(projectDir, (ledger) => {
        ledger.status = 'FAILED';
        ledger.activeAgent = null;
        ledger.events.push({
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          message: `Supervisor execution failed: ${message}`,
        });
      });
    } catch {
      // Safe to ignore ledger errors
    }
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigtermHandler);
    if (passthroughHandle) {
      try {
        passthroughHandle.detach();
      } catch {
        // Safe to ignore detach errors
      }
      passthroughHandle = undefined;
    }
    if (tuiInstance) {
      try {
        tuiInstance.unmount();
      } catch {
        // Safe to ignore unmount errors
      }
      tuiInstance = undefined;
    }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Safe to ignore
      }
    }
  }
}

