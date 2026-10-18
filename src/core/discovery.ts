import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  GitCheckResult,
  AgyBinaryResult,
  ProjectConfigCheckResult,
  PreflightReport,
} from './types.js';

export interface PreflightOptions {
  agyBin?: string;
}

export interface PreflightDoctorOptions extends PreflightOptions {
  targetDir?: string;
}

/**
 * Resolves a given path to an absolute path, defaulting to process.cwd().
 * Throws an error if the directory does not exist or is not a directory.
 */
export function resolveTargetDir(inputDir?: string): string {
  const target =
    inputDir && inputDir.trim().length > 0
      ? path.resolve(process.cwd(), inputDir.trim())
      : process.cwd();

  if (!fs.existsSync(target)) {
    throw new Error(`Target directory does not exist: ${target}`);
  }

  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${target}`);
  }

  return target;
}

/**
 * Inspects whether the target directory is inside a Git repository,
 * returning repository root, current branch, and clean/dirty working tree status.
 */
export function checkGitRepo(targetDir: string): GitCheckResult {
  try {
    const rootDirRaw = execSync('git rev-parse --show-toplevel', {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const rootDir = path.resolve(rootDirRaw);

    let branch: string | undefined;
    try {
      const branchRaw = execSync('git branch --show-current', {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

      if (branchRaw) {
        branch = branchRaw;
      } else {
        try {
          branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: targetDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
        } catch {
          branch = 'HEAD';
        }
      }
    } catch {
      branch = undefined;
    }

    let isClean = true;
    try {
      const statusRaw = execSync('git status --porcelain', {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      isClean = statusRaw.length === 0;
    } catch {
      isClean = false;
    }

    return {
      isGit: true,
      rootDir,
      branch,
      isClean,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      isGit: false,
      error,
    };
  }
}

/**
 * Attempts to probe the executable version if the file exists.
 */
function tryGetVersion(binPath: string): string | undefined {
  if (!fs.existsSync(binPath)) {
    return undefined;
  }
  try {
    const output = execSync(`"${binPath}" --version`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2000,
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Locates the Antigravity `agy` CLI binary.
 * Priority:
 * 1. Explicit overridePath parameter
 * 2. AGY_BIN_PATH environment variable
 * 3. System PATH directories (checking .cmd, .exe, .bat on Windows)
 */
export function findAgyBinary(overridePath?: string): AgyBinaryResult {
  if (overridePath && overridePath.trim().length > 0) {
    const trimmed = overridePath.trim();
    const version = tryGetVersion(trimmed);
    return {
      path: trimmed,
      source: 'override',
      ...(version ? { version } : {}),
    };
  }

  const envPath = process.env.AGY_BIN_PATH;
  if (envPath && envPath.trim().length > 0) {
    const trimmed = envPath.trim();
    const version = tryGetVersion(trimmed);
    return {
      path: trimmed,
      source: 'env',
      ...(version ? { version } : {}),
    };
  }

  const pathEnv = process.env.PATH || process.env.Path || '';
  const pathDirs = pathEnv
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);

  const isWindows = process.platform === 'win32';
  const extensions = isWindows ? ['.cmd', '.exe', '.bat', ''] : [''];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `agy${ext}`);
      if (fs.existsSync(candidate)) {
        try {
          const stat = fs.statSync(candidate);
          if (stat.isFile()) {
            if (!isWindows) {
              fs.accessSync(candidate, fs.constants.X_OK);
            }
            const version = tryGetVersion(candidate);
            return {
              path: candidate,
              source: 'path',
              ...(version ? { version } : {}),
            };
          }
        } catch {
          // Continue searching if file cannot be accessed
        }
      }
    }
  }

  return {
    path: null,
    source: 'none',
  };
}

/**
 * Checks for presence of project instruction files (GEMINI.md, CLAUDE.md)
 * and supervisor configurations (.agy directory or agy.config.json).
 */
export function inspectProjectConfig(targetDir: string): ProjectConfigCheckResult {
  const hasGeminiMd =
    fs.existsSync(path.join(targetDir, 'GEMINI.md')) ||
    fs.existsSync(path.join(targetDir, 'gemini.md'));

  const hasClaudeMd =
    fs.existsSync(path.join(targetDir, 'CLAUDE.md')) ||
    fs.existsSync(path.join(targetDir, 'claude.md'));

  const hasAgyConfig =
    fs.existsSync(path.join(targetDir, '.agy')) ||
    fs.existsSync(path.join(targetDir, 'agy.config.json'));

  return {
    hasGeminiMd,
    hasClaudeMd,
    hasAgyConfig,
  };
}

/**
 * Executes a full preflight diagnosis on the target environment.
 */
export async function runPreflightDoctor(
  targetDirOrOptions?: string | PreflightDoctorOptions,
  options?: PreflightOptions
): Promise<PreflightReport> {
  let targetDir: string | undefined;
  let agyBin: string | undefined;

  if (typeof targetDirOrOptions === 'string') {
    targetDir = targetDirOrOptions;
    agyBin = options?.agyBin;
  } else if (typeof targetDirOrOptions === 'object' && targetDirOrOptions !== null) {
    targetDir = targetDirOrOptions.targetDir;
    agyBin = targetDirOrOptions.agyBin ?? options?.agyBin;
  } else {
    agyBin = options?.agyBin;
  }

  const resolvedDir = resolveTargetDir(targetDir);
  const git = checkGitRepo(resolvedDir);
  const agy = findAgyBinary(agyBin);
  const config = inspectProjectConfig(resolvedDir);

  const allPassed = Boolean(git.isGit && agy.path !== null);

  return {
    targetDir: resolvedDir,
    git,
    agyBin: agy,
    config,
    allPassed,
  };
}
