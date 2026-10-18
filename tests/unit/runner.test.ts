import { describe, it, expect, vi } from 'vitest';
import { PtyRunner } from '../../src/pty/runner.js';
import type { PtyRunnerOptions } from '../../src/pty/types.js';

describe('PtyRunner', () => {
  it('instantiates with target directory, binary path, and agent name', () => {
    const opts: PtyRunnerOptions = {
      projectDir: process.cwd(),
      binaryPath: 'agy',
      agent: 'planner',
    };
    const runner = new PtyRunner(opts);
    expect(runner).toBeDefined();
    expect(runner.getOptions().projectDir).toBe(opts.projectDir);
    expect(runner.getOptions().binaryPath).toBe('agy');
    expect(runner.getOptions().agent).toBe('planner');
    expect(runner.getOptions().cols).toBe(80);
    expect(runner.getOptions().rows).toBe(30);
  });

  it('supports dry-run mode without spawning child process', async () => {
    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: 'agy',
      agent: 'planner',
      dryRun: true,
    });

    let output = '';
    runner.onData((data) => {
      output += data;
    });

    let exitCodeResult: number | null = null;
    runner.onExit((code) => {
      exitCodeResult = code;
    });

    const exitCode = await runner.start();
    expect(exitCode).toBe(0);
    expect(exitCodeResult).toBe(0);
    expect(output).toContain('[DRY-RUN]');
  });

  it('attaches onData and onExit event listeners', async () => {
    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: 'agy',
      agent: 'orchestrator',
      dryRun: true,
    });

    const dataListener1 = vi.fn();
    const dataListener2 = vi.fn();
    const exitListener = vi.fn();

    runner.onData(dataListener1);
    runner.onData(dataListener2);
    runner.onExit(exitListener);

    await runner.start();

    expect(dataListener1).toHaveBeenCalled();
    expect(dataListener2).toHaveBeenCalled();
    expect(exitListener).toHaveBeenCalledWith(0, undefined);
  });

  it('safely handles write, resize, and kill in dry-run mode', async () => {
    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: 'agy',
      agent: 'planner',
      dryRun: true,
    });

    expect(() => runner.write('input test\n')).not.toThrow();
    expect(() => runner.resize(100, 40)).not.toThrow();
    expect(runner.getOptions().cols).toBe(100);
    expect(runner.getOptions().rows).toBe(40);
    expect(() => runner.kill('SIGINT')).not.toThrow();
  });

  describe('ConPTY vs POSIX shell resolution', () => {
    it('resolves ConPTY spawn options on Windows', () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: 'agy',
        agent: 'planner',
        args: ['--verbose'],
      });

      const config = runner.resolveSpawnConfig('win32');
      expect(config.file).toBe('agy');
      expect(config.args).toEqual(['--agent', 'planner', '--verbose']);
      expect(config.options.useConpty).toBe(true);
      expect(config.options.cwd).toBe(process.cwd());
    });

    it('resolves POSIX spawn options without ConPTY on non-Windows', () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: 'agy',
        agent: 'planner',
        args: ['--verbose'],
      });

      const config = runner.resolveSpawnConfig('linux');
      expect(config.file).toBe('agy');
      expect(config.args).toEqual(['--agent', 'planner', '--verbose']);
      expect(config.options.useConpty).toBeUndefined();
      expect(config.options.cwd).toBe(process.cwd());
    });

    it('uses process.platform by default for shell / PTY resolution', () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: 'agy',
        agent: 'planner',
      });

      const config = runner.resolveSpawnConfig();
      if (process.platform === 'win32') {
        expect(config.options.useConpty).toBe(true);
      } else {
        expect(config.options.useConpty).toBeUndefined();
      }
    });

    it('falls back to platform shell when binaryPath is empty', () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: '',
        agent: '',
      });

      const winConfig = runner.resolveSpawnConfig('win32');
      expect(winConfig.file).toBe(process.env.COMSPEC || 'cmd.exe');

      const posixConfig = runner.resolveSpawnConfig('linux');
      expect(posixConfig.file).toBe(process.env.SHELL || '/bin/sh');
    });
  });

  describe('live execution', () => {
    it('executes a live PTY child process and captures output', async () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: process.execPath,
        agent: '',
        args: ['-e', 'console.log("PTY_LIVE_SUCCESS");'],
        dryRun: false,
      });

      let output = '';
      runner.onData((data) => {
        output += data;
      });

      const exitCode = await runner.start();
      expect(exitCode).toBe(0);
      expect(output).toContain('PTY_LIVE_SUCCESS');
    });
  });

  describe('error handling and remediation', () => {
    it('formats actionable error messages when spawn fails', async () => {
      const runner = new PtyRunner({
        projectDir: process.cwd(),
        binaryPath: 'non-existent-binary-12345-xyz',
        agent: 'planner',
        dryRun: false,
      });

      await expect(runner.start()).rejects.toThrow(/Failed to spawn PTY/);
    });
  });
});
