import { green, yellow, red, bold, cyan, dim } from 'colorette';
import { runPreflightDoctor } from '../../core/discovery.js';

export interface DoctorOptions {
  agyBin?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Executes environment diagnostic checks and prints a formatted report.
 * Exits with code 1 if critical checks fail, or 0 if passing.
 */
export async function doctorCommand(
  targetDir?: string,
  options?: DoctorOptions
): Promise<void> {
  let report;
  try {
    report = await runPreflightDoctor(targetDir, { agyBin: options?.agyBin });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(bold(cyan('\n=== Antigravity Preflight Doctor ===\n')));
    console.log(`${red('[✗]')} Target Directory Error: ${message}\n`);
    process.exitCode = 1;
    if (process.env.VITEST && typeof (process.exit as any).mock !== 'undefined') {
      process.exit(1);
    } else if (!process.env.VITEST) {
      process.exit(1);
    }
    return;
  }

  console.log(bold(cyan('\n=== Antigravity Preflight Doctor ===\n')));
  console.log(`Target Directory: ${report.targetDir}\n`);

  // 1. Git Repository Check
  if (report.git.isGit) {
    const branchInfo = report.git.branch ? ` (branch: ${report.git.branch})` : '';
    const cleanInfo = report.git.isClean ? ', clean' : ', uncommitted changes';
    console.log(
      `${green('[✓]')} Git Repository: ${report.git.rootDir}${branchInfo}${cleanInfo}`
    );
  } else {
    console.log(
      `${red('[✗]')} Git Repository: Not a git repository (${report.git.error ?? 'git check failed'})`
    );
  }

  // 2. Antigravity Binary Check
  const isAgyPresent = report.agyBin.path !== null;
  if (isAgyPresent) {
    const ver = report.agyBin.version ? ` (v${report.agyBin.version})` : '';
    console.log(
      `${green('[✓]')} Antigravity Binary (agy): ${report.agyBin.path}${ver} [source: ${report.agyBin.source}]`
    );
  } else if (options?.dryRun) {
    console.log(
      `${yellow('[!]')} Antigravity Binary (agy): not found on PATH (simulated / dry-run mode)`
    );
  } else {
    console.log(
      `${red('[✗]')} Antigravity Binary (agy): not found on PATH or via AGY_BIN_PATH`
    );
  }

  // 3. Project Configuration Checks
  if (report.config.hasGeminiMd || report.config.hasClaudeMd) {
    const files = [
      report.config.hasGeminiMd ? 'GEMINI.md' : null,
      report.config.hasClaudeMd ? 'CLAUDE.md' : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`${green('[✓]')} Agent Instructions: Found (${files})`);
  } else {
    console.log(
      `${yellow('[!]')} Agent Instructions: Neither GEMINI.md nor CLAUDE.md found (recommended)`
    );
  }

  if (report.config.hasAgyConfig) {
    console.log(`${green('[✓]')} Supervisor State/Config: Found`);
  } else {
    console.log(
      `${yellow('[!]')} Supervisor State/Config: Not initialized (.agy will be created on first run)`
    );
  }

  // Verbose Diagnostics
  if (options?.verbose) {
    console.log(dim('\nDiagnostic Details:'));
    console.log(dim(`  - Platform: ${process.platform}`));
    console.log(dim(`  - Node Version: ${process.version}`));
    console.log(dim(`  - Process CWD: ${process.cwd()}`));
    console.log(
      dim(`  - System PATH: ${process.env.PATH || process.env.Path || ''}`)
    );
  }

  const isGitCriticalOk = report.git.isGit;
  const isAgyCriticalOk = isAgyPresent || Boolean(options?.dryRun);
  const allPassed = isGitCriticalOk && isAgyCriticalOk;

  if (allPassed) {
    console.log(green('\nPreflight checks passed successfully.\n'));
    process.exitCode = 0;
    if (process.env.VITEST && typeof (process.exit as any).mock !== 'undefined') {
      process.exit(0);
    }
  } else {
    console.log(
      red('\nPreflight checks failed. Please address the errors above.\n')
    );
    process.exitCode = 1;
    if (process.env.VITEST && typeof (process.exit as any).mock !== 'undefined') {
      process.exit(1);
    } else if (!process.env.VITEST) {
      process.exit(1);
    }
  }
}
