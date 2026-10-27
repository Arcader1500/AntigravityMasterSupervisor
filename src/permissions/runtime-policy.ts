import { evaluatePolicy, type PolicyAction, type PolicyConfig, type PolicyDecision } from '../core/policy.js';

export interface RuntimeCapabilities {
  transport: string;
  schemaVersion: number;
  exactActionBinding: boolean;
  orderedReplay: boolean;
  sessionIdentity: string;
}

export interface RuntimeBoundAction extends PolicyAction {
  arguments: string[];
}

export interface RuntimeActionBinding {
  runId: string;
  sessionId: string;
  eventId: string;
  action: RuntimeBoundAction;
}

export interface RuntimeActionRequest {
  runId: string;
  sessionId: string;
  eventId: string;
  sequence: number;
  action: RuntimeBoundAction;
  binding?: RuntimeActionBinding;
}

export interface RuntimePolicyAdapterOptions {
  capabilities: RuntimeCapabilities;
  stage0Qualified: boolean;
  config: PolicyConfig | null;
  workspaceRoot: string;
  runId: string;
}

export interface RuntimePolicyResult {
  outcome: PolicyDecision['outcome'];
  ruleId?: string;
  source: PolicyDecision['source'] | 'runtime';
  reason: string;
  status: 'evaluated' | 'manual';
  enforcement: 'disabled';
  runId?: string;
  sessionId?: string;
  eventId?: string;
}

export interface RuntimePolicyAdapter {
  evaluate(request: RuntimeActionRequest): RuntimePolicyResult;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function isBoundAction(value: unknown): value is RuntimeBoundAction {
  return value !== null && typeof value === 'object' &&
    typeof (value as RuntimeBoundAction).name === 'string' &&
    Array.isArray((value as RuntimeBoundAction).arguments) &&
    (value as RuntimeBoundAction).arguments.every((argument) => typeof argument === 'string') &&
    ((value as RuntimeBoundAction).path === undefined || typeof (value as RuntimeBoundAction).path === 'string');
}

function sameAction(left: RuntimeBoundAction, right: RuntimeBoundAction): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function manual(reason: string, request?: Partial<RuntimeActionRequest>): RuntimePolicyResult {
  return {
    outcome: 'escalate',
    source: 'runtime',
    reason,
    status: 'manual',
    enforcement: 'disabled',
    ...(request?.runId ? { runId: request.runId } : {}),
    ...(request?.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request?.eventId ? { eventId: request.eventId } : {}),
  };
}

/**
 * Fixture-only adapter for the unqualified runtime boundary. It can report a
 * policy evaluation for tests, but all results explicitly leave enforcement disabled.
 */
export function createFixtureRuntimePolicyAdapter(options: RuntimePolicyAdapterOptions): RuntimePolicyAdapter {
  const seenEventIds = new Set<string>();
  let lastSequence = -1;

  return {
    evaluate(request: RuntimeActionRequest): RuntimePolicyResult {
      if (!options.stage0Qualified) return manual('Stage 0 runtime qualification has not passed; keep permission handling manual.', request);

      const capabilities = options.capabilities;
      if (capabilities.transport !== 'fixture' || capabilities.schemaVersion !== 1 ||
          !capabilities.exactActionBinding || !capabilities.orderedReplay || !capabilities.sessionIdentity) {
        return manual('Runtime capability is unsupported or does not guarantee bound, ordered actions.', request);
      }
      if (!request || typeof request.runId !== 'string' || !request.runId ||
          typeof request.sessionId !== 'string' || !request.sessionId ||
          typeof request.eventId !== 'string' || !request.eventId ||
          !Number.isSafeInteger(request.sequence) || request.sequence < 0 || !isBoundAction(request.action)) {
        return manual('Runtime action identity or arguments are incomplete.', request);
      }
      if (seenEventIds.has(request.eventId)) return manual('Duplicate runtime action event; keep permission handling manual.', request);
      seenEventIds.add(request.eventId);
      if (request.sequence <= lastSequence) return manual('Stale or out-of-order runtime action; keep permission handling manual.', request);
      lastSequence = request.sequence;

      if (request.runId !== options.runId || request.sessionId !== capabilities.sessionIdentity) {
        return manual('Runtime action belongs to a stale run or unrecognized session.', request);
      }
      const binding = request.binding;
      if (!binding || binding.runId !== request.runId || binding.sessionId !== request.sessionId ||
          binding.eventId !== request.eventId || !isBoundAction(binding.action) || !sameAction(request.action, binding.action)) {
        return manual('Runtime action is not bound to its exact identity and arguments.', request);
      }

      const policy = evaluatePolicy(request.action, options.config, { workspaceRoot: options.workspaceRoot });
      return {
        ...policy,
        status: policy.outcome === 'escalate' ? 'manual' : 'evaluated',
        enforcement: 'disabled',
        runId: request.runId,
        sessionId: request.sessionId,
        eventId: request.eventId,
      };
    },
  };
}
