import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactRef, hasArtifactRevisionChanged } from '../../src/core/artifact-revisions.js';

describe('artifact revisions', () => {
  it('hashes content rather than modification time and reports changed revisions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-revisions-'));
    const file = path.join(root, 'spec.md');
    fs.writeFileSync(file, 'first');
    const first = createArtifactRef('spec', file, root);
    const mtime = fs.statSync(file).mtime;

    fs.writeFileSync(file, 'other');
    fs.utimesSync(file, mtime, mtime);
    const second = createArtifactRef('spec', file, root);

    expect(second.revision).not.toBe(first.revision);
    expect(hasArtifactRevisionChanged(first, second)).toBe(true);
    expect(hasArtifactRevisionChanged(first, { ...first, selectedAt: 'later' })).toBe(false);
  });

  it('rejects missing artifacts and paths outside the selected workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-revisions-'));
    expect(() => createArtifactRef('plan', path.join(root, 'missing.md'), root)).toThrow(/exist/i);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-outside-'));
    fs.writeFileSync(path.join(outside, 'plan.md'), 'plan');
    expect(() => createArtifactRef('plan', path.join(outside, 'plan.md'), root)).toThrow(/workspace/i);
  });
});
