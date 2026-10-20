import { Command } from 'commander';
import { doctorCommand, type DoctorOptions } from './commands/doctor.js';
import { runCommand, type RunOptions } from './commands/run.js';

interface CliRunOptions extends RunOptions {
  tui?: boolean;
}

/**
 * Creates and configures the Commander CLI program for agy-supervisor.
 */
export function createCliProgram(): Command {
  const program = new Command();

  program
    .name('agy-supervisor')
    .description('Master Supervisor CLI for Antigravity AI agent orchestration')
    .version('0.1.0')
    .enablePositionalOptions()
    .option('--agy-bin <path>', 'Explicit path to Antigravity (agy) binary')
    .option('--agent <name>', 'Agent role name to run')
    .option('--no-tui', 'Run in raw interactive terminal passthrough mode without the TUI')
    .option('--dry-run', 'Simulate execution in dry-run mode')
    .option('--resume', 'Resume previous supervisor session state and plan')
    .option('-v, --verbose', 'Enable verbose logging');

  program
    .command('doctor [targetDir]')
    .description('Perform preflight diagnostics and health checks on environment')
    .option('--agy-bin <path>', 'Explicit path to Antigravity (agy) binary')
    .option('--dry-run', 'Simulate checks without failing on missing external binary')
    .option('-v, --verbose', 'Enable verbose diagnostic logging')
    .action(async (targetDir?: string, cmdOptions?: Partial<DoctorOptions>) => {
      const globalOpts = program.opts<DoctorOptions>();
      const mergedOpts: DoctorOptions = {
        agyBin: cmdOptions?.agyBin ?? globalOpts.agyBin,
        dryRun: Boolean(cmdOptions?.dryRun || globalOpts.dryRun),
        verbose: Boolean(cmdOptions?.verbose || globalOpts.verbose),
      };
      await doctorCommand(targetDir, mergedOpts);
    });

  program
    .command('run [targetDir]', { isDefault: true })
    .description('Run supervisor orchestrating Antigravity agent execution')
    .option('--agy-bin <path>', 'Explicit path to Antigravity (agy) binary')
    .option('--agent <name>', 'Agent role name to run')
    .option('--no-tui', 'Run in raw interactive terminal passthrough mode without the TUI')
    .option('--dry-run', 'Simulate execution in dry-run mode')
    .option('--resume', 'Resume previous supervisor session state and plan')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (targetDir?: string, cmdOptions?: Partial<CliRunOptions>) => {
      const globalOpts = program.opts<CliRunOptions>();
      const mergedOpts: RunOptions = {
        agyBin: cmdOptions?.agyBin ?? globalOpts.agyBin,
        agent: cmdOptions?.agent ?? globalOpts.agent,
        dryRun: Boolean(cmdOptions?.dryRun || globalOpts.dryRun),
        verbose: Boolean(cmdOptions?.verbose || globalOpts.verbose),
        resume: Boolean(cmdOptions?.resume || globalOpts.resume),
        noTui:
          cmdOptions?.tui === false ||
          globalOpts.tui === false ||
          Boolean(cmdOptions?.noTui || globalOpts.noTui),
      };
      await runCommand(targetDir, mergedOpts);
    });

  return program;
}

export { doctorCommand, type DoctorOptions } from './commands/doctor.js';
export { runCommand, type RunOptions } from './commands/run.js';
