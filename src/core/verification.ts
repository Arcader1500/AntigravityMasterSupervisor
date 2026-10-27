import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 64 * 1024;
const REDACTION_WINDOW_BYTES = 8 * 1024;
const SECRET_PATTERN = /(token|secret|password|api[_-]?key|authorization)(\s*["']?\s*[:=]\s*["']?)([^\s,"';]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export interface VerificationContext {
  artifactRevision: string;
  policySnapshotHash: string;
  diffScopeHash: string;
}

export interface VerificationCommand {
  id: string;
  argv: string[];
  cwd: string;
  authorized: boolean;
  context: VerificationContext;
  priorEvidenceIds?: string[];
  abortSignal?: AbortSignal;
}

export interface VerificationEvidence {
  id: string;
  argv: string[];
  cwd: string;
  commitSha: string;
  workingTreeFingerprint: string;
  context: VerificationContext;
  startedAt: string;
  endedAt: string;
  outcome: 'exit' | 'signal' | 'interrupted' | 'startup_error';
  exitCode?: number;
  signal?: string;
  startupError?: string;
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean; stderr: boolean };
  redacted: true;
}

interface GitSnapshot {
  root: string;
  commitSha: string;
  fingerprint: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

function isControlPath(relativePath: string): boolean {
  const first = relativePath.split(/[\\/]/, 1)[0];
  return first === '.agy' || first === '.git';
}

function gitSnapshot(cwd: string): GitSnapshot {
  const root = path.resolve(git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').trim());
  const commitSha = git(root, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const staged = git(root, ['diff', '--binary', '--cached', 'HEAD', '--', '.', ':(exclude).agy/**']);
  const worktree = git(root, ['diff', '--binary', '--', '.', ':(exclude).agy/**']);
  const untrackedRaw = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8');
  const untracked: Array<{ path: string; hash: string }> = [];

  for (const relativePath of untrackedRaw.split('\0').filter(Boolean)) {
    if (isControlPath(relativePath)) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Untracked path escapes the repository root.');
    const stat = fs.lstatSync(absolutePath);
    const content = stat.isSymbolicLink() ? Buffer.from(`symlink:${fs.readlinkSync(absolutePath)}`) : fs.readFileSync(absolutePath);
    untracked.push({ path: relativePath.replaceAll('\\', '/'), hash: sha256(content) });
  }
  untracked.sort((left, right) => left.path.localeCompare(right.path));

  const fingerprint = sha256(JSON.stringify({
    commitSha,
    staged: sha256(staged),
    worktree: sha256(worktree),
    untracked,
  }));
  return { root, commitSha, fingerprint };
}

function redact(value: string): string {
  return value.replace(SECRET_PATTERN, '$1$2[REDACTED]').replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}

function captureText(value: Buffer): string {
  return redact(value.toString('utf8'));
}

function captureLimit(value: Buffer): { output: string; truncated: boolean } {
  const safe = captureText(value);
  const encoded = Buffer.from(safe, 'utf8');
  if (encoded.byteLength <= MAX_OUTPUT_BYTES) return { output: safe, truncated: false };
  return {
    output: encoded.subarray(0, MAX_OUTPUT_BYTES).toString('utf8').replace(/\uFFFD$/, ''),
    truncated: true,
  };
}

function validate(command: VerificationCommand): void {
  if (!command || command.authorized !== true) throw new Error('Verification command is not explicitly authorized.');
  if (typeof command.id !== 'string' || command.id.trim() === '') throw new Error('Verification evidence ID is required.');
  if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((part) => typeof part !== 'string')) {
    throw new Error('Verification argv must be a non-empty array of strings.');
  }
  if (!command.argv[0]) throw new Error('Verification argv executable is required.');
  if (path.isAbsolute(command.cwd) !== true) throw new Error('Verification cwd must be absolute.');
  if (!fs.statSync(command.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Verification cwd must be an existing directory.');
  if ((command.priorEvidenceIds ?? []).includes(command.id)) throw new Error(`Duplicate verification evidence ID: ${command.id}`);
  for (const [key, value] of Object.entries(command.context ?? {})) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Verification ${key} is required.`);
  }
  if (!command.context || !command.context.artifactRevision || !command.context.policySnapshotHash || !command.context.diffScopeHash) {
    throw new Error('Artifact, policy, and diff-scope context hashes are required.');
  }
}

export async function executeVerification(command: VerificationCommand): Promise<VerificationEvidence> {
  validate(command);
  const before = gitSnapshot(command.cwd);
  const startedAt = new Date().toISOString();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const capture = (chunks: Buffer[], bytes: number, chunk: Buffer): number => {
    if (bytes >= MAX_OUTPUT_BYTES + REDACTION_WINDOW_BYTES) return bytes;
    const available = MAX_OUTPUT_BYTES + REDACTION_WINDOW_BYTES - bytes;
    const kept = chunk.subarray(0, available);
    if (kept.length) chunks.push(kept);
    return bytes + kept.length;
  };

  return await new Promise<VerificationEvidence>((resolve) => {
    let child;
    let startupError: string | undefined;
    try {
      child = spawn(command.argv[0], command.argv.slice(1), {
        cwd: command.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: command.abortSignal,
      });
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
      child = undefined;
    }

    if (!child) {
      const endedAt = new Date().toISOString();
      resolve({
        id: command.id, argv: [...command.argv], cwd: path.resolve(command.cwd), commitSha: before.commitSha,
        workingTreeFingerprint: before.fingerprint, context: { ...command.context }, startedAt, endedAt,
        outcome: 'startup_error', startupError: redact(startupError ?? 'Unable to start process.'), stdout: '', stderr: '',
        truncated: { stdout: false, stderr: false }, redacted: true,
      });
      return;
    }

    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes = capture(stdoutChunks, stdoutBytes, Buffer.from(chunk)); });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes = capture(stderrChunks, stderrBytes, Buffer.from(chunk)); });
    child.on('error', (error: Error) => { startupError = error.message; });
    child.on('close', (exitCode, signal) => {
      const endedAt = new Date().toISOString();
      const stdout = captureLimit(Buffer.concat(stdoutChunks));
      const stderr = captureLimit(Buffer.concat(stderrChunks));
      const interrupted = command.abortSignal?.aborted === true;
      resolve({
        id: command.id,
        argv: [...command.argv],
        cwd: path.resolve(command.cwd),
        commitSha: before.commitSha,
        workingTreeFingerprint: before.fingerprint,
        context: { ...command.context },
        startedAt,
        endedAt,
        outcome: interrupted ? 'interrupted' : startupError ? 'startup_error' : signal ? 'signal' : 'exit',
        ...(exitCode === null || startupError ? {} : { exitCode }),
        ...(signal ? { signal } : {}),
        ...(startupError ? { startupError: redact(startupError) } : {}),
        stdout: stdout.output,
        stderr: stderr.output,
        truncated: {
          stdout: stdout.truncated || stdoutBytes > MAX_OUTPUT_BYTES,
          stderr: stderr.truncated || stderrBytes > MAX_OUTPUT_BYTES,
        },
        redacted: true,
      });
    });
  });
}

export function isVerificationEvidenceCurrent(
  evidence: VerificationEvidence,
  cwd: string,
  context: VerificationContext,
): boolean {
  try {
    const snapshot = gitSnapshot(cwd);
    return snapshot.commitSha === evidence.commitSha &&
      snapshot.fingerprint === evidence.workingTreeFingerprint &&
      context.artifactRevision === evidence.context.artifactRevision &&
      context.policySnapshotHash === evidence.context.policySnapshotHash &&
      context.diffScopeHash === evidence.context.diffScopeHash;
  } catch {
    return false;
  }
}
