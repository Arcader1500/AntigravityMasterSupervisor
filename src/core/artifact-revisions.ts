import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArtifactKind, ArtifactRef } from './types.js';

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function createArtifactRef(kind: ArtifactKind, artifactPath: string, workspaceRoot = process.cwd()): ArtifactRef {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const absolutePath = path.resolve(root, artifactPath);
  if (!isWithin(root, absolutePath)) throw new Error(`Artifact path is outside the selected workspace: ${artifactPath}`);
  let realPath: string;
  try {
    realPath = fs.realpathSync(absolutePath);
  } catch {
    throw new Error(`Artifact does not exist: ${artifactPath}`);
  }
  if (!isWithin(root, realPath)) throw new Error(`Artifact path resolves outside the selected workspace: ${artifactPath}`);
  if (!fs.statSync(realPath).isFile()) throw new Error(`Artifact is not a file: ${artifactPath}`);

  const revision = createHash('sha256').update(fs.readFileSync(realPath)).digest('hex');
  return {
    kind,
    path: path.relative(root, absolutePath).split(path.sep).join('/'),
    revision,
    selectedAt: new Date().toISOString(),
  };
}

export function hasArtifactRevisionChanged(previous: ArtifactRef, current: ArtifactRef): boolean {
  return previous.kind !== current.kind || previous.path !== current.path || previous.revision !== current.revision;
}
