import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArtifactRef } from './types.js';
import { createArtifactRef } from './artifact-revisions.js';

export interface PreflightFinding {
  code: string;
  severity: 'error' | 'warning';
  artifactPath?: string;
  artifactRevision?: string;
  taskId?: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  findings: PreflightFinding[];
  artifact?: ArtifactRef;
}

interface FileDeclaration {
  filePath: string;
  normalizedPath: string;
  intent: 'existing' | 'new';
  owner: string;
  taskId: string;
}

function tableLines(section: string): string[] {
  return section.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function tableRows(section: string): string[][] {
  return tableLines(section).slice(2).map(tableCells).filter((cells) => cells.some(Boolean));
}

function hasTableHeader(section: string, expected: string[]): boolean {
  const lines = tableLines(section);
  if (lines.length < 2) return false;
  const actual = tableCells(lines[0]).map((cell) => cell.toLowerCase().replace(/\s+/g, ''));
  const separator = tableCells(lines[1]).every((cell) => /^:?-{3,}:?$/.test(cell));
  const matches = actual.length === expected.length && expected.every((cell, index) => {
    const value = actual[index];
    const target = cell.toLowerCase().replace(/\s+/g, '');
    return value === target || (target === 'intent' && value === 'intent(existing/new)');
  });
  return separator && matches;
}

function addArtifactContext(findings: PreflightFinding[], artifact: ArtifactRef): PreflightFinding[] {
  return findings.map((finding) => ({
    ...finding,
    artifactPath: finding.artifactPath ?? artifact.path,
    artifactRevision: artifact.revision,
  }));
}

function subsection(metadata: string, name: string): string | undefined {
  const lines = metadata.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === `### ${name}`);
  if (headingIndex < 0) return undefined;
  let end = headingIndex + 1;
  while (end < lines.length && !/^###\s/.test(lines[end])) end++;
  return lines.slice(headingIndex + 1, end).join('\n');
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function containedPath(root: string, declared: string): string | undefined {
  const absolute = path.resolve(root, declared);
  if (!isWithin(root, absolute)) return undefined;
  if (fs.existsSync(absolute)) {
    const real = fs.realpathSync(absolute);
    return isWithin(root, real) ? real : undefined;
  }
  let parent = path.dirname(absolute);
  while (!fs.existsSync(parent) && isWithin(root, parent)) parent = path.dirname(parent);
  if (!isWithin(root, parent)) return undefined;
  const realParent = fs.realpathSync(parent);
  return isWithin(root, realParent) ? absolute : undefined;
}

export function runPreflight(plan: string | ArtifactRef, workspaceRoot: string): PreflightResult {
  const root = path.resolve(workspaceRoot);
  const declaredPlan = typeof plan === 'string' ? plan : plan.path;
  const findings: PreflightFinding[] = [];
  let artifact: ArtifactRef | undefined;
  try {
    artifact = createArtifactRef('plan', declaredPlan, root);
  } catch (error) {
    return { ok: false, findings: [{ code: 'INVALID_PLAN_PATH', severity: 'error', artifactPath: declaredPlan, message: String(error) }] };
  }
  if (typeof plan !== 'string' && plan.revision !== artifact.revision) {
    findings.push({ code: 'STALE_ARTIFACT_REVISION', severity: 'error', artifactPath: artifact.path, message: 'The selected plan content no longer matches its approved revision.' });
  }

  const source = fs.readFileSync(path.resolve(root, declaredPlan), 'utf8');
  const lines = source.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === '## Execution metadata');
  if (headingIndex < 0) {
    findings.push({ code: 'EXECUTION_METADATA_MISSING', severity: 'error', artifactPath: artifact.path, message: 'Plan must contain an exact ## Execution metadata section.' });
    return { ok: false, findings: addArtifactContext(findings, artifact), artifact };
  }
  let metadataEnd = headingIndex + 1;
  while (metadataEnd < lines.length && !/^##\s/.test(lines[metadataEnd])) metadataEnd++;
  const metadata = lines.slice(headingIndex + 1, metadataEnd).join('\n');
  const filesSection = subsection(metadata, 'Files');
  const verificationSection = subsection(metadata, 'Verification');
  if (!filesSection) findings.push({ code: 'FILES_TABLE_MISSING', severity: 'error', artifactPath: artifact.path, message: 'Execution metadata must contain a ### Files table.' });
  if (!verificationSection) findings.push({ code: 'VERIFICATION_TABLE_MISSING', severity: 'error', artifactPath: artifact.path, message: 'Execution metadata must contain a ### Verification table.' });
  if (filesSection && !hasTableHeader(filesSection, ['Path', 'Intent', 'Owner', 'Task'])) findings.push({ code: 'FILES_TABLE_INVALID', severity: 'error', artifactPath: artifact.path, message: 'The Files table must use Path | Intent(existing/new) | Owner | Task columns.' });
  if (verificationSection && !hasTableHeader(verificationSection, ['ID', 'Command', 'Cwd', 'Required'])) findings.push({ code: 'VERIFICATION_TABLE_INVALID', severity: 'error', artifactPath: artifact.path, message: 'The Verification table must use ID | Command | Cwd | Required columns.' });

  const declarations: FileDeclaration[] = [];
  const fileRows = tableRows(filesSection ?? '');
  if (filesSection && fileRows.length === 0) findings.push({ code: 'FILES_TABLE_EMPTY', severity: 'error', artifactPath: artifact.path, message: 'The Files table must declare at least one path.' });
  for (const cells of fileRows) {
    const [filePath, intentText, owner, taskId] = cells;
    const intent = intentText?.toLowerCase();
    if (!filePath || !owner || !taskId || !['existing', 'new'].includes(intent ?? '')) {
      findings.push({ code: 'INVALID_FILE_DECLARATION', severity: 'error', artifactPath: artifact.path, taskId, message: 'Each file row requires Path, Intent (existing/new), Owner, and Task.' });
      continue;
    }
    const resolved = containedPath(root, filePath);
    if (!resolved) {
      findings.push({ code: 'PATH_OUTSIDE_WORKSPACE', severity: 'error', artifactPath: artifact.path, taskId, message: `Declared path escapes the workspace: ${filePath}` });
      continue;
    }
    const normalizedPath = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/').toLowerCase();
    const declaration: FileDeclaration = { filePath, normalizedPath, intent: intent as FileDeclaration['intent'], owner, taskId };
    declarations.push(declaration);
    const exists = fs.existsSync(resolved);
    if (declaration.intent === 'existing' && !exists) {
      findings.push({ code: 'EXISTING_PATH_MISSING', severity: 'error', artifactPath: artifact.path, taskId, message: `Existing path was not found: ${filePath}` });
    }
    if (declaration.intent === 'new' && exists) {
      findings.push({ code: 'INTENDED_NEW_EXISTS', severity: 'error', artifactPath: artifact.path, taskId, message: `Path declared new already exists: ${filePath}` });
    }
  }

  for (let i = 0; i < declarations.length; i++) {
    for (let j = i + 1; j < declarations.length; j++) {
      const a = declarations[i];
      const b = declarations[j];
      const same = a.normalizedPath === b.normalizedPath;
      const overlaps = same || a.normalizedPath.startsWith(`${b.normalizedPath}/`) || b.normalizedPath.startsWith(`${a.normalizedPath}/`);
      if (!overlaps) continue;
      findings.push({ code: same ? 'AMBIGUOUS_PATH' : 'OVERLAPPING_OWNERSHIP', severity: 'error', artifactPath: artifact.path, taskId: b.taskId, message: `${same ? 'Duplicate declaration' : 'Overlapping write ownership'} for ${a.filePath} and ${b.filePath}.` });
      if (a.owner !== b.owner || a.taskId !== b.taskId) {
        findings.push({ code: 'OVERLAPPING_OWNERSHIP', severity: 'error', artifactPath: artifact.path, taskId: b.taskId, message: `Parallel tasks ${a.taskId} and ${b.taskId} overlap at ${a.filePath}.` });
      }
    }
  }

  const verificationRows = tableRows(verificationSection ?? '');
  if (verificationSection && verificationRows.length === 0) findings.push({ code: 'VERIFICATION_TABLE_EMPTY', severity: 'error', artifactPath: artifact.path, message: 'The Verification table must declare at least one check.' });
  for (const cells of verificationRows) {
    const [id, command, cwd, requiredText] = cells;
    const required = requiredText?.toLowerCase();
    if (!id || !['yes', 'no', 'true', 'false', 'required', 'optional'].includes(required ?? '')) {
      findings.push({ code: 'INVALID_VERIFICATION_DECLARATION', severity: 'error', artifactPath: artifact.path, message: 'Each verification row requires an ID and Required value (yes/no).'});
      continue;
    }
    const isRequired = ['yes', 'true', 'required'].includes(required!);
    if (!isRequired) continue;
    if (!command) findings.push({ code: 'VERIFICATION_COMMAND_MISSING', severity: 'error', artifactPath: artifact.path, taskId: id, message: `Required verification ${id} has no command.` });
    const cwdPath = cwd ? containedPath(root, cwd) : undefined;
    if (!cwdPath || !fs.existsSync(cwdPath) || !fs.statSync(cwdPath).isDirectory()) {
      findings.push({ code: 'VERIFICATION_CWD_MISSING', severity: 'error', artifactPath: artifact.path, taskId: id, message: `Required verification ${id} must name an existing workspace directory.` });
    }
  }

  const contextualFindings = addArtifactContext(findings, artifact);
  return { ok: contextualFindings.every((finding) => finding.severity !== 'error'), findings: contextualFindings, artifact };
}
