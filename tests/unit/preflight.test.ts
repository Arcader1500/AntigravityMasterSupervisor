import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPreflight } from '../../src/core/preflight.js';

describe('runPreflight', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-preflight-')); });

  function writePlan(files: string, verification = '| ID | Command | Cwd | Required |\n|---|---|---|---|\n| tests | node --test | . | yes |'): string {
    const plan = path.join(root, 'plan.md');
    fs.writeFileSync(plan, `# Plan\n\n## Execution metadata\n\n### Files\n| Path | Intent | Owner | Task |\n|---|---|---|---|\n${files}\n\n### Verification\n${verification}\n`);
    return plan;
  }

  it('accepts declared existing and intended-new paths with valid verification prerequisites', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'old.ts'), '');
    const plan = writePlan('| src/old.ts | existing | A | T1 |\n| src/new.ts | new | B | T2 |');
    const result = runPreflight(plan, root);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('reports missing declarations and intended-new paths that already exist', () => {
    fs.writeFileSync(path.join(root, 'already.ts'), '');
    const plan = writePlan('| already.ts | new | A | T1 |');
    const result = runPreflight(plan, root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain('INTENDED_NEW_EXISTS');
    expect(result.findings.every((f) => f.artifactRevision === result.artifact?.revision)).toBe(true);
  });

  it('rejects an existing path declaration when the file is absent', () => {
    const plan = writePlan('| src/missing.ts | existing | A | T1 |');
    const result = runPreflight(plan, root);
    expect(result.findings.map((f) => f.code)).toContain('EXISTING_PATH_MISSING');
  });

  it('requires both exact metadata tables', () => {
    const plan = path.join(root, 'plan.md');
    fs.writeFileSync(plan, '# Plan\n\n## Execution metadata\n\n### Verification\n| ID | Command | Cwd | Required |\n|---|---|---|---|\n| test | node --test | . | yes |');
    const result = runPreflight(plan, root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain('FILES_TABLE_MISSING');
  });

  it('rejects traversal and absolute paths outside the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-outside-'));
    const plan = writePlan(`| ../outside/file.ts | new | A | T1 |\n| ${path.join(outside, 'file.ts')} | existing | B | T2 |`);
    const result = runPreflight(plan, root);
    expect(result.ok).toBe(false);
    expect(result.findings.filter((f) => f.code === 'PATH_OUTSIDE_WORKSPACE')).toHaveLength(2);
  });

  it('reports duplicate declarations as ambiguous and overlapping task ownership', () => {
    const plan = writePlan('| src/shared.ts | new | A | T1 |\n| src/shared.ts | new | B | T2 |');
    const result = runPreflight(plan, root);
    expect(result.findings.map((f) => f.code)).toContain('AMBIGUOUS_PATH');
    expect(result.findings.map((f) => f.code)).toContain('OVERLAPPING_OWNERSHIP');
  });

  it('accepts disjoint task write ownership', () => {
    const plan = writePlan('| src/first.ts | new | A | T1 |\n| src/second.ts | new | B | T2 |');
    expect(runPreflight(plan, root).findings).toEqual([]);
  });

  it('reports missing verification prerequisites and does not execute commands', () => {
    const marker = path.join(root, 'ran');
    const plan = writePlan('| safe.ts | new | A | T1 |', `| ID | Command | Cwd | Required |\n|---|---|---|---|\n| verify | node -e "require('fs').writeFileSync('${marker}', 'yes')" | missing | yes |`);
    const result = runPreflight(plan, root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain('VERIFICATION_CWD_MISSING');
    expect(fs.existsSync(marker)).toBe(false);
  });
});
