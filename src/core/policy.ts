import * as fs from 'node:fs';
import * as path from 'node:path';

export type PolicyEffect = 'allow' | 'deny' | 'escalate';

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  actions: string[];
  paths?: string[];
}

export interface PolicyConfig {
  version: 1;
  rules: PolicyRule[];
}

export interface PolicyAction {
  name: string;
  path?: string;
}

export interface PolicyContext {
  workspaceRoot: string;
}

export interface PolicyDecision {
  outcome: PolicyEffect;
  ruleId?: string;
  source: 'builtin' | 'project' | 'default';
  reason: string;
}

export interface LoadedPolicy {
  config: PolicyConfig | null;
  source: 'project' | 'default' | 'invalid';
  error?: string;
}

const emptyConfig: PolicyConfig = { version: 1, rules: [] };
const effects = new Set<PolicyEffect>(['allow', 'deny', 'escalate']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validatePolicy(value: unknown): PolicyConfig {
  if (!isObject(value) || !hasOnlyKeys(value, ['version', 'rules']) || value.version !== 1 || !Array.isArray(value.rules)) {
    throw new Error('supervisor.policy must contain only version: 1 and a rules array');
  }

  const ids = new Set<string>();
  const rules = value.rules.map((candidate, index): PolicyRule => {
    if (!isObject(candidate) || !hasOnlyKeys(candidate, ['id', 'effect', 'actions', 'paths'])) {
      throw new Error(`supervisor.policy.rules[${index}] contains unknown fields or is not an object`);
    }
    const { id, effect, actions, paths } = candidate;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) {
      throw new Error(`supervisor.policy.rules[${index}].id must be a unique non-empty string`);
    }
    if (typeof effect !== 'string' || !effects.has(effect as PolicyEffect)) {
      throw new Error(`supervisor.policy.rules[${index}].effect is unsupported`);
    }
    if (!Array.isArray(actions) || actions.length === 0 || !actions.every((action) => typeof action === 'string' && action.trim())) {
      throw new Error(`supervisor.policy.rules[${index}].actions must be a non-empty string array`);
    }
    if (paths !== undefined && (!Array.isArray(paths) || !paths.every((item) => typeof item === 'string' && validPathPattern(item)))) {
      throw new Error(`supervisor.policy.rules[${index}].paths must contain workspace-relative path patterns`);
    }
    ids.add(id);
    return { id, effect: effect as PolicyEffect, actions: [...actions] as string[], ...(paths ? { paths: [...paths] as string[] } : {}) };
  });

  return { version: 1, rules };
}

function validPathPattern(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return value.length > 0 && !path.posix.isAbsolute(normalized) && !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split('/').includes('..') && !normalized.split('/').includes('');
}

/** Read only the project-owned .agy/config.json supervisor.policy section. */
export function loadPolicyConfig(workspaceRoot: string): LoadedPolicy {
  const configPath = path.join(path.resolve(workspaceRoot), '.agy', 'config.json');
  if (!fs.existsSync(configPath)) return { config: emptyConfig, source: 'default' };

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!isObject(parsed)) throw new Error('project config must be a JSON object');
    const supervisor = parsed.supervisor;
    if (supervisor === undefined) return { config: emptyConfig, source: 'default' };
    if (!isObject(supervisor)) throw new Error('supervisor must be an object');
    if (supervisor.policy === undefined) return { config: emptyConfig, source: 'default' };
    return { config: validatePolicy(supervisor.policy), source: 'project' };
  } catch (error) {
    return {
      config: null,
      source: 'invalid',
      error: error instanceof Error ? error.message : 'project policy could not be read',
    };
  }
}

function pathMatches(pattern: string, candidate: string): boolean {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (char === '*') {
      expression += '[^/]*';
    } else {
      expression += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'i').test(candidate);
}

function relativeActionPath(actionPath: string, workspaceRoot: string): string | null {
  const root = path.resolve(workspaceRoot);
  const absolute = path.resolve(root, actionPath);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  return relative;
}

export function evaluatePolicy(action: PolicyAction, config: PolicyConfig | null, context: PolicyContext): PolicyDecision {
  if (!action || typeof action.name !== 'string' || !action.name.trim()) {
    return { outcome: 'escalate', source: 'default', reason: 'action identity is missing or invalid' };
  }
  if (!context || typeof context.workspaceRoot !== 'string' || !context.workspaceRoot.trim()) {
    return { outcome: 'escalate', source: 'default', reason: 'project workspace identity is missing or invalid' };
  }

  let relativePath: string | undefined;
  if (action.path !== undefined) {
    relativePath = relativeActionPath(action.path, context.workspaceRoot) ?? undefined;
    if (!relativePath) return { outcome: 'escalate', source: 'default', reason: 'action path is outside the project workspace' };
    if (relativePath.split('/').some((part) => part.toLowerCase().startsWith('.env'))) {
      return { outcome: 'deny', source: 'builtin', reason: 'protected .env* paths are always denied' };
    }
  }

  if (!config) return { outcome: 'escalate', source: 'default', reason: 'project policy is invalid or unavailable' };

  const matches = config.rules.filter((rule) => rule.actions.includes(action.name) &&
    (rule.paths === undefined || (relativePath !== undefined && rule.paths.some((pattern) => pathMatches(pattern.replaceAll('\\', '/'), relativePath!)))));
  matches.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const selected = matches.find((rule) => rule.effect === 'deny') ??
    matches.find((rule) => rule.effect === 'escalate') ??
    matches.find((rule) => rule.effect === 'allow');

  if (!selected) return { outcome: 'escalate', source: 'default', reason: 'no project rule matches this action' };
  return {
    outcome: selected.effect,
    ruleId: selected.id,
    source: 'project',
    reason: `matched project policy rule ${selected.id}`,
  };
}
