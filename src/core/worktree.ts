import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface ApprovedInput {
  path: string;
  revision: string;
}

export interface RunWorkspaceOptions {
  baseRevision?: string;
  spec?: ApprovedInput;
  plan?: ApprovedInput;
  decisionsPath?: string;
}

export interface RunWorkspaceInput {
  name: 'spec' | 'plan' | 'policy' | 'decisions';
  sourcePath: string;
  targetPath: string;
  sha256: string;
}

export interface RunWorkspace {
  root: string;
  branch: string;
  baseRevision: string;
  controlStateRoot: string;
  inputManifest: RunWorkspaceInput[];
  status: 'clean' | 'dirty';
}

interface WorkspaceMarker {
  schemaVersion: 1;
  runId: string;
  root: string;
  branch: string;
  baseRevision: string;
  createdAt: string;
  inputManifest: RunWorkspaceInput[];
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function normalized(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertNoSymlink(filePath: string): void {
  const absolute = path.resolve(filePath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symbolic link in supervisor workspace path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function sha256(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function resolveInput(repoRoot: string, inputPath: string, name: RunWorkspaceInput['name']): string {
  const absolute = path.resolve(repoRoot, inputPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${name} snapshot must be inside the repository`);
  }
  assertNoSymlink(absolute);
  const actual = fs.realpathSync(absolute);
  if (normalized(actual) !== normalized(absolute)) throw new Error(`${name} snapshot resolves outside the repository`);
  if (!fs.statSync(actual).isFile()) throw new Error(`${name} snapshot must be a file`);
  return actual;
}

function readWorktrees(repoRoot: string): Map<string, { branch?: string; head?: string }> {
  const lines = git(repoRoot, 'worktree', 'list', '--porcelain').split(/\r?\n/);
  const worktrees = new Map<string, { branch?: string; head?: string }>();
  let currentPath: string | undefined;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = path.resolve(line.slice('worktree '.length));
      worktrees.set(normalized(currentPath), {});
    } else if (currentPath && line.startsWith('branch ')) {
      worktrees.get(normalized(currentPath))!.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (currentPath && line.startsWith('HEAD ')) {
      worktrees.get(normalized(currentPath))!.head = line.slice('HEAD '.length);
    } else if (!line) currentPath = undefined;
  }
  return worktrees;
}

function worktreeStatus(root: string): RunWorkspace['status'] {
  return git(root, 'status', '--porcelain', '--untracked-files=all').length === 0 ? 'clean' : 'dirty';
}

function copyInputs(
  repoRoot: string,
  targetRoot: string,
  runId: string,
  options: RunWorkspaceOptions,
): RunWorkspaceInput[] {
  if (Boolean(options.spec) !== Boolean(options.plan)) throw new Error('Approved spec and plan snapshots must be provided together');
  const sources: Array<{ name: RunWorkspaceInput['name']; path: string; revision?: string }> = [];
  if (options.spec && options.plan) {
    sources.push(
      { name: 'spec', path: options.spec.path, revision: options.spec.revision },
      { name: 'plan', path: options.plan.path, revision: options.plan.revision },
    );
  }

  const policyPath = path.join(repoRoot, '.agy', 'config.json');
  if (fs.existsSync(policyPath)) sources.push({ name: 'policy', path: policyPath });
  if (options.decisionsPath) {
    const expectedPrefix = path.join(repoRoot, '.agy', 'runs', runId) + path.sep;
    const decisionPath = path.resolve(repoRoot, options.decisionsPath);
    if (!normalized(decisionPath).startsWith(normalized(expectedPrefix))) {
      throw new Error('Accepted decision snapshot must be under this run’s canonical state directory');
    }
    sources.push({ name: 'decisions', path: decisionPath });
  }

  const inputRoot = path.join(targetRoot, '.agy', 'supervisor-input', runId);
  fs.mkdirSync(inputRoot, { recursive: true });
  const manifest: RunWorkspaceInput[] = [];
  for (const source of sources) {
    const sourcePath = resolveInput(repoRoot, source.path, source.name);
    const contents = fs.readFileSync(sourcePath);
    const revision = sha256(contents);
    if (source.revision && revision !== source.revision) {
      throw new Error(`${source.name} snapshot revision does not match its approved SHA-256`);
    }
    const extension = path.extname(sourcePath);
    const targetPath = path.join('.agy', 'supervisor-input', runId, `${source.name}${extension}`);
    const target = path.join(targetRoot, targetPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o444 });
    fs.chmodSync(target, 0o444);
    const copiedHash = sha256(fs.readFileSync(target));
    if (copiedHash !== revision) throw new Error(`${source.name} snapshot copy failed SHA-256 verification`);
    manifest.push({ name: source.name, sourcePath, targetPath, sha256: revision });
  }
  fs.writeFileSync(path.join(inputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

function readMarker(controlStateRoot: string): WorkspaceMarker | undefined {
  const markerPath = path.join(controlStateRoot, 'workspace.json');
  if (!fs.existsSync(markerPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8')) as WorkspaceMarker;
  } catch {
    throw new Error('Supervisor worktree ownership marker is malformed');
  }
}

function verifyInputManifest(targetRoot: string, runId: string, manifest: unknown): asserts manifest is RunWorkspaceInput[] {
  if (!Array.isArray(manifest)) throw new Error('Supervisor worktree input manifest is malformed');
  const expectedRoot = path.join('.agy', 'supervisor-input', runId);
  const seen = new Set<string>();
  for (const item of manifest) {
    if (
      !item || typeof item !== 'object' ||
      !['spec', 'plan', 'policy', 'decisions'].includes((item as RunWorkspaceInput).name) ||
      typeof (item as RunWorkspaceInput).targetPath !== 'string' ||
      typeof (item as RunWorkspaceInput).sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test((item as RunWorkspaceInput).sha256)
    ) throw new Error('Supervisor worktree input manifest is malformed');
    const entry = item as RunWorkspaceInput;
    if (seen.has(entry.name)) throw new Error('Supervisor worktree input manifest has duplicate entries');
    seen.add(entry.name);
    const relative = path.relative(expectedRoot, entry.targetPath);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Supervisor worktree input manifest escapes its run directory');
    }
    const target = path.join(targetRoot, entry.targetPath);
    assertNoSymlink(target);
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== entry.sha256) {
      throw new Error(`Supervisor ${entry.name} snapshot failed SHA-256 verification`);
    }
  }
  const manifestPath = path.join(targetRoot, expectedRoot, 'manifest.json');
  assertNoSymlink(manifestPath);
  if (!fs.existsSync(manifestPath) || JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) !== JSON.stringify(manifest)) {
    throw new Error('Supervisor worktree manifest file does not match canonical run state');
  }
}

export function createRunWorkspace(repoRoot: string, runId: string, options: RunWorkspaceOptions = {}): RunWorkspace {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error('Invalid run ID');
  const inputRoot = path.resolve(repoRoot);
  if (!fs.existsSync(inputRoot) || !fs.statSync(inputRoot).isDirectory()) throw new Error('Repository root must be an existing directory');
  const root = fs.realpathSync(inputRoot);
  let gitRoot: string;
  try {
    gitRoot = path.resolve(git(root, 'rev-parse', '--show-toplevel'));
  } catch {
    throw new Error(`A Git repository is required for a run workspace: ${root}`);
  }
  if (normalized(gitRoot) !== normalized(root)) throw new Error('repoRoot must be the Git repository root');

  const baseRevision = options.baseRevision ?? git(root, 'rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40,64}$/i.test(baseRevision)) throw new Error('Base revision must be a full Git commit SHA');
  if (git(root, 'rev-parse', `${baseRevision}^{commit}`) !== git(root, 'rev-parse', 'HEAD') && options.baseRevision === undefined) {
    throw new Error('Could not resolve the current base revision');
  }
  const branch = `agy/run-${runId}`;
  const controlStateRoot = path.join(root, '.agy', 'runs', runId);
  const worktreeRoot = path.join(root, '.agy', 'worktrees');
  const workspaceRoot = path.join(worktreeRoot, runId);
  assertNoSymlink(path.join(root, '.agy'));
  assertNoSymlink(controlStateRoot);
  assertNoSymlink(worktreeRoot);
  assertNoSymlink(workspaceRoot);
  fs.mkdirSync(controlStateRoot, { recursive: true });
  fs.mkdirSync(worktreeRoot, { recursive: true });

  const worktrees = readWorktrees(root);
  const registered = worktrees.get(normalized(workspaceRoot));
  const marker = readMarker(controlStateRoot);
  if (registered || fs.existsSync(workspaceRoot) || marker) {
    if (!registered || !marker || fs.existsSync(workspaceRoot) === false) {
      throw new Error('Conflicting or foreign workspace occupies this run identity');
    }
    if (
      marker.schemaVersion !== 1 || marker.runId !== runId || normalized(marker.root) !== normalized(workspaceRoot) ||
      marker.branch !== branch || registered.branch !== branch
    ) throw new Error('Worktree identity does not match the supervisor-owned run');
    if (marker.baseRevision !== baseRevision || git(root, 'rev-parse', 'HEAD') !== marker.baseRevision) {
      throw new Error('Run workspace base revision drifted; create a new run workspace');
    }
    verifyInputManifest(workspaceRoot, runId, marker.inputManifest);
    const status = worktreeStatus(workspaceRoot);
    return { root: workspaceRoot, branch, baseRevision: marker.baseRevision, controlStateRoot, inputManifest: marker.inputManifest, status };
  }

  if (git(root, 'branch', '--list', branch)) throw new Error(`Run branch already exists without a recorded worktree: ${branch}`);

  let createdWorktree = false;
  try {
    git(root, 'worktree', 'add', '-b', branch, workspaceRoot, baseRevision);
    createdWorktree = true;
    const inputManifest = copyInputs(root, workspaceRoot, runId, options);
    const record: WorkspaceMarker = {
      schemaVersion: 1,
      runId,
      root: workspaceRoot,
      branch,
      baseRevision,
      createdAt: new Date().toISOString(),
      inputManifest,
    };
    fs.writeFileSync(path.join(controlStateRoot, 'workspace.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    return { root: workspaceRoot, branch, baseRevision, controlStateRoot, inputManifest, status: worktreeStatus(workspaceRoot) };
  } catch (error) {
    if (createdWorktree) {
      try {
        git(root, 'worktree', 'remove', '--force', workspaceRoot);
        git(root, 'branch', '-D', branch);
      } catch {
        // Keep any state that Git no longer proves safe to clean up.
      }
    }
    throw error;
  }
}

export function removeRunWorkspace(repoRoot: string, runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error('Invalid run ID');
  const root = fs.realpathSync(path.resolve(repoRoot));
  if (normalized(path.resolve(git(root, 'rev-parse', '--show-toplevel'))) !== normalized(root)) {
    throw new Error('repoRoot must be the Git repository root');
  }
  const controlStateRoot = path.join(root, '.agy', 'runs', runId);
  const workspaceRoot = path.join(root, '.agy', 'worktrees', runId);
  const marker = readMarker(controlStateRoot);
  if (!marker) throw new Error('Cannot remove a worktree without a supervisor ownership marker');
  const branch = `agy/run-${runId}`;
  if (
    marker.schemaVersion !== 1 || marker.runId !== runId || marker.branch !== branch ||
    normalized(marker.root) !== normalized(workspaceRoot)
  ) throw new Error('Supervisor worktree ownership marker does not match the requested run');
  const registered = readWorktrees(root).get(normalized(workspaceRoot));
  if (!registered || registered.branch !== branch || !fs.existsSync(workspaceRoot)) {
    throw new Error('Supervisor-owned worktree is missing or has conflicting Git identity');
  }
  // Git refuses removal when non-ignored user changes would be lost.
  git(root, 'worktree', 'remove', workspaceRoot);
  try {
    git(root, 'branch', '-d', branch);
    fs.rmSync(path.join(controlStateRoot, 'workspace.json'));
  } catch {
    // Preserve the branch and marker when it contains commits that Git will not safely delete.
  }
}
