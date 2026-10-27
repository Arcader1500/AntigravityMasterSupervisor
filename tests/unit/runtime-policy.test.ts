import { describe, expect, it } from 'vitest';
import {
  createFixtureRuntimePolicyAdapter,
  type RuntimeActionRequest,
  type RuntimeCapabilities,
} from '../../src/permissions/runtime-policy.js';
import type { PolicyConfig } from '../../src/core/policy.js';

const config: PolicyConfig = {
  version: 1,
  rules: [
    { id: 'allow-read', effect: 'allow', actions: ['read'] },
    { id: 'deny-write', effect: 'deny', actions: ['write'] },
    { id: 'escalate-shell', effect: 'escalate', actions: ['shell'] },
  ],
};

const capabilities: RuntimeCapabilities = {
  transport: 'fixture',
  schemaVersion: 1,
  exactActionBinding: true,
  orderedReplay: true,
  sessionIdentity: 'session-1',
};

function request(overrides: Partial<RuntimeActionRequest> = {}): RuntimeActionRequest {
  const action = { name: 'read', path: 'src/index.ts', arguments: ['src/index.ts'] };
  const value: RuntimeActionRequest = {
    runId: 'run-1',
    sessionId: 'session-1',
    eventId: 'event-1',
    sequence: 1,
    action,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'binding')) {
    value.binding = {
      runId: value.runId,
      sessionId: value.sessionId,
      eventId: value.eventId,
      action: value.action,
    };
  }
  return value;
}

describe('fixture runtime policy boundary', () => {
  it('evaluates an exactly bound action when a qualified capability is explicitly supplied', () => {
    const adapter = createFixtureRuntimePolicyAdapter({
      capabilities,
      stage0Qualified: true,
      config,
      workspaceRoot: process.cwd(),
      runId: 'run-1',
    });

    expect(adapter.evaluate(request())).toMatchObject({
      outcome: 'allow',
      ruleId: 'allow-read',
      status: 'evaluated',
      enforcement: 'disabled',
    });
  });

  it('preserves explicit denies and protected-path denies', () => {
    const adapter = createFixtureRuntimePolicyAdapter({
      capabilities,
      stage0Qualified: true,
      config,
      workspaceRoot: process.cwd(),
      runId: 'run-1',
    });

    expect(adapter.evaluate(request({
      eventId: 'event-2', sequence: 2,
      action: { name: 'write', path: 'src/output.ts', arguments: ['src/output.ts'] },
      binding: { runId: 'run-1', sessionId: 'session-1', eventId: 'event-2', action: { name: 'write', path: 'src/output.ts', arguments: ['src/output.ts'] } },
    })).outcome).toBe('deny');
    expect(adapter.evaluate(request({
      eventId: 'event-3', sequence: 3,
      action: { name: 'read', path: '.env.local', arguments: ['.env.local'] },
      binding: { runId: 'run-1', sessionId: 'session-1', eventId: 'event-3', action: { name: 'read', path: '.env.local', arguments: ['.env.local'] } },
    })).outcome).toBe('deny');
  });

  it('returns escalation for policy escalation and unknown actions', () => {
    const adapter = createFixtureRuntimePolicyAdapter({ capabilities, stage0Qualified: true, config, workspaceRoot: process.cwd(), runId: 'run-1' });
    const shell = { name: 'shell', arguments: ['echo', 'hi'] };
    const unknown = { name: 'unknown', arguments: [] };
    expect(adapter.evaluate(request({ eventId: 'event-2', sequence: 2, action: shell, binding: { runId: 'run-1', sessionId: 'session-1', eventId: 'event-2', action: shell } })).outcome).toBe('escalate');
    expect(adapter.evaluate(request({ eventId: 'event-3', sequence: 3, action: unknown, binding: { runId: 'run-1', sessionId: 'session-1', eventId: 'event-3', action: unknown } })).outcome).toBe('escalate');
  });

  it('escalates when the action binding is absent or arguments have changed', () => {
    const adapter = createFixtureRuntimePolicyAdapter({ capabilities, stage0Qualified: true, config, workspaceRoot: process.cwd(), runId: 'run-1' });
    expect(adapter.evaluate(request({ binding: undefined })).outcome).toBe('escalate');
    const changed = request({
      eventId: 'event-2', sequence: 2,
      binding: { runId: 'run-1', sessionId: 'session-1', eventId: 'event-2', action: { name: 'read', path: 'src/index.ts', arguments: ['src/other.ts'] } },
    });
    expect(adapter.evaluate(changed)).toMatchObject({ outcome: 'escalate', status: 'manual' });
  });

  it('escalates duplicate, stale, and out-of-order events', () => {
    const adapter = createFixtureRuntimePolicyAdapter({ capabilities, stage0Qualified: true, config, workspaceRoot: process.cwd(), runId: 'run-1' });
    expect(adapter.evaluate(request()).outcome).toBe('allow');
    expect(adapter.evaluate(request()).reason).toMatch(/duplicate/i);
    expect(adapter.evaluate(request({ eventId: 'event-2', sequence: 1 })).reason).toMatch(/stale|out.of.order/i);
    expect(adapter.evaluate(request({ eventId: 'event-3', sequence: 3 })).outcome).toBe('allow');
    expect(adapter.evaluate(request({ eventId: 'event-4', sequence: 2 })).reason).toMatch(/stale|out.of.order/i);
  });

  it('escalates a stale run or mismatched observed session identity', () => {
    const adapter = createFixtureRuntimePolicyAdapter({ capabilities, stage0Qualified: true, config, workspaceRoot: process.cwd(), runId: 'run-1' });
    expect(adapter.evaluate(request({ runId: 'run-old' })).outcome).toBe('escalate');
    expect(adapter.evaluate(request({ eventId: 'event-2', sequence: 2, sessionId: 'session-old' })).outcome).toBe('escalate');
  });

  it('fails closed for unsupported capabilities', () => {
    const adapter = createFixtureRuntimePolicyAdapter({
      capabilities: { ...capabilities, transport: 'unknown', exactActionBinding: false },
      stage0Qualified: true,
      config,
      workspaceRoot: process.cwd(),
      runId: 'run-1',
    });
    expect(adapter.evaluate(request())).toMatchObject({ outcome: 'escalate', status: 'manual', enforcement: 'disabled' });
  });

  it('keeps decisions manual while the Stage 0 gate is disabled', () => {
    const adapter = createFixtureRuntimePolicyAdapter({ capabilities, stage0Qualified: false, config, workspaceRoot: process.cwd(), runId: 'run-1' });
    expect(adapter.evaluate(request())).toMatchObject({
      outcome: 'escalate',
      status: 'manual',
      enforcement: 'disabled',
      reason: expect.stringMatching(/stage 0/i),
    });
  });
});
