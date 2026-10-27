import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executeVerification, isVerificationEvidenceCurrent, type VerificationEvidence } from '../../src/core/verification.js';

const roots: string[] = [];
function tempRepo(): string {
  // The sandbox allows workspace writes, while child git cannot initialize in its system temp directory.
  const root = fs.mkdtempSync(path.join(process.cwd(), '.tmp-verification-'));
  roots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Verifier Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'baseline\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  return root;
}

function command(cwd: string, args: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'verify-1', argv: [process.execPath, ...args], cwd, authorized: true,
    context: { artifactRevision: 'a'.repeat(64), policySnapshotHash: 'b'.repeat(64), diffScopeHash: 'c'.repeat(64) },
    ...overrides,
  };
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const workspace = path.resolve(process.cwd());
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(`${workspace}${path.sep}`)) throw new Error(`Refusing to remove test path outside workspace: ${resolved}`);
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      const quotedPath = resolved.replace(/'/g, "''");
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath '${quotedPath}' -Recurse -Force`], { stdio: 'ignore' });
    }
  }
});

describe('controlled verification', () => {
  it('captures argv fidelity, cwd, timestamps, exit 0, and redacted output', async () => {
    const root = tempRepo();
    const evidence = await executeVerification(command(root, ['-e', "process.stdout.write(JSON.stringify({cwd:process.cwd(),arg:process.argv[1]})); process.stderr.write('token=secret-value')", 'arg with spaces']));
    expect(evidence.exitCode).toBe(0);
    expect(JSON.parse(evidence.stdout)).toEqual({ cwd: root, arg: 'arg with spaces' });
    expect(evidence.stderr).not.toContain('secret-value');
    expect(evidence.stderr).toContain('[REDACTED]');
    expect(Date.parse(evidence.startedAt)).toBeLessThanOrEqual(Date.parse(evidence.endedAt));
    expect(evidence.commitSha).toMatch(/^[0-9a-f]{40,64}$/);
    expect(evidence.cwd).toBe(root);
  });

  it('captures nonzero exit and caps each output stream at 64 KiB', async () => {
    const root = tempRepo();
    const evidence = await executeVerification(command(root, ['-e', "process.stdout.write('x'.repeat(70*1024));process.stderr.write('y'.repeat(70*1024));process.exit(7)"]));
    expect(evidence.exitCode).toBe(7);
    expect(Buffer.byteLength(evidence.stdout)).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.byteLength(evidence.stderr)).toBeLessThanOrEqual(64 * 1024);
    expect(evidence.truncated).toEqual({ stdout: true, stderr: true });
  });

  it('records interruption as a signal outcome', async () => {
    const root = tempRepo();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 80);
    const evidence = await executeVerification(command(root, ['-e', 'setInterval(() => {}, 1000)'], { abortSignal: controller.signal }));
    clearTimeout(timer);
    expect(evidence.outcome).toBe('interrupted');
    expect(evidence.signal).toBeDefined();
  });

  it('records spawn and output capture errors without claiming verification success', async () => {
    const root = tempRepo();
    const evidence = await executeVerification(command(root, ['-e', ''], { argv: [path.join(root, 'missing-executable')] }));
    expect(evidence.outcome).toBe('startup_error');
    expect(evidence.exitCode).toBeUndefined();
    expect(evidence.startupError).toBeTruthy();
    expect(evidence.stdout).toBe('');
    expect(evidence.stderr).toBe('');
  });

  it('rejects unauthorized, malformed argv, non-absolute cwd, and duplicate evidence IDs', async () => {
    const root = tempRepo();
    await expect(executeVerification(command(root, ['-e', ''], { authorized: false }))).rejects.toThrow(/authorized/i);
    await expect(executeVerification(command(root, ['-e', ''], { argv: [] }))).rejects.toThrow(/argv/i);
    await expect(executeVerification(command(root, ['-e', ''], { cwd: '.' }))).rejects.toThrow(/absolute/i);
    await expect(executeVerification(command(root, ['-e', ''], { priorEvidenceIds: ['verify-1'] }))).rejects.toThrow(/duplicate/i);
  });

  it('fingerprints dirty untracked contents even when HEAD is unchanged and excludes .agy control state', async () => {
    const root = tempRepo();
    fs.mkdirSync(path.join(root, '.agy'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agy', 'events.jsonl'), 'control one');
    const before = await executeVerification(command(root, ['-e', 'process.exit(0)']));
    fs.writeFileSync(path.join(root, '.agy', 'events.jsonl'), 'control two');
    const afterControl = await executeVerification(command(root, ['-e', 'process.exit(0)'], { id: 'verify-2' }));
    expect(afterControl.workingTreeFingerprint).toBe(before.workingTreeFingerprint);
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'user content one');
    const beforeEdit = await executeVerification(command(root, ['-e', 'process.exit(0)'], { id: 'verify-3' }));
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'user content two');
    const afterEdit = await executeVerification(command(root, ['-e', 'process.exit(0)'], { id: 'verify-4' }));
    expect(afterEdit.commitSha).toBe(beforeEdit.commitSha);
    expect(afterEdit.workingTreeFingerprint).not.toBe(beforeEdit.workingTreeFingerprint);
  });

  it('fingerprints staged and unstaged tracked changes', async () => {
    const root = tempRepo();
    const baseline = await executeVerification(command(root, ['-e', 'process.exit(0)']));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'staged update\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    const staged = await executeVerification(command(root, ['-e', 'process.exit(0)']));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'unstaged update\n');
    const unstaged = await executeVerification(command(root, ['-e', 'process.exit(0)']));
    expect(staged.commitSha).toBe(baseline.commitSha);
    expect(staged.workingTreeFingerprint).not.toBe(baseline.workingTreeFingerprint);
    expect(unstaged.workingTreeFingerprint).not.toBe(staged.workingTreeFingerprint);
  });

  it('marks source, artifact, policy, or diff-scope changes stale', async () => {
    const root = tempRepo();
    const evidence = await executeVerification(command(root, ['-e', 'process.exit(0)'])) as VerificationEvidence;
    expect(isVerificationEvidenceCurrent(evidence, root, evidence.context)).toBe(true);
    fs.writeFileSync(path.join(root, 'new.txt'), 'changed');
    expect(isVerificationEvidenceCurrent(evidence, root, evidence.context)).toBe(false);
    expect(isVerificationEvidenceCurrent(evidence, root, { ...evidence.context, artifactRevision: 'd'.repeat(64) })).toBe(false);
    fs.rmSync(path.join(root, 'new.txt'));
    expect(isVerificationEvidenceCurrent(evidence, root, { ...evidence.context, policySnapshotHash: 'd'.repeat(64) })).toBe(false);
    expect(isVerificationEvidenceCurrent(evidence, root, { ...evidence.context, diffScopeHash: 'd'.repeat(64) })).toBe(false);
  });
});
