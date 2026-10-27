import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendDecision, readDecisionLog } from '../../src/core/decision-log.js';

describe('durable decision log', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('appends decisions and preserves supersession history', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-decisions-'));
    roots.push(root);
    const logPath = path.join(root, 'decisions.jsonl');

    const first = appendDecision(logPath, {
      id: 'decision-1', prompt: 'Which package manager?', answer: 'npm', status: 'answered',
      evidenceRefs: ['spec.md#tooling'], assumptions: ['npm is already installed'], timestamp: '2026-01-01T00:00:00.000Z',
    });
    appendDecision(logPath, {
      id: 'decision-2', prompt: 'Which package manager?', answer: 'pnpm', status: 'answered',
      evidenceRefs: ['user clarification'], assumptions: [], timestamp: '2026-01-02T00:00:00.000Z', supersedes: first.id,
    });
    appendDecision(logPath, {
      id: 'decision-3', prompt: 'Which tests remain?', status: 'unresolved', evidenceRefs: [],
      assumptions: ['Stage 0 gate remains open'], timestamp: '2026-01-03T00:00:00.000Z',
    });

    expect(readDecisionLog(logPath)).toHaveLength(3);
    expect(readDecisionLog(logPath)[0]).toMatchObject({ id: 'decision-1', answer: 'npm' });
    expect(readDecisionLog(logPath)[1]).toMatchObject({ id: 'decision-2', supersedes: 'decision-1' });
    expect(readDecisionLog(logPath)[2]).toMatchObject({ id: 'decision-3', status: 'unresolved' });
    expect(fs.readFileSync(logPath, 'utf-8').trim().split(/\r?\n/)).toHaveLength(3);
  });

  it('rejects duplicate IDs without changing append-only history', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-decisions-'));
    roots.push(root);
    const logPath = path.join(root, 'decisions.jsonl');
    const decision = {
      id: 'same-id', prompt: 'Question', status: 'unresolved' as const, evidenceRefs: [], assumptions: [], timestamp: '2026-01-01T00:00:00.000Z',
    };
    appendDecision(logPath, decision);

    expect(() => appendDecision(logPath, decision)).toThrow(/duplicate/i);
    expect(readDecisionLog(logPath)).toHaveLength(1);
  });

  it('redacts secret-like values before persistence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-decisions-'));
    roots.push(root);
    const logPath = path.join(root, 'decisions.jsonl');
    appendDecision(logPath, {
      id: 'secret-answer', prompt: 'Token?', answer: 'ghp_123456789012345678901234567890123456', status: 'answered',
      evidenceRefs: [], assumptions: [], timestamp: '2026-01-01T00:00:00.000Z',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('ghp_123456789012345678901234567890123456');
    expect(readDecisionLog(logPath)[0].answer).toContain('[REDACTED]');
  });
});
