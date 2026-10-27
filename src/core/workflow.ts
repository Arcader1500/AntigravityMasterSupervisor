import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArtifactRef, HandoffStatus, WorkflowState } from './types.js';
import { appendLedgerEvent, loadLedger, updateLedger } from './ledger.js';
import { readDecisionLog } from './decision-log.js';
import { createJournalReader, createJournalWriter } from './event-journal.js';
import { createArtifactRef } from './artifact-revisions.js';
import { runPreflight, type PreflightResult } from './preflight.js';

export type WorkflowAction =
  | { type: 'approveSpec'; runId: string; artifact: { path: string; revision: string } }
  | { type: 'authorizeHandoff'; runId: string; idempotencyKey: string }
  | { type: 'acceptUnresolved'; runId: string; decisionIds: string[] }
  | { type: 'cancel'; runId: string; idempotencyKey: string; reason?: string }
  | { type: 'recover'; runId: string; idempotencyKey: string };

export interface WorkflowActionResult {
  workflow: WorkflowState;
  handoff?: WorkflowState['handoff'];
}

export interface PlanReadiness {
  planRevision: string;
  criticVerdict: string;
  preflight: PreflightResult;
}

function requireWorkflow(projectDir: string, runId: string): WorkflowState {
  const workflow = loadLedger(projectDir).workflow;
  if (!workflow) throw new Error('No workflow state is initialized.');
  if (workflow.runId !== runId) throw new Error(`Stale workflow run ID: expected ${workflow.runId}.`);
  return workflow;
}

function currentArtifact(workflow: WorkflowState, selected: ArtifactRef): ArtifactRef {
  const actual = createArtifactRef(selected.kind, selected.path, workflow.workspaceRoot);
  if (actual.revision !== selected.revision) throw new Error(`Selected ${selected.kind} artifact changed since selection.`);
  return actual;
}

function validateOriginalRequest(projectDir: string, workflow: WorkflowState): void {
  const requestPath = path.resolve(projectDir, workflow.originalRequest.path);
  const relative = path.relative(path.resolve(projectDir), requestPath);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Original request snapshot escapes the workspace.');
  }
  const root = fs.realpathSync(projectDir);
  const actualPath = fs.realpathSync(requestPath);
  const actualRelative = path.relative(root, actualPath);
  if (fs.lstatSync(requestPath).isSymbolicLink() || actualRelative.startsWith(`..${path.sep}`) || actualRelative === '..' || path.isAbsolute(actualRelative)) {
    throw new Error('Original request snapshot resolves outside the workspace.');
  }
  const revision = createHash('sha256').update(fs.readFileSync(requestPath)).digest('hex');
  if (revision !== workflow.originalRequest.revision) throw new Error('Original request snapshot identity does not match this run.');
}

function workflowEvents(projectDir: string): Array<{ timestamp: string; metadata?: Record<string, unknown> }> {
  return loadLedger(projectDir).events;
}

function latestEvent(projectDir: string, type: string, predicate: (metadata: Record<string, unknown>) => boolean): { timestamp: string; metadata?: Record<string, unknown> } | undefined {
  return workflowEvents(projectDir).filter((event) => event.metadata?.workflowEvent === type && predicate(event.metadata)).at(-1);
}

function appendWorkflowEvent(projectDir: string, type: string, runId: string, fields: Record<string, unknown> = {}): void {
  const workflow = requireWorkflow(projectDir, runId);
  const journalPath = path.resolve(projectDir, workflow.journalPath);
  const relative = path.relative(path.resolve(projectDir), journalPath);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Workflow journal path escapes the workspace.');
  const journal = createJournalReader(journalPath).read();
  if (journal.errors.some((issue) => issue.code !== 'missing-file') || journal.duplicates.length || journal.outOfOrder.length) {
    throw new Error('Workflow journal is not trustworthy; refusing to append lifecycle state.');
  }
  const previous = [...journal.events].reverse().find((event) => event.runId === runId && event.sessionId === 'supervisor-workflow' && event.source === 'supervisor-workflow');
  createJournalWriter(journalPath).append({
    schemaVersion: 1,
    runId,
    sessionId: 'supervisor-workflow',
    source: 'supervisor-workflow',
    sequence: (previous?.sequence ?? -1) + 1,
    receivedAt: new Date().toISOString(),
    kind: `workflow.${type}`,
    payload: fields,
    eventId: randomUUID(),
  });
  appendLedgerEvent(projectDir, 'INFO', `Workflow ${type}`, { workflowEvent: type, runId, ...fields });
}

function sameArtifact(a: ArtifactRef | undefined, b: ArtifactRef | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.path === b.path && a.revision === b.revision;
}

function requireHandoff(workflow: WorkflowState, key: string) {
  const handoff = workflow.handoff;
  if (!handoff) throw new Error('No handoff has been authorized.');
  if (handoff.idempotencyKey !== key) throw new Error('Handoff idempotency key does not match the active attempt.');
  return handoff;
}

function acceptedUnresolved(projectDir: string, runId: string): Set<string> {
  const accepted = new Set<string>();
  for (const event of workflowEvents(projectDir)) {
    const metadata = event.metadata;
    if (metadata?.workflowEvent === 'unresolved_accepted' && metadata.runId === runId && Array.isArray(metadata.decisionIds)) {
      for (const id of metadata.decisionIds) if (typeof id === 'string') accepted.add(id);
    }
  }
  return accepted;
}

function ensureReady(projectDir: string, workflow: WorkflowState): void {
  if (!workflow.spec || !workflow.plan) throw new Error('Selected spec and plan are required before handoff.');
  currentArtifact(workflow, workflow.spec);
  currentArtifact(workflow, workflow.plan);

  const approved = latestEvent(projectDir, 'spec_approved', (metadata) =>
    metadata.runId === workflow.runId && metadata.path === workflow.spec!.path && metadata.revision === workflow.spec!.revision);
  const selected = latestEvent(projectDir, 'artifact_selected', (metadata) => metadata.runId === workflow.runId && metadata.kind === 'spec');
  if (!approved || !selected || approved.timestamp < selected.timestamp) throw new Error('Current spec revision requires user approval.');

  const ready = latestEvent(projectDir, 'plan_readiness', (metadata) =>
    metadata.runId === workflow.runId && metadata.planPath === workflow.plan!.path && metadata.planRevision === workflow.plan!.revision);
  if (!ready || ready.metadata?.criticVerdict !== 'READY') throw new Error('The current plan does not have critic READY evidence.');
  if (ready.metadata?.preflightOk !== true) throw new Error('Plan preflight must pass before handoff.');
  if (!runPreflight(workflow.plan, workflow.workspaceRoot).ok) throw new Error('Current plan preflight no longer passes.');

  const decisionPath = path.resolve(projectDir, workflow.decisionsPath);
  const decisions = readDecisionLog(decisionPath);
  const unresolved = decisions.filter((decision) => decision.status === 'unresolved');
  const accepted = acceptedUnresolved(projectDir, workflow.runId);
  const missing = unresolved.filter((decision) => !accepted.has(decision.id));
  if (missing.length) throw new Error(`Unresolved decisions must be accepted before handoff: ${missing.map((item) => item.id).join(', ')}`);
  validateOriginalRequest(projectDir, workflow);
}

export function selectWorkflowArtifacts(projectDir: string, runId: string, specPath: string, planPath: string): WorkflowState {
  const workflow = requireWorkflow(projectDir, runId);
  const candidateSpec = createArtifactRef('spec', specPath, workflow.workspaceRoot);
  const candidatePlan = createArtifactRef('plan', planPath, workflow.workspaceRoot);
  const specChanged = !sameArtifact(workflow.spec, candidateSpec);
  const planChanged = !sameArtifact(workflow.plan, candidatePlan);
  const spec = specChanged ? candidateSpec : workflow.spec!;
  const plan = planChanged ? candidatePlan : workflow.plan!;
  updateLedger(projectDir, (ledger) => {
    if (!ledger.workflow || ledger.workflow.runId !== runId) throw new Error('Stale workflow run ID.');
    ledger.workflow.spec = spec;
    ledger.workflow.plan = plan;
    ledger.workflow.phase = 'planning';
  });
  if (specChanged) appendWorkflowEvent(projectDir, 'artifact_selected', runId, { kind: 'spec', path: spec.path, revision: spec.revision });
  if (planChanged) appendWorkflowEvent(projectDir, 'artifact_selected', runId, { kind: 'plan', path: plan.path, revision: plan.revision });
  return requireWorkflow(projectDir, runId);
}

export function recordPlanReadiness(projectDir: string, runId: string, readiness: PlanReadiness): WorkflowState {
  const workflow = requireWorkflow(projectDir, runId);
  if (!workflow.plan || workflow.plan.revision !== readiness.planRevision) throw new Error('Plan readiness must bind to the currently selected plan revision.');
  currentArtifact(workflow, workflow.plan);
  const currentPreflight = runPreflight(workflow.plan, workflow.workspaceRoot);
  if (readiness.preflight.artifact?.revision !== workflow.plan.revision) throw new Error('Preflight evidence must bind to the currently selected plan revision.');
  appendWorkflowEvent(projectDir, 'plan_readiness', runId, {
    planPath: workflow.plan.path,
    planRevision: readiness.planRevision,
    criticVerdict: readiness.criticVerdict,
    preflightOk: currentPreflight.ok,
    findings: currentPreflight.findings,
  });
  return requireWorkflow(projectDir, runId);
}

export function applyWorkflowAction(projectDir: string, action: WorkflowAction): WorkflowActionResult {
  let workflow = requireWorkflow(projectDir, action.runId);

  if (action.type === 'approveSpec') {
    if (!workflow.spec || action.artifact.path !== workflow.spec.path) throw new Error('Approval must reference the currently selected spec path.');
    if (action.artifact.revision !== workflow.spec.revision) throw new Error('Approval revision does not match the selected spec revision.');
    currentArtifact(workflow, workflow.spec);
    const previous = workflow.approvals ?? [];
    if (!previous.some((record) => record.artifactKind === 'spec' && record.revision === workflow.spec!.revision && record.decision === 'approved')) {
      updateLedger(projectDir, (ledger) => {
        if (!ledger.workflow || ledger.workflow.runId !== action.runId) throw new Error('Stale workflow run ID.');
        const record = { actor: 'user', artifactKind: 'spec' as const, revision: workflow.spec!.revision, decision: 'approved' as const, recordedAt: new Date().toISOString() };
        ledger.workflow.approvals = [...(ledger.workflow.approvals ?? []), record];
      });
    }
    appendWorkflowEvent(projectDir, 'spec_approved', action.runId, { path: workflow.spec.path, revision: workflow.spec.revision });
    return { workflow: requireWorkflow(projectDir, action.runId) };
  }

  if (action.type === 'acceptUnresolved') {
    const decisions = readDecisionLog(path.resolve(projectDir, workflow.decisionsPath));
    const unresolved = new Set(decisions.filter((decision) => decision.status === 'unresolved').map((decision) => decision.id));
    const current = acceptedUnresolved(projectDir, action.runId);
    const ids = [...new Set(action.decisionIds)];
    if (!ids.length || ids.some((id) => !unresolved.has(id))) throw new Error('Only existing unresolved decision IDs may be accepted.');
    const fresh = ids.filter((id) => !current.has(id));
    if (fresh.length) appendWorkflowEvent(projectDir, 'unresolved_accepted', action.runId, { decisionIds: fresh });
    return { workflow };
  }

  if (action.type === 'authorizeHandoff') {
    if (!action.idempotencyKey.trim()) throw new Error('Handoff idempotency key is required.');
    if (workflow.handoff) {
      if (workflow.handoff.idempotencyKey !== action.idempotencyKey) throw new Error('An existing handoff attempt must be reconciled with its idempotency key.');
      return { workflow, handoff: workflow.handoff };
    }
    ensureReady(projectDir, workflow);
    const decisionsPath = path.resolve(projectDir, workflow.decisionsPath);
    const decisionsSnapshot = JSON.stringify({
      log: fs.existsSync(decisionsPath) ? fs.readFileSync(decisionsPath, 'utf8') : '',
      acceptedUnresolved: [...acceptedUnresolved(projectDir, action.runId)].sort(),
    });
    const decisionsSnapshotHash = createHash('sha256').update(decisionsSnapshot).digest('hex');
    updateLedger(projectDir, (ledger) => {
      if (!ledger.workflow || ledger.workflow.runId !== action.runId || ledger.workflow.handoff) throw new Error('Workflow changed before handoff authorization.');
      ledger.workflow.handoff = {
        status: 'prepared',
        idempotencyKey: action.idempotencyKey,
        approvedRevisions: { spec: workflow.spec!.revision, plan: workflow.plan!.revision },
        decisionsSnapshotHash,
      };
      ledger.workflow.phase = 'handoff-prepared';
    });
    appendWorkflowEvent(projectDir, 'handoff_prepared', action.runId, { idempotencyKey: action.idempotencyKey });
    workflow = requireWorkflow(projectDir, action.runId);
    return { workflow, handoff: workflow.handoff };
  }

  const handoff = requireHandoff(workflow, action.idempotencyKey);
  if (action.type === 'recover') {
    appendWorkflowEvent(projectDir, 'recovery_requested', action.runId, { idempotencyKey: action.idempotencyKey, status: handoff.status });
    return { workflow, handoff };
  }

  if (handoff.status === 'cancelled' || handoff.status === 'cancelPending') return { workflow, handoff };
  let nextStatus: HandoffStatus = handoff.status === 'prepared' ? 'cancelled' : 'cancelPending';
  updateLedger(projectDir, (ledger) => {
    if (!ledger.workflow || ledger.workflow.runId !== action.runId) throw new Error('Stale workflow run ID.');
    const current = requireHandoff(ledger.workflow, action.idempotencyKey);
    if (current.status === 'cancelled' || current.status === 'cancelPending') {
      nextStatus = current.status;
      return;
    }
    const requestedAt = new Date().toISOString();
    nextStatus = current.status === 'prepared' ? 'cancelled' : 'cancelPending';
    ledger.workflow.handoff = {
      ...current,
      status: nextStatus,
      cancellationIntent: { requestedAt, ...(action.reason ? { reason: action.reason } : {}) },
      ...(nextStatus === 'cancelled' ? { cancellationResult: { cancelledAt: requestedAt, result: 'not-started' } } : {}),
    };
    ledger.workflow.phase = nextStatus === 'cancelled' ? 'cancelled' : 'cancel-pending';
  });
  appendWorkflowEvent(projectDir, 'cancel_requested', action.runId, { idempotencyKey: action.idempotencyKey, status: nextStatus });
  workflow = requireWorkflow(projectDir, action.runId);
  return { workflow, handoff: workflow.handoff };
}

export function markHandoffStarting(projectDir: string, runId: string, idempotencyKey: string): WorkflowState {
  const workflow = requireWorkflow(projectDir, runId);
  const handoff = requireHandoff(workflow, idempotencyKey);
  if (handoff.status === 'cancelled' || handoff.status === 'cancelPending') throw new Error('Cancelled handoff cannot start or resume.');
  if (handoff.status !== 'prepared') return workflow;
  updateLedger(projectDir, (ledger) => {
    if (!ledger.workflow || ledger.workflow.runId !== runId) throw new Error('Stale workflow run ID.');
    const current = requireHandoff(ledger.workflow, idempotencyKey);
    if (current.status === 'cancelled' || current.status === 'cancelPending') throw new Error('Cancelled handoff cannot start or resume.');
    if (current.status !== 'prepared') return;
    ledger.workflow.handoff = { ...current, status: 'starting' };
    ledger.workflow.phase = 'handoff-starting';
  });
  appendWorkflowEvent(projectDir, 'handoff_starting', runId, { idempotencyKey });
  return requireWorkflow(projectDir, runId);
}

export function recordHandoffOutcome(
  projectDir: string,
  runId: string,
  idempotencyKey: string,
  status: Extract<HandoffStatus, 'started' | 'failed' | 'unknown'>,
  process?: NonNullable<WorkflowState['handoff']>['process']
): WorkflowState {
  const workflow = requireWorkflow(projectDir, runId);
  const handoff = requireHandoff(workflow, idempotencyKey);
  const cancelled = handoff.status === 'cancelled' || handoff.status === 'cancelPending';
  if (!cancelled && handoff.status !== 'starting' && handoff.status !== 'unknown') {
    throw new Error(`Handoff outcome cannot be recorded while status is ${handoff.status}.`);
  }
  let effectiveStatus: HandoffStatus = handoff.status;
  updateLedger(projectDir, (ledger) => {
    if (!ledger.workflow || ledger.workflow.runId !== runId) throw new Error('Stale workflow run ID.');
    const current = requireHandoff(ledger.workflow, idempotencyKey);
    const currentCancelled = current.status === 'cancelled' || current.status === 'cancelPending';
    if (!currentCancelled && current.status !== 'starting' && current.status !== 'unknown') {
      throw new Error(`Handoff outcome cannot be recorded while status is ${current.status}.`);
    }
    effectiveStatus = currentCancelled ? current.status : status;
    ledger.workflow.handoff = {
      ...current,
      status: effectiveStatus,
      ...(process ? { process: { ...current.process, ...process } } : {}),
    };
    if (!currentCancelled) ledger.workflow.phase = `handoff-${status}`;
  });
  appendWorkflowEvent(projectDir, 'handoff_outcome', runId, { idempotencyKey, reportedStatus: status, effectiveStatus });
  return requireWorkflow(projectDir, runId);
}

export function recordCancellationResult(
  projectDir: string,
  runId: string,
  idempotencyKey: string,
  result: 'terminated' | 'already-exited' | 'failed'
): WorkflowState {
  const workflow = requireWorkflow(projectDir, runId);
  const handoff = requireHandoff(workflow, idempotencyKey);
  if (handoff.status === 'cancelled') return workflow;
  if (handoff.status !== 'cancelPending') throw new Error('No cancellation is pending for this handoff.');
  const cancelledAt = new Date().toISOString();
  const status: HandoffStatus = result === 'failed' ? 'cancelPending' : 'cancelled';
  updateLedger(projectDir, (ledger) => {
    if (!ledger.workflow || ledger.workflow.runId !== runId) throw new Error('Stale workflow run ID.');
    const current = requireHandoff(ledger.workflow, idempotencyKey);
    if (current.status === 'cancelled') return;
    if (current.status !== 'cancelPending') throw new Error('Cancellation state changed before its result was recorded.');
    ledger.workflow.handoff = { ...current, status, cancellationResult: { cancelledAt, result } };
    ledger.workflow.phase = status === 'cancelled' ? 'cancelled' : 'cancel-pending';
  });
  appendWorkflowEvent(projectDir, 'cancel_result', runId, { idempotencyKey, result, status });
  return requireWorkflow(projectDir, runId);
}
