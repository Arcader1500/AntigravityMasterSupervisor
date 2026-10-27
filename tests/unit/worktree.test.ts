import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRunWorkspace, removeRunWorkspace } from '../../src/core/worktree.js';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createRepo(): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.agy-worktree-test-'));
  roots.push(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(root, '.gitignore'), '.agy/\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  git(root, 'add', '.gitignore', 'tracked.txt');
  git(root, 'commit', '-m', 'base');
  return root;
}

function addInputs(root: string) {
  const specPath = path.join(root, 'approved-spec.md');
  const planPath = path.join(root, 'approved-plan.md');
  fs.writeFileSync(specPath, 'spec revision\n');
  fs.writeFileSync(planPath, 'plan revision\n');
  fs.mkdirSync(path.join(root, '.agy'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agy', 'config.json'), '{"supervisor":{"policy":{"version":1,"rules":[]}}}\n');
  const decisionsPath = path.join(root, '.agy', 'runs', 'run-one', 'decisions.jsonl');
  fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
  fs.writeFileSync(decisionsPath, '{"id":"d1","status":"answered"}\n');
  return {
    specPath,
    planPath,
    decisionsPath,
    specRevision: hash('spec revision\n'),
    planRevision: hash('plan revision\n'),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('per-run Git workspace', () => {
  it('creates/reuses an isolated branch and copies verified approved inputs without changing dirty user files', () => {
    const root = createRepo();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'user dirty edit\n');
    fs.writeFileSync(path.join(root, 'user-untracked.txt'), 'keep me\n');
    const inputs = addInputs(root);
    const before = git(root, 'status', '--porcelain');

    const workspace = createRunWorkspace(root, 'run-one', {
      spec: { path: inputs.specPath, revision: inputs.specRevision },
      plan: { path: inputs.planPath, revision: inputs.planRevision },
      decisionsPath: inputs.decisionsPath,
    });
    const reused = createRunWorkspace(root, 'run-one', {
      spec: { path: inputs.specPath, revision: inputs.specRevision },
      plan: { path: inputs.planPath, revision: inputs.planRevision },
      decisionsPath: inputs.decisionsPath,
    });

    expect(reused.root).toBe(workspace.root);
    expect(workspace.branch).toContain('run-one');
    expect(workspace.baseRevision).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8')).toBe('user dirty edit\n');
    expect(fs.readFileSync(path.join(root, 'user-untracked.txt'), 'utf8')).toBe('keep me\n');
    expect(git(root, 'status', '--porcelain')).toBe(before);
    expect(workspace.inputManifest.map((item) => item.name)).toEqual(expect.arrayContaining(['spec', 'plan', 'policy', 'decisions']));
    for (const item of workspace.inputManifest) {
      expect(fs.readFileSync(path.join(workspace.root, item.targetPath))).toEqual(fs.readFileSync(item.sourcePath));
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(workspace.controlStateRoot).toBe(path.join(root, '.agy', 'runs', 'run-one'));
  });

  it('rejects input revisions that do not match the approved snapshot', () => {
    const root = createRepo();
    const inputs = addInputs(root);
    expect(() => createRunWorkspace(root, 'run-one', {
      spec: { path: inputs.specPath, revision: '0'.repeat(64) },
      plan: { path: inputs.planPath, revision: inputs.planRevision },
    })).toThrow(/revision|hash/i);
    expect(git(root, 'worktree', 'list', '--porcelain').split('worktree ').length).toBe(2);
  });

  it('rejects a changed copied approval snapshot when reusing the run', () => {
    const root = createRepo();
    const inputs = addInputs(root);
    const workspace = createRunWorkspace(root, 'run-one', {
      spec: { path: inputs.specPath, revision: inputs.specRevision },
      plan: { path: inputs.planPath, revision: inputs.planRevision },
    });
    const spec = workspace.inputManifest.find((item) => item.name === 'spec')!;
    fs.chmodSync(path.join(workspace.root, spec.targetPath), 0o644);
    fs.writeFileSync(path.join(workspace.root, spec.targetPath), 'changed snapshot');
    expect(() => createRunWorkspace(root, 'run-one', {
      spec: { path: inputs.specPath, revision: inputs.specRevision },
      plan: { path: inputs.planPath, revision: inputs.planRevision },
    })).toThrow(/snapshot.*sha|sha.*verification/i);
  });

  it('rejects a foreign worktree that occupies the run path and never deletes it', () => {
    const root = createRepo();
    const foreign = path.join(root, '.agy', 'worktrees', 'run-one');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'foreign.txt'), 'owned elsewhere');
    expect(() => createRunWorkspace(root, 'run-one')).toThrow(/foreign|conflict|identity/i);
    expect(fs.readFileSync(path.join(foreign, 'foreign.txt'), 'utf8')).toBe('owned elsewhere');
  });

  it('detects base drift and cleanup removes only a recorded supervisor workspace', () => {
    const root = createRepo();
    const workspace = createRunWorkspace(root, 'run-one');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'new base\n');
    git(root, 'add', 'tracked.txt');
    git(root, 'commit', '-m', 'advance base');
    expect(() => createRunWorkspace(root, 'run-one')).toThrow(/base|drift/i);
    removeRunWorkspace(root, 'run-one');
    expect(fs.existsSync(workspace.root)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8')).toBe('new base\n');
  });

  it('stops when the repository is not a Git worktree', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.agy-no-git-test-'));
    roots.push(root);
    expect(() => createRunWorkspace(root, 'run-one')).toThrow(/git/i);
  });
});
