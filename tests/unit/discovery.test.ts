import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  resolveTargetDir,
  checkGitRepo,
  findAgyBinary,
  inspectProjectConfig,
  runPreflightDoctor,
} from '../../src/core/discovery.js';

describe('Discovery Preflight', () => {
  const originalEnv = { ...process.env };
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-discovery-test-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('resolveTargetDir', () => {
    it('resolves valid target directory and throws for non-existent path', () => {
      expect(resolveTargetDir(process.cwd())).toBe(process.cwd());
      expect(() => resolveTargetDir('non-existent-directory-xyz')).toThrow();
    });

    it('defaults to process.cwd() when no path or empty string is provided', () => {
      expect(resolveTargetDir()).toBe(process.cwd());
      expect(resolveTargetDir('')).toBe(process.cwd());
      expect(resolveTargetDir('   ')).toBe(process.cwd());
    });

    it('resolves relative directory to absolute path', () => {
      const resolved = resolveTargetDir('tests');
      expect(resolved).toBe(path.resolve(process.cwd(), 'tests'));
    });

    it('throws if target path is a file rather than a directory', () => {
      const filePath = path.join(tempBaseDir, 'some-file.txt');
      fs.writeFileSync(filePath, 'hello');
      expect(() => resolveTargetDir(filePath)).toThrow(/not a directory/);
    });
  });

  describe('checkGitRepo', () => {
    it('detects git repo in current directory with branch and clean status', () => {
      const res = checkGitRepo(process.cwd());
      expect(res.isGit).toBe(true);
      expect(typeof res.branch).toBe('string');
      expect(typeof res.isClean).toBe('boolean');
      expect(res.rootDir).toBeDefined();
    });

    it('returns isGit false for non-git directory', () => {
      const nonGitDir = path.join(tempBaseDir, 'no-git');
      fs.mkdirSync(nonGitDir);
      const res = checkGitRepo(nonGitDir);
      expect(res.isGit).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('detects dirty working tree when uncommitted files exist', () => {
      const gitDir = path.join(tempBaseDir, 'repo');
      fs.mkdirSync(gitDir);
      execSync('git init', { cwd: gitDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: gitDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'ignore' });

      // Create an untracked file to make repo dirty
      fs.writeFileSync(path.join(gitDir, 'dirty.txt'), 'uncommitted changes');

      const res = checkGitRepo(gitDir);
      expect(res.isGit).toBe(true);
      expect(res.isClean).toBe(false);
    });
  });

  describe('checkGitRepo branch resolution fallback', () => {
    const isWindows = process.platform === 'win32';

    function realGitPath(): string {
      const out = isWindows
        ? execSync('where.exe git', { encoding: 'utf-8' })
        : execSync('command -v git', { encoding: 'utf-8' });
      const first = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (!first) {
        throw new Error('git executable not found on PATH');
      }
      return first;
    }

    function createRepo(name: string): string {
      const repoDir = path.join(tempBaseDir, name);
      fs.mkdirSync(repoDir);
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# fixture\n');
      execSync('git add README.md', { cwd: repoDir, stdio: 'ignore' });
      execSync('git commit -m "initial commit"', { cwd: repoDir, stdio: 'ignore' });
      return repoDir;
    }

    /**
     * Installs a git shim on PATH that fails `git branch --show-current`
     * and/or `git rev-parse --abbrev-ref HEAD` while forwarding everything
     * else to the real git binary.
     */
    function installGitShim(options: {
      failShowCurrent: boolean;
      failAbbrevRef: boolean;
    }): void {
      const shimDir = fs.mkdtempSync(path.join(tempBaseDir, 'git-shim-'));
      const realGit = realGitPath();

      if (isWindows) {
        const lines = [
          '@echo off',
          'if "%~1"=="branch" if "%~2"=="--show-current" goto showcurrent',
          'if "%~1"=="rev-parse" if "%~2"=="--abbrev-ref" goto abbrev',
          `"${realGit}" %*`,
          'exit /b %ERRORLEVEL%',
          ':showcurrent',
          ...(options.failShowCurrent
            ? ['echo Unknown option --show-current 1>&2', 'exit /b 129']
            : ['exit /b 0']),
          ':abbrev',
          ...(options.failAbbrevRef
            ? ['echo fatal: ambiguous argument 1>&2', 'exit /b 128']
            : [`"${realGit}" %*`, 'exit /b %ERRORLEVEL%']),
        ];
        fs.writeFileSync(path.join(shimDir, 'git.cmd'), `${lines.join('\r\n')}\r\n`);
      } else {
        const lines = [
          '#!/bin/sh',
          'if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then',
          ...(options.failShowCurrent
            ? ['  echo "error: unknown option" >&2', '  exit 129']
            : ['  exit 0']),
          'fi',
          'if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then',
          ...(options.failAbbrevRef
            ? ['  echo "fatal: ambiguous argument" >&2', '  exit 128']
            : [`  exec "${realGit}" "$@"`]),
          'fi',
          `exec "${realGit}" "$@"`,
        ];
        fs.writeFileSync(path.join(shimDir, 'git'), `${lines.join('\n')}\n`, { mode: 0o755 });
      }

      process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH || ''}`;
      if (isWindows) {
        process.env.Path = process.env.PATH;
      }
    }

    it('falls back to rev-parse when git branch --show-current throws', () => {
      const repoDir = createRepo('branch-throws');
      const expectedBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();

      installGitShim({ failShowCurrent: true, failAbbrevRef: false });

      const res = checkGitRepo(repoDir);
      expect(res.isGit).toBe(true);
      expect(res.branch).toBe(expectedBranch);
      expect(res.branch).not.toBe('HEAD');
    });

    it('falls back to rev-parse when git branch --show-current returns empty output', () => {
      const repoDir = createRepo('branch-empty');
      const expectedBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();

      installGitShim({ failShowCurrent: false, failAbbrevRef: false });

      const res = checkGitRepo(repoDir);
      expect(res.isGit).toBe(true);
      expect(res.branch).toBe(expectedBranch);
      expect(res.branch).not.toBe('HEAD');
    });

    it("falls back to 'HEAD' only when both branch commands fail", () => {
      const repoDir = createRepo('branch-both-fail');

      installGitShim({ failShowCurrent: true, failAbbrevRef: true });

      const res = checkGitRepo(repoDir);
      expect(res.isGit).toBe(true);
      expect(res.branch).toBe('HEAD');
    });
  });

  describe('findAgyBinary', () => {
    it('prefers explicit binary override when provided and file exists', () => {
      const mockBin = path.join(tempBaseDir, 'mock-bin-path');
      fs.writeFileSync(mockBin, 'mock content', { mode: 0o755 });
      const bin = findAgyBinary(mockBin);
      expect(bin.path).toBe(mockBin);
      expect(bin.source).toBe('override');
    });

    it('returns null and override source when explicit binary override does not exist', () => {
      const bin = findAgyBinary('non-existent-override-bin');
      expect(bin.path).toBeNull();
      expect(bin.source).toBe('override');
    });

    it('falls back to AGY_BIN_PATH when no override is given and env file exists', () => {
      delete process.env.AGY_BIN_PATH;
      const envBin = path.join(tempBaseDir, 'env-mock-bin');
      fs.writeFileSync(envBin, 'mock content', { mode: 0o755 });
      process.env.AGY_BIN_PATH = envBin;
      const bin = findAgyBinary();
      expect(bin.path).toBe(envBin);
      expect(bin.source).toBe('env');
    });

    it('returns null and env source when AGY_BIN_PATH does not exist', () => {
      delete process.env.AGY_BIN_PATH;
      process.env.AGY_BIN_PATH = 'non-existent-env-bin';
      const bin = findAgyBinary();
      expect(bin.path).toBeNull();
      expect(bin.source).toBe('env');
    });

    it('finds binary on PATH when neither override nor AGY_BIN_PATH is set', () => {
      delete process.env.AGY_BIN_PATH;
      const binDir = path.join(tempBaseDir, 'bin');
      fs.mkdirSync(binDir);

      const isWindows = process.platform === 'win32';
      const binName = isWindows ? 'agy.cmd' : 'agy';
      const binPath = path.join(binDir, binName);
      fs.writeFileSync(binPath, isWindows ? '@echo off\r\necho 1.0.0' : '#!/bin/sh\necho 1.0.0\n', {
        mode: 0o755,
      });

      process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
      if (isWindows) {
        process.env.Path = process.env.PATH;
      }

      const bin = findAgyBinary();
      expect(bin.source).toBe('path');
      expect(bin.path).toBe(binPath);
    });

    it('finds antigravity binary or .ps1 on PATH when agy is not present', () => {
      delete process.env.AGY_BIN_PATH;
      const binDir = path.join(tempBaseDir, 'bin-antigravity');
      fs.mkdirSync(binDir);

      const isWindows = process.platform === 'win32';
      const binName = isWindows ? 'antigravity.ps1' : 'antigravity';
      const binPath = path.join(binDir, binName);
      fs.writeFileSync(binPath, isWindows ? 'Write-Output "1.0.0"' : '#!/bin/sh\necho 1.0.0\n', {
        mode: 0o755,
      });

      process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
      if (isWindows) {
        process.env.Path = process.env.PATH;
      }

      const bin = findAgyBinary();
      expect(bin.source).toBe('path');
      expect(bin.path).toBe(binPath);
    });

    it('prefers agy over antigravity on PATH when both are present', () => {
      delete process.env.AGY_BIN_PATH;
      const binDir = path.join(tempBaseDir, 'bin-both');
      fs.mkdirSync(binDir);

      const isWindows = process.platform === 'win32';
      const agyName = isWindows ? 'agy.cmd' : 'agy';
      const antiName = isWindows ? 'antigravity.cmd' : 'antigravity';
      const agyPath = path.join(binDir, agyName);
      const antiPath = path.join(binDir, antiName);
      fs.writeFileSync(agyPath, '@echo off', { mode: 0o755 });
      fs.writeFileSync(antiPath, '@echo off', { mode: 0o755 });

      process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
      if (isWindows) {
        process.env.Path = process.env.PATH;
      }

      const bin = findAgyBinary();
      expect(bin.source).toBe('path');
      expect(bin.path).toBe(agyPath);
    });

    it('returns null and none when binary is not found anywhere', () => {
      delete process.env.AGY_BIN_PATH;
      process.env.PATH = path.join(tempBaseDir, 'empty');
      if (process.platform === 'win32') {
        process.env.Path = process.env.PATH;
      }

      const bin = findAgyBinary();
      expect(bin.path).toBeNull();
      expect(bin.source).toBe('none');
    });
  });

  describe('inspectProjectConfig', () => {
    it('inspects project instruction files and agy configs', () => {
      const confDir = path.join(tempBaseDir, 'conf');
      fs.mkdirSync(confDir);

      const empty = inspectProjectConfig(confDir);
      expect(empty.hasGeminiMd).toBe(false);
      expect(empty.hasClaudeMd).toBe(false);
      expect(empty.hasAgyConfig).toBe(false);

      fs.writeFileSync(path.join(confDir, 'GEMINI.md'), '# Gemini rules');
      fs.writeFileSync(path.join(confDir, 'CLAUDE.md'), '# Claude rules');
      fs.mkdirSync(path.join(confDir, '.agy'));

      const populated = inspectProjectConfig(confDir);
      expect(populated.hasGeminiMd).toBe(true);
      expect(populated.hasClaudeMd).toBe(true);
      expect(populated.hasAgyConfig).toBe(true);
    });

    it('detects agy.config.json as agy configuration', () => {
      const confDir = path.join(tempBaseDir, 'conf2');
      fs.mkdirSync(confDir);
      fs.writeFileSync(path.join(confDir, 'agy.config.json'), '{}');

      const config = inspectProjectConfig(confDir);
      expect(config.hasAgyConfig).toBe(true);
    });
  });

  describe('runPreflightDoctor', () => {
    it('returns diagnostic checklist with allPassed true for healthy environment', async () => {
      const isWindows = process.platform === 'win32';
      const fixtureBin = path.join(tempBaseDir, isWindows ? 'custom-agy.cmd' : 'custom-agy');
      fs.writeFileSync(fixtureBin, isWindows ? '@echo off\r\necho 1.0.0' : '#!/bin/sh\necho 1.0.0\n', {
        mode: 0o755,
      });

      const report = await runPreflightDoctor(process.cwd(), { agyBin: fixtureBin });
      expect(report.targetDir).toBe(process.cwd());
      expect(report.git.isGit).toBe(true);
      expect(report.agyBin.path).toBe(fixtureBin);
      expect(report.config).toBeDefined();
      expect(report.allPassed).toBe(true);
    });

    it('supports single options object signature', async () => {
      const isWindows = process.platform === 'win32';
      const fixtureBin = path.join(tempBaseDir, isWindows ? 'custom-agy.cmd' : 'custom-agy');
      fs.writeFileSync(fixtureBin, isWindows ? '@echo off\r\necho 1.0.0' : '#!/bin/sh\necho 1.0.0\n', {
        mode: 0o755,
      });

      const report = await runPreflightDoctor({ targetDir: process.cwd(), agyBin: fixtureBin });
      expect(report.targetDir).toBe(process.cwd());
      expect(report.agyBin.path).toBe(fixtureBin);
      expect(report.allPassed).toBe(true);
    });

    it('reports allPassed false when explicit override binary does not exist', async () => {
      const report = await runPreflightDoctor(process.cwd(), { agyBin: 'non-existent-agy-binary' });
      expect(report.agyBin.path).toBeNull();
      expect(report.agyBin.source).toBe('override');
      expect(report.allPassed).toBe(false);
    });

    it('reports allPassed false when not in git repository', async () => {
      const isWindows = process.platform === 'win32';
      const fixtureBin = path.join(tempBaseDir, isWindows ? 'custom-agy.cmd' : 'custom-agy');
      fs.writeFileSync(fixtureBin, isWindows ? '@echo off\r\necho 1.0.0' : '#!/bin/sh\necho 1.0.0\n', {
        mode: 0o755,
      });
      const nonGitDir = path.join(tempBaseDir, 'no-git');
      fs.mkdirSync(nonGitDir);

      const report = await runPreflightDoctor(nonGitDir, { agyBin: fixtureBin });
      expect(report.git.isGit).toBe(false);
      expect(report.allPassed).toBe(false);
    });

    it('reports allPassed false when agy binary is not found', async () => {
      delete process.env.AGY_BIN_PATH;
      process.env.PATH = path.join(tempBaseDir, 'empty');
      if (process.platform === 'win32') {
        process.env.Path = process.env.PATH;
      }

      const report = await runPreflightDoctor(process.cwd());
      expect(report.agyBin.path).toBeNull();
      expect(report.allPassed).toBe(false);
    });
  });
});
