import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendDecision } from '../../src/core/decision-log.js';
import { createWorkflowState, loadLedger } from '../../src/core/ledger.js';
import { runPreflight } from '../../src/core/preflight.js';
import { createJournalReader } from '../../src/core/event-journal.js';
import {
  applyWorkflowAction,
  markHandoffStarting,
  recordCancellationResult,
  recordHandoffOutcome,
  recordPlanReadiness,
  selectWorkflowArtifacts,
  type WorkflowAction,
} from '../../src/core/workflow.js';

describe('workflow lifecycle', () => {
  let root: string;
  const runId = 'run-one';
  const idempotencyKey = 'handoff-one';
  let specPath: string;
  let planPath: string;
  const validPlan = '# Plan\n\n## Execution metadata\n\n### Files\n| Path | Intent | Owner | Task |\n|---|---|---|---|\n| generated.ts | new | A | B1 |\n\n### Verification\n| ID | Command | Cwd | Required |\n|---|---|---|---|\n| unit | node --version | . | yes |\n';

  function setup(): void {
    createWorkflowState(root, 'Original request', { runId });
    specPath = path.join(root, 'spec.md');
    planPath = path.join(root, 'plan.md');
    fs.writeFileSync(specPath, '# Approved scope\n');
    fs.writeFileSync(planPath, validPlan);
    selectWorkflowArtifacts(root, runId, 'spec.md', 'plan.md');
  }

  function approveSpec(): void {
    const workflow = loadLedger(root).workflow!;
    const action: WorkflowAction = {
      type: 'approveSpec', runId,
      artifact: { path: workflow.spec!.path, revision: workflow.spec!.revision },
    };
    applyWorkflowAction(root, action);
  }

  function readyPlan(): void {
    const workflow = loadLedger(root).workflow!;
    recordPlanReadiness(root, runId, { planRevision: workflow.plan!.revision, criticVerdict: 'READY', preflight: runPreflight(workflow.plan!, root) });
  }

  function authorize(key = idempotencyKey) {
    return applyWorkflowAction(root, { type: 'authorizeHandoff', runId, idempotencyKey: key });
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(process.cwd(), 'tests', 'fixtures', 'workflow-'));
    setup();
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('requires spec approval, critic READY, preflight, and explicit authorization in order', () => {
    readyPlan();
    expect(() => authorize()).toThrow(/spec.*approval/i);
    approveSpec();
    fs.writeFileSync(planPath, '# Invalid plan\n');
    selectWorkflowArtifacts(root, runId, 'spec.md', 'plan.md');
    const failedPreflight = runPreflight(loadLedger(root).workflow!.plan!, root);
    recordPlanReadiness(root, runId, { planRevision: loadLedger(root).workflow!.plan!.revision, criticVerdict: 'READY', preflight: failedPreflight });
    expect(() => authorize()).toThrow(/preflight/i);
    fs.writeFileSync(planPath, validPlan);
    selectWorkflowArtifacts(root, runId, 'spec.md', 'plan.md');
    readyPlan();
    expect(loadLedger(root).workflow?.handoff).toBeUndefined();
    expect(authorize().handoff?.status).toBe('prepared');
  });

  it('keeps critic readiness distinct from authorization and blocks non-READY plans', () => {
    approveSpec();
    recordPlanReadiness(root, runId, { planRevision: loadLedger(root).workflow!.plan!.revision, criticVerdict: 'NOT_READY', preflight: runPreflight(loadLedger(root).workflow!.plan!, root) });
    expect(() => authorize()).toThrow(/ready/i);
    expect(loadLedger(root).workflow?.handoff).toBeUndefined();
  });

  it('rejects stale run IDs and non-selected or stale spec path/revisions', () => {
    const selected = loadLedger(root).workflow!.spec!;
    expect(() => applyWorkflowAction(root, { type: 'approveSpec', runId: 'other-run', artifact: selected })).toThrow(/stale.*run/i);
    expect(() => applyWorkflowAction(root, { type: 'approveSpec', runId, artifact: { ...selected, path: 'other.md' } })).toThrow(/selected/i);
    expect(() => applyWorkflowAction(root, { type: 'approveSpec', runId, artifact: { ...selected, revision: '0'.repeat(64) } })).toThrow(/revision/i);
    fs.writeFileSync(specPath, '# Changed\n');
    expect(() => applyWorkflowAction(root, { type: 'approveSpec', runId, artifact: selected })).toThrow(/changed|stale/i);
  });

  it('invalidates only the changed artifact approval when selections change', () => {
    approveSpec();
    const before = loadLedger(root).workflow!;
    fs.writeFileSync(planPath, '# Updated plan\n');
    selectWorkflowArtifacts(root, runId, 'spec.md', 'plan.md');
    const after = loadLedger(root).workflow!;
    expect(after.approvals).toEqual(before.approvals);
    expect(after.plan?.revision).not.toBe(before.plan?.revision);
    expect(() => authorize()).toThrow(/ready/i);
  });

  it('requires unresolved decisions to be explicitly accepted before handoff', () => {
    const workflow = loadLedger(root).workflow!;
    appendDecision(path.join(root, workflow.decisionsPath), {
      id: 'decision-1', prompt: 'Need a choice', status: 'unresolved', evidenceRefs: [], assumptions: [], timestamp: new Date().toISOString(),
    });
    approveSpec();
    readyPlan();
    expect(() => authorize()).toThrow(/unresolved/i);
    applyWorkflowAction(root, { type: 'acceptUnresolved', runId, decisionIds: ['decision-1'] });
    expect(authorize().handoff?.status).toBe('prepared');
  });

  it('rejects unknown decisions when accepting unresolved items', () => {
    expect(() => applyWorkflowAction(root, { type: 'acceptUnresolved', runId, decisionIds: ['missing'] })).toThrow(/unresolved decision/i);
  });

  it('preserves the original request identity and appends approval and handoff audit evidence', () => {
    const workflow = loadLedger(root).workflow!;
    const requestPath = path.join(root, workflow.originalRequest.path);
    fs.writeFileSync(requestPath, 'substituted request');
    expect(() => applyWorkflowAction(root, { type: 'approveSpec', runId, artifact: { path: workflow.spec!.path, revision: workflow.spec!.revision } })).not.toThrow();
    readyPlan();
    expect(() => authorize()).toThrow(/original request snapshot identity/i);
    fs.writeFileSync(requestPath, 'Original request');
    authorize();
    const events = loadLedger(root).events.filter((event) => event.metadata?.workflowEvent);
    expect(events.map((event) => event.metadata?.workflowEvent)).toContain('spec_approved');
    expect(events.map((event) => event.metadata?.workflowEvent)).toContain('handoff_prepared');
  });

  it('retains old approval history while requiring approval for a changed spec revision', () => {
    approveSpec();
    fs.writeFileSync(specPath, '# Revised scope\n');
    selectWorkflowArtifacts(root, runId, 'spec.md', 'plan.md');
    expect(loadLedger(root).workflow?.approvals).toHaveLength(1);
    expect(() => authorize()).toThrow(/approval/i);
    approveSpec();
    expect(loadLedger(root).workflow?.approvals).toHaveLength(2);
  });

  it('makes authorization idempotent and reconciles uncertain retries without another handoff', () => {
    approveSpec();
    readyPlan();
    const first = authorize();
    const retry = authorize();
    expect(retry.handoff?.idempotencyKey).toBe(first.handoff?.idempotencyKey);
    markHandoffStarting(root, runId, idempotencyKey);
    recordHandoffOutcome(root, runId, idempotencyKey, 'unknown');
    expect(() => authorize('new-key')).toThrow(/uncertain|idempotency/i);
    expect(applyWorkflowAction(root, { type: 'recover', runId, idempotencyKey }).handoff?.status).toBe('unknown');
  });

  it('cancels before launch and suppresses starting work', () => {
    approveSpec();
    readyPlan();
    authorize();
    applyWorkflowAction(root, { type: 'cancel', runId, idempotencyKey, reason: 'user request' });
    expect(loadLedger(root).workflow?.handoff?.status).toBe('cancelled');
    expect(loadLedger(root).workflow?.handoff?.cancellationResult?.result).toBe('not-started');
    expect(() => markHandoffStarting(root, runId, idempotencyKey)).toThrow(/cancel/i);
  });

  it('marks uncertain launch cancellation pending and makes repeated cancel idempotent', () => {
    approveSpec();
    readyPlan();
    authorize();
    markHandoffStarting(root, runId, idempotencyKey);
    recordHandoffOutcome(root, runId, idempotencyKey, 'unknown');
    applyWorkflowAction(root, { type: 'cancel', runId, idempotencyKey });
    const first = loadLedger(root).workflow?.handoff;
    applyWorkflowAction(root, { type: 'cancel', runId, idempotencyKey });
    expect(loadLedger(root).workflow?.handoff).toEqual(first);
    expect(first?.status).toBe('cancelPending');
  });

  it('records late launch outcomes without reviving a cancelled workflow', () => {
    approveSpec();
    readyPlan();
    authorize();
    markHandoffStarting(root, runId, idempotencyKey);
    applyWorkflowAction(root, { type: 'cancel', runId, idempotencyKey });
    recordHandoffOutcome(root, runId, idempotencyKey, 'started', { pid: 42, sessionId: 'session-1' });
    expect(loadLedger(root).workflow?.handoff?.status).toBe('cancelPending');
    expect(loadLedger(root).workflow?.handoff?.process?.pid).toBe(42);
    const journal = createJournalReader(path.join(root, loadLedger(root).workflow!.journalPath)).read();
    expect(journal.events.map((event) => event.kind)).toContain('workflow.handoff_outcome');
    expect(journal.events.at(-1)?.payload).toMatchObject({ reportedStatus: 'started', effectiveStatus: 'cancelPending' });
    expect(journal.errors).toEqual([]);
    recordCancellationResult(root, runId, idempotencyKey, 'terminated');
    expect(loadLedger(root).workflow?.handoff?.status).toBe('cancelled');
    expect(loadLedger(root).workflow?.handoff?.cancellationResult?.result).toBe('terminated');
  });

  it('cancellation of a prepared handoff prevents later launch events from advancing gates', () => {
    approveSpec();
    readyPlan();
    authorize();
    applyWorkflowAction(root, { type: 'cancel', runId, idempotencyKey });
    recordHandoffOutcome(root, runId, idempotencyKey, 'started', { pid: 8 });
    expect(loadLedger(root).workflow?.handoff?.status).toBe('cancelled');
  });
});
