import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createCliProgram } from '../../src/cli/index.js';
import * as doctorModule from '../../src/cli/commands/doctor.js';
import * as runModule from '../../src/cli/commands/run.js';
import { loadLedger } from '../../src/core/ledger.js';
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
      expect(runOpts).toContain('--dry-run');
      expect(runOpts).toContain('--verbose');
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
    it('initializes ledger and executes in dry-run mode to COMPLETED status', async () => {
      await runModule.runCommand(process.cwd(), {
        dryRun: true,
        agent: 'discovery-bot',
      });

      const ledger = loadLedger(process.cwd());
      expect(ledger.status).toBe('COMPLETED');
      expect(ledger.events.some((e) => e.message.includes('started'))).toBe(true);
      expect(ledger.events.some((e) => e.message.includes('ended with exit code 0'))).toBe(true);
    });

    it('handles ptyRunner.start() rejection by logging error, setting ledger to FAILED, and exitCode 1', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const startSpy = vi
        .spyOn(PtyRunner.prototype, 'start')
        .mockRejectedValue(new Error('Spawn failed simulate error'));

      await runModule.runCommand(process.cwd(), {
        dryRun: true,
        agent: 'error-agent',
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errCall = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errCall).toContain('Supervisor execution failed: Spawn failed simulate error');
      expect(process.exitCode).toBe(1);

      const ledger = loadLedger(process.cwd());
      expect(ledger.status).toBe('FAILED');
      expect(ledger.activeAgent).toBeNull();
      expect(
        ledger.events.some(
          (e) =>
            e.level === 'ERROR' &&
            e.message.includes('Supervisor execution failed: Spawn failed simulate error')
        )
      ).toBe(true);

      startSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('attaches signal handlers that reset ledger to IDLE and kill PTY', async () => {
      const listenersBefore = process.listeners('SIGINT').length;
      let capturedSignalHandler: (() => void) | undefined;

      const onSpy = vi.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: any) => {
        if (event === 'SIGINT') {
          capturedSignalHandler = listener;
        }
        return process;
      });

      // Start run command in dry-run mode
      const runPromise = runModule.runCommand(process.cwd(), {
        dryRun: true,
        agent: 'signal-tester',
      });

      expect(capturedSignalHandler).toBeDefined();

      // Trigger SIGINT handler
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      capturedSignalHandler!();

      expect(exitSpy).toHaveBeenCalledWith(130);
      const ledger = loadLedger(process.cwd());
      expect(ledger.status).toBe('IDLE');

      await runPromise;
      onSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
