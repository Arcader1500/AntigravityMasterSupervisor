import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DecisionRecord } from './types.js';

const SECRET_ASSIGNMENT = /\b(token|secret|password|api[_-]?key|authorization)\b(\s*["']?\s*[:=]\s*["']?)([^\s,"';]+)/gi;
const SECRET_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]')
      .replace(SECRET_TOKEN, '[REDACTED]')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitize(nested)]));
  }
  return value;
}

function validateDecision(value: unknown, line?: number): DecisionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid decision record${line ? ` at line ${line}` : ''}`);
  }
  const record = value as Partial<DecisionRecord>;
  if (
    typeof record.id !== 'string' || !record.id ||
    typeof record.prompt !== 'string' ||
    (record.status !== 'answered' && record.status !== 'unresolved') ||
    (record.status === 'answered' && typeof record.answer !== 'string') ||
    !Array.isArray(record.evidenceRefs) || record.evidenceRefs.some((item) => typeof item !== 'string') ||
    !Array.isArray(record.assumptions) || record.assumptions.some((item) => typeof item !== 'string') ||
    typeof record.timestamp !== 'string'
  ) {
    throw new Error(`Invalid decision record${line ? ` at line ${line}` : ''}`);
  }
  return record as DecisionRecord;
}

/** Read validated append-only decision records. Missing logs are empty. */
export function readDecisionLog(logPath: string): DecisionRecord[] {
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, 'utf8');
  const records: DecisionRecord[] = [];
  const ids = new Set<string>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Malformed decision log at line ${index + 1}`);
    }
    const record = validateDecision(parsed, index + 1);
    if (ids.has(record.id)) throw new Error(`Duplicate decision ID at line ${index + 1}: ${record.id}`);
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

/** Append a decision without replacing prior decisions; duplicate IDs fail closed. */
export function appendDecision(logPath: string, input: DecisionRecord): DecisionRecord {
  const decision = validateDecision(sanitize(input));
  if (readDecisionLog(logPath).some((record) => record.id === decision.id)) {
    throw new Error(`Duplicate decision ID: ${decision.id}`);
  }
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const descriptor = fs.openSync(logPath, 'a');
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(decision)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return decision;
}
