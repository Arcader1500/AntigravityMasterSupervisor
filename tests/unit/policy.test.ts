import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { evaluatePolicy, loadPolicyConfig } from '../../src/core/policy.js';

describe('project policy', () => {
  let root = '';

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function project(config?: unknown) {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-policy-'));
    if (config !== undefined) {
      fs.mkdirSync(path.join(root, '.agy'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agy', 'config.json'), JSON.stringify(config));
    }
    return root;
  }

  it('escalates when project config is missing', () => {
    const loaded = loadPolicyConfig(project());
    expect(loaded.source).toBe('default');
    expect(evaluatePolicy({ name: 'shell', path: 'src/index.ts' }, loaded.config, { workspaceRoot: root }).outcome).toBe('escalate');
  });

  it('fails closed for malformed policy and unknown fields', () => {
    const malformed = loadPolicyConfig(project({ supervisor: { policy: { version: 2, rules: [] } } }));
    expect(malformed.error).toBeDefined();
    expect(evaluatePolicy({ name: 'shell' }, malformed.config, { workspaceRoot: root }).outcome).toBe('escalate');

    const unknownField = loadPolicyConfig(project({ supervisor: { policy: { version: 1, rules: [], allowAll: true } } }));
    expect(unknownField.error).toBeDefined();

    const invalidJsonRoot = project();
    fs.mkdirSync(path.join(invalidJsonRoot, '.agy'), { recursive: true });
    fs.writeFileSync(path.join(invalidJsonRoot, '.agy', 'config.json'), '{');
    expect(loadPolicyConfig(invalidJsonRoot).source).toBe('invalid');
  });

  it('selects matching rules deterministically and explicit deny wins', () => {
    const loaded = loadPolicyConfig(project({ supervisor: { policy: { version: 1, rules: [
      { id: 'allow-z', effect: 'allow', actions: ['shell'], paths: ['src/**'] },
      { id: 'allow-shell', effect: 'allow', actions: ['shell'], paths: ['src/**'] },
      { id: 'deny-shell', effect: 'deny', actions: ['shell'], paths: ['src/secret.ts'] },
    ] } } }));
    const context = { workspaceRoot: root };
    expect(evaluatePolicy({ name: 'shell', path: 'src/index.ts' }, loaded.config, context)).toMatchObject({ outcome: 'allow', ruleId: 'allow-shell', source: 'project' });
    expect(evaluatePolicy({ name: 'shell', path: 'src/secret.ts' }, loaded.config, context)).toMatchObject({ outcome: 'deny', ruleId: 'deny-shell', source: 'project' });
  });

  it.each(['.env', '.env.local', 'nested/.ENV.production'])('does not allow protected path %s', (protectedPath) => {
    const loaded = loadPolicyConfig(project({ supervisor: { policy: { version: 1, rules: [
      { id: 'allow-write', effect: 'allow', actions: ['write'], paths: ['**'] },
    ] } } }));
    expect(evaluatePolicy({ name: 'write', path: protectedPath }, loaded.config, { workspaceRoot: root })).toMatchObject({ outcome: 'deny', source: 'builtin' });
  });

  it('escalates unknown actions and reports policy source and effective rules', () => {
    const loaded = loadPolicyConfig(project({ supervisor: { policy: { version: 1, rules: [
      { id: 'known', effect: 'allow', actions: ['read'] },
    ] } } }));
    expect(loaded.source).toBe('project');
    expect(evaluatePolicy({ name: 'unknown' }, loaded.config, { workspaceRoot: root })).toMatchObject({ outcome: 'escalate', source: 'default' });
    expect(loaded.config?.rules).toHaveLength(1);
  });

  it('never applies project allows to paths outside the workspace', () => {
    const loaded = loadPolicyConfig(project({ supervisor: { policy: { version: 1, rules: [
      { id: 'allow-all', effect: 'allow', actions: ['write'], paths: ['**'] },
    ] } } }));
    expect(evaluatePolicy({ name: 'write', path: '../outside.txt' }, loaded.config, { workspaceRoot: root })).toMatchObject({ outcome: 'escalate', source: 'default' });
  });
});
