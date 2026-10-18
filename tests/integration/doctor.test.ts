import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { createCliProgram } from '../../src/index.js';

describe('Doctor Integration', () => {
  let consoleSpy: any;
  const originalExitCode = process.exitCode;

  beforeAll(() => {
    const distCli = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');
    if (!fs.existsSync(distCli)) {
      execSync('npm run build', { stdio: 'inherit' });
    }
  });

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('runs doctor with --dry-run via createCliProgram().parseAsync', async () => {
    const program = createCliProgram();
    await program.parseAsync(['node', 'agy-supervisor', 'doctor', '--dry-run', '.']);

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Antigravity Preflight Doctor');
    expect(output).toContain('Target Directory:');
    expect(output).toContain('Git Repository:');
    expect(process.exitCode).toBe(0);
  });

  it('spawns compiled CLI binary and verifies doctor output and exit code 0', () => {
    const binPath = path.resolve(process.cwd(), 'bin', 'agy-supervisor.js');
    const result = spawnSync(process.execPath, [binPath, 'doctor', '--dry-run', '.'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Antigravity Preflight Doctor');
    expect(result.stdout).toContain('Target Directory:');
    expect(result.stdout).toContain('Git Repository:');
  });
});
