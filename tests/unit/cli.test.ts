import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createCliProgram } from '../../src/cli/index.js';
import * as doctorModule from '../../src/cli/commands/doctor.js';
import * as runModule from '../../src/cli/commands/run.js';
import * as tuiModule from '../../src/tui/index.js';
import * as rawPassthroughModule from '../../src/pty/raw-passthrough.js';
import { initLedger, loadLedger, updateLedger } from '../../src/core/ledger.js';
import { PtyRunner } from '../../src/pty/runner.js';

describe('CLI Parser', () => {
  let tempBaseDir: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-test-'));
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Program Configuration', () => {
    it('creates program with doctor and run commands', () => {
      const program = createCliProgram();
      expect(program.name()).toBe('agy-supervisor');
      expect(program.version()).toBe('0.1.0');
      expect(program.description()).toMatch(/Master Supervisor/i);

      const commandNames = program.commands.map((cmd) => cmd.name());
      expect(commandNames).toContain('doctor');
      expect(commandNames).toContain('run');
    });

    it('has expected options configured on commands and program', () => {
      const program = createCliProgram();
      const optionNames = program.options.map((opt) => opt.long);
      expect(optionNames).toContain('--agy-bin');
      expect(optionNames).toContain('--agent');
      expect(optionNames).toContain('--no-tui');
      expect(optionNames).toContain('--dry-run');
      expect(optionNames).toContain('--verbose');

      const doctorCmd = program.commands.find((c) => c.name() === 'doctor');
      expect(doctorCmd).toBeDefined();
      const doctorOpts = doctorCmd!.options.map((opt) => opt.long);
      expect(doctorOpts).toContain('--agy-bin');
      expect(doctorOpts).toContain('--dry-run');
      expect(doctorOpts).toContain('--verbose');

      const runCmd = program.commands.find((c) => c.name() === 'run');
      expect(runCmd).toBeDefined();
      const runOpts = runCmd!.options.map((opt) => opt.long);
      expect(runOpts).toContain('--agy-bin');
      expect(runOpts).toContain('--agent');
      expect(runOpts).toContain('--no-tui');
      expect(runOpts).toContain('--dry-run');
      expect(runOpts).toContain('--verbose');
    });

    it('registers --resume on both the root program and the run command', () => {
      const program = createCliProgram();
      const rootOptions = program.options.map((opt) => opt.long);
      expect(rootOptions).toContain('--resume');

      const runCmd = program.commands.find((c) => c.name() === 'run');
      expect(runCmd).toBeDefined();
      expect(runCmd!.options.map((opt) => opt.long)).toContain('--resume');
    });
  });

  describe('Option Parsing and Command Routing', () => {
    it('routes "doctor" command to doctorCommand with options', async () => {
      const doctorSpy = vi.spyOn(doctorModule, 'doctorCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        'doctor',
        tempBaseDir,
        '--dry-run',
        '--agy-bin',
        '/mock/path/agy',
        '--verbose',
      ]);

      expect(doctorSpy).toHaveBeenCalledTimes(1);
      const [targetDirArg, optionsArg] = doctorSpy.mock.calls[0];
      expect(targetDirArg).toBe(tempBaseDir);
      expect(optionsArg).toMatchObject({
        dryRun: true,
        agyBin: '/mock/path/agy',
        verbose: true,
      });
    });

    it('routes explicit "run" command to runCommand with options', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        'run',
        tempBaseDir,
        '--agent',
        'tester',
        '--dry-run',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [targetDirArg, optionsArg] = runSpy.mock.calls[0];
      expect(targetDirArg).toBe(tempBaseDir);
      expect(optionsArg).toMatchObject({
        agent: 'tester',
        dryRun: true,
      });
    });

    it('defaults to "run" command when no subcommand is specified', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        tempBaseDir,
        '--dry-run',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [targetDirArg, optionsArg] = runSpy.mock.calls[0];
      expect(targetDirArg).toBe(tempBaseDir);
      expect(optionsArg).toMatchObject({
        dryRun: true,
      });
    });

    it('passes { noTui: true, agent: "planner" } to runCommand when --no-tui and --agent are passed to root program', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        '--no-tui',
        '--agent',
        'planner',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [, optionsArg] = runSpy.mock.calls[0];
      expect(optionsArg).toMatchObject({
        noTui: true,
        agent: 'planner',
      });
    });

    it('passes { noTui: true, agent: "planner" } to runCommand when explicit run subcommand is used', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        'run',
        tempBaseDir,
        '--no-tui',
        '--agent',
        'planner',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [targetDirArg, optionsArg] = runSpy.mock.calls[0];
      expect(targetDirArg).toBe(tempBaseDir);
      expect(optionsArg).toMatchObject({
        noTui: true,
        agent: 'planner',
      });
    });

    it('routes --resume from the root program to runCommand', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        tempBaseDir,
        '--resume',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [, optionsArg] = runSpy.mock.calls[0];
      expect(optionsArg).toMatchObject({ resume: true });
    });

    it('routes --resume from the run subcommand to runCommand', async () => {
      const runSpy = vi.spyOn(runModule, 'runCommand').mockResolvedValue(undefined);
      const program = createCliProgram();

      await program.parseAsync([
        'node',
        'agy-supervisor',
        'run',
        tempBaseDir,
        '--resume',
      ]);

      expect(runSpy).toHaveBeenCalledTimes(1);
      const [, optionsArg] = runSpy.mock.calls[0];
      expect(optionsArg).toMatchObject({ resume: true });
    });
  });

  describe('Doctor Command Behavior', () => {
    it('executes preflight doctor and prints checklist report in dry-run mode', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await doctorModule.doctorCommand(process.cwd(), { dryRun: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const allCalls = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allCalls).toMatch(/doctor/i);
      expect(allCalls).toMatch(/Git Repository/i);
      expect(process.exitCode).toBe(0);

      stdoutSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('sets exitCode 1 when non-dryRun doctor fails critical checks', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const nonGitDir = path.join(tempBaseDir, 'not-git');
      fs.mkdirSync(nonGitDir);

      await doctorModule.doctorCommand(nonGitDir, { dryRun: false });

      expect(process.exitCode).toBe(1);
      consoleLogSpy.mockRestore();
    });

    it('sets exitCode 1 when non-existent --agy-bin override is passed without dryRun', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await doctorModule.doctorCommand(process.cwd(), {
        agyBin: 'non-existent-agy-bin-xyz',
        dryRun: false,
      });

      expect(process.exitCode).toBe(1);
      consoleLogSpy.mockRestore();
    });
  });

  describe('Run Command Behavior', () => {
    it('initializes ledger and records a factual zero-exit outcome in dry-run mode', async () => {
      await runModule.runCommand(tempBaseDir, {
        dryRun: true,
        agent: 'discovery-bot',
      });

      const ledger = loadLedger(tempBaseDir);
      expect(ledger.status).toBe('IDLE');
      expect(ledger.events.some((e) => e.message.includes('started'))).toBe(true);
      const outcomes = ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_OUTCOME');
      const starts = ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_STARTED');
      expect(starts).toHaveLength(1);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 0 });
      expect(outcomes[0]?.metadata?.runId).toBe(starts[0]?.metadata?.runId);
    });

    it('records a startup_error outcome when the agy binary is missing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await runModule.runCommand(tempBaseDir, { agyBin: 'missing-agy-for-outcome-test' });

      const ledger = loadLedger(tempBaseDir);
      const started = ledger.events.filter((event) => event.metadata?.kind === 'PROCESS_STARTED');
      const outcomes = ledger.events.filter((event) => event.metadata?.kind === 'PROCESS_OUTCOME');
      expect(started).toHaveLength(1);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.metadata).toMatchObject({
        outcomeKind: 'startup_error',
        runId: started[0]?.metadata?.runId,
        sessionId: ledger.sessionId,
      });
      expect(ledger.status).toBe('FAILED');
      expect(process.exitCode).toBe(1);
      consoleErrorSpy.mockRestore();
    });

    it('reuses session identity but creates a fresh process identity for each resumed invocation', async () => {
      await runModule.runCommand(tempBaseDir, { dryRun: true });
      const initial = loadLedger(tempBaseDir);
      await runModule.runCommand(tempBaseDir, { dryRun: true, resume: true });
      await runModule.runCommand(tempBaseDir, { dryRun: true, resume: true });
      const ledger = loadLedger(tempBaseDir);
      const runs = ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_STARTED');

      expect(ledger.sessionId).toBe(initial.sessionId);
      expect(runs).toHaveLength(3);
      expect(new Set(runs.map((e) => e.metadata?.runId)).size).toBe(3);
      expect(runs.every((e) => e.metadata?.sessionId === ledger.sessionId)).toBe(true);
      expect(ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_OUTCOME')).toHaveLength(3);
    });

    it('does not let the start promise overwrite callback signal details or record a second outcome', async () => {
      const startSpy = vi.spyOn(PtyRunner.prototype, 'start').mockImplementation(async function (this: PtyRunner) {
        (this as any).emitExit(7, 15);
        return 9;
      });

      await runModule.runCommand(tempBaseDir, { dryRun: true, noTui: true });

      const ledger = loadLedger(tempBaseDir);
      const outcomes = ledger.events.filter((event) => event.metadata?.kind === 'PROCESS_OUTCOME');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 7, signal: 15 });
      expect(process.exitCode).toBe(7);
      startSpy.mockRestore();
    });

    it('resets the ledger by default and starts in PLANNING before completion', async () => {
      initLedger(tempBaseDir);
      updateLedger(tempBaseDir, (ledger) => {
        ledger.status = 'EXECUTING';
        ledger.checkpoints.spec.status = 'APPROVED';
      });

      let statusBeforeCompletion: string | undefined;
      const startSpy = vi
        .spyOn(PtyRunner.prototype, 'start')
        .mockImplementation(async () => {
          statusBeforeCompletion = loadLedger(tempBaseDir).status;
          return 0;
        });

      await runModule.runCommand(tempBaseDir, { dryRun: true });

      expect(statusBeforeCompletion).toBe('PLANNING');
      const ledger = loadLedger(tempBaseDir);
      expect(ledger.status).toBe('IDLE');
      expect(ledger.checkpoints.spec.status).toBe('UNINITIALIZED');

      startSpy.mockRestore();
    });

    it('preserves existing ledger state when resume is enabled', async () => {
      initLedger(tempBaseDir);
      updateLedger(tempBaseDir, (ledger) => {
        ledger.status = 'EXECUTING';
        ledger.checkpoints.spec.status = 'APPROVED';
        ledger.checkpoints.plan.status = 'PENDING';
      });

      let statusBeforeCompletion: string | undefined;
      const startSpy = vi
        .spyOn(PtyRunner.prototype, 'start')
        .mockImplementation(async () => {
          statusBeforeCompletion = loadLedger(tempBaseDir).status;
          return 0;
        });

      await runModule.runCommand(tempBaseDir, { dryRun: true, resume: true });

      expect(statusBeforeCompletion).toBe('EXECUTING');
      const ledger = loadLedger(tempBaseDir);
      expect(ledger.checkpoints.spec.status).toBe('APPROVED');
      expect(ledger.checkpoints.plan.status).toBe('PENDING');

      startSpy.mockRestore();
    });

    it('passes one shared process context and session timestamp to the TUI mount', async () => {
      const order: string[] = [];
      const originalOnExit = PtyRunner.prototype.onExit;
      const exitSpy = vi.spyOn(PtyRunner.prototype, 'onExit').mockImplementation(function (this: PtyRunner, callback: (code: number, signal?: number) => void) {
        order.push('process-owner');
        return originalOnExit.call(this, callback);
      });
      const mountSpy = vi.spyOn(tuiModule, 'mountSupervisorTui').mockImplementation(() => {
        order.push('mount');
        return {
          unmount: vi.fn(),
          waitUntilExit: vi.fn().mockResolvedValue(undefined),
          store: {} as any,
          virtualTerminal: {} as any,
        };
      });

      await runModule.runCommand(tempBaseDir, {
        dryRun: true,
        forceTui: true,
      });

      expect(mountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionStartedAt: expect.any(Number),
          processRun: expect.objectContaining({ runId: expect.any(String), sessionId: expect.any(String) }),
          processOutcomeOwner: 'caller',
        })
      );
      expect(order.indexOf('process-owner')).toBeLessThan(order.indexOf('mount'));

      mountSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('prints the factual TUI outcome only after unmount restores the normal terminal', async () => {
      let unmounted = false;
      const output: string[] = [];
      const mountSpy = vi.spyOn(tuiModule, 'mountSupervisorTui').mockReturnValue({
        unmount: vi.fn(() => { unmounted = true; }),
        waitUntilExit: vi.fn().mockResolvedValue(undefined),
        store: {} as any,
        virtualTerminal: {} as any,
      });
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        output.push(text);
        if (text.includes('Agent process exited with code 0')) expect(unmounted).toBe(true);
        return true;
      });

      await runModule.runCommand(tempBaseDir, { dryRun: true, forceTui: true });

      expect(output.join('')).toContain('Agent process exited with code 0\nReview and verification not confirmed.');
      stdoutSpy.mockRestore();
      mountSpy.mockRestore();
    });

    it('handles ptyRunner.start() rejection by logging error, setting ledger to FAILED, and exitCode 1', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const startSpy = vi
        .spyOn(PtyRunner.prototype, 'start')
        .mockRejectedValue(new Error('Spawn failed simulate error'));

      await runModule.runCommand(tempBaseDir, {
        dryRun: true,
        agent: 'error-agent',
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errCall = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errCall).toContain('Supervisor execution failed: Spawn failed simulate error');
      expect(process.exitCode).toBe(1);

      const ledger = loadLedger(tempBaseDir);
      expect(ledger.status).toBe('FAILED');
      expect(ledger.activeAgent).toBeNull();
      expect(
        ledger.events.some(
          (e) =>
            e.level === 'ERROR' &&
            e.message.includes('Agent process failed to start: Spawn failed simulate error')
        )
      ).toBe(true);

      startSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('records a supervisor interruption once and kills the active PTY', async () => {
      let capturedSignalHandler: (() => void) | undefined;

      const onSpy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: any) => {
        if (event === 'SIGINT') {
          capturedSignalHandler = listener;
        }
        return process;
      });

      let resolveStart!: (code: number) => void;
      const startSpy = vi.spyOn(PtyRunner.prototype, 'start').mockImplementation(() => new Promise((resolve) => {
        resolveStart = resolve;
      }));
      const runPromise = runModule.runCommand(tempBaseDir, {
        dryRun: true,
        agent: 'signal-tester',
      });

      expect(capturedSignalHandler).toBeDefined();

      const killSpy = vi.spyOn(PtyRunner.prototype, 'kill').mockImplementation(() => {});
      capturedSignalHandler!();

      expect(killSpy).toHaveBeenCalledWith('SIGINT');
      const ledger = loadLedger(tempBaseDir);
      expect(ledger.status).toBe('IDLE');
      expect(ledger.events.filter((event) => event.metadata?.kind === 'PROCESS_OUTCOME')).toHaveLength(1);
      expect(ledger.events.find((event) => event.metadata?.kind === 'PROCESS_OUTCOME')?.metadata).toMatchObject({
        outcomeKind: 'interrupted',
        supervisorSignal: 'SIGINT',
        supervisorExitCode: 130,
      });

      resolveStart(130);
      await runPromise;
      onSpy.mockRestore();
      startSpy.mockRestore();
      killSpy.mockRestore();
    });

    it('mounts supervisor TUI when forceTui is enabled and unmounts on completion', async () => {
      const unmountSpy = vi.fn();
      const mountSpy = vi.spyOn(tuiModule, 'mountSupervisorTui').mockReturnValue({
        unmount: unmountSpy,
        waitUntilExit: vi.fn().mockResolvedValue(undefined),
        store: {} as any,
        virtualTerminal: {} as any,
      });

      await runModule.runCommand(tempBaseDir, {
        dryRun: true,
        forceTui: true,
        agent: 'tui-bot',
      });

      expect(mountSpy).toHaveBeenCalledTimes(1);
      expect(mountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir: tempBaseDir,
          mainAgent: 'tui-bot',
        })
      );
      expect(unmountSpy).toHaveBeenCalledTimes(1);
      mountSpy.mockRestore();
    });

    it('attaches and detaches raw passthrough when interactive TTY is detected in non-TUI mode', async () => {
      const origStdinIsTTY = process.stdin.isTTY;
      const origStdoutIsTTY = process.stdout.isTTY;
      const origSetRawMode = process.stdin.setRawMode;

      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const setRawModeSpy = vi.fn();
      (process.stdin as any).setRawMode = setRawModeSpy;

      const detachSpy = vi.fn();
      const passthroughSpy = vi
        .spyOn(rawPassthroughModule, 'attachRawPassthrough')
        .mockReturnValue({ detach: detachSpy });

      const startSpy = vi.spyOn(PtyRunner.prototype, 'start').mockResolvedValue(0);

      await runModule.runCommand(tempBaseDir, {
        agyBin: process.execPath,
        noTui: true,
      });

      expect(passthroughSpy).toHaveBeenCalledTimes(1);
      expect(detachSpy).toHaveBeenCalledTimes(1);
      expect(setRawModeSpy).not.toHaveBeenCalled();

      startSpy.mockRestore();
      passthroughSpy.mockRestore();
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutIsTTY, configurable: true });
      (process.stdin as any).setRawMode = origSetRawMode;
    });
  });
});
