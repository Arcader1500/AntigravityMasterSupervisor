# Stage B implementation plan: controlled development lifecycle and policy

**Approved design:** [Stage B design spec](../specs/2026-10-24-stage-b-controlled-development-lifecycle-design.md) (approved by the user on 2026-10-24).  
**Roadmap:** [Stage B](../../roadmap-updates/ROADMAP.md#stage-b--controlled-development-lifecycle)  
**Project:** TypeScript/Node.js, Ink/React TUI, Vitest; existing scripts are `npm test` and `npm run build`. Full typecheck command is `npx tsc --noEmit`.

## Goal and architecture

Implement one durable workflow identity across approved spec/plan revisions, decisions, process sessions, journal events, Git workspace, review, verification, and delivery evidence. Add versioned persistence and a normalized append-only journal; revision-aware approval and preflight; project policy resolution; explicit idempotent handoff; per-run Git isolation; recovery; evidence-backed review/fix/verification; and source-backed TUI status. Preserve the existing conversational TUI, CLI flags, and coding-team authority boundary: the orchestrator executes and commits, while the supervisor coordinates and validates evidence.

The codebase already has an atomic JSON ledger (`src/core/ledger.ts`), checkpoint and process outcome types (`src/core/types.ts`, `src/core/process-outcome.ts`), one PTY launch (`src/cli/commands/run.ts`, `src/pty/runner.ts`), PTY-derived prompt cards, and artifact/Git polling (`src/telemetry/poller.ts`). These are current observations, not enforced approval, policy, handoff, recovery, or verification contracts. New contracts are listed below and must be checked against the approved spec before implementation.

## Prerequisite gates and limits

- Stage 0 is still incomplete. Before enabling runtime-authoritative policy or using runtime events to advance lifecycle state, use the Stage 0 review's remaining qualification work to select and qualify the event/enforcement interface, including replay/duplicate/order/completeness, current mode/loading, denial behavior, and reliable exit evidence. Do not repeat its already-addressed basic cleanup/interactive echo checks solely because a planning agent lacks credentials. Until the gate passes, production policy automation stays disabled and manual operation remains available.
- Stage A's automated implementation review passed, but native Windows/POSIX live acceptance is still open. Record that gate and do not claim it passed as part of Stage B unit/integration checks.
- Runtime adapter contracts must fail closed when capability is unavailable, unsupported, stale, or not bound to the exact action. Do not invent CLI permission flags, depend on skip-permissions, or simulate atomicity with injected keys.
- No new launcher, CLI flag, network port, automatic merge/deploy, or model classifier is included. Preserve existing CLI entry points and role authority.
- The final reviewer/fix loop precedes one independent final verifier. Do not add a mandatory per-wave verification or second reviewer.

## Acceptance criteria

1. A run ID binds artifact revisions, approvals, decisions, sessions, journal, Git state, review, verification, and delivery evidence.
2. Spec approval is revision-bound; plan critic `READY` remains distinct from execution authorization; edits invalidate affected approval; retries cannot duplicate handoffs.
3. Plan preflight validates workspace-bounded paths, existing-versus-intended-new declarations, parallel write ownership, and verification prerequisites without running arbitrary plan commands.
4. Explicit handoff starts a fresh orchestrator with approved revisions and decisions in an isolated per-run Git workspace; the actual process/session identity and outcome are recorded.
5. Project policy under `.agy/` validates and resolves deterministically. Explicit denies and protected paths cannot be overridden. Unqualified or unbound actions stay manual/escalated.
6. Recovery reconciles journal, process state, artifacts, approvals, Git/worktree, task ownership, and delivery evidence before it resumes anything.
7. Review/fix reaches approved review before final independent verification. Failed verification returns through repair and review. Only controlled command/revision evidence and reviewed diff scope can establish delivery; changed revisions stale prior evidence.
8. Decisions and audit history survive context reset and recover safely from duplicates, unsupported events, malformed data, and uncertain launch outcomes.
9. Stage 0 and Stage A limitations remain explicit until their actual gates pass.

## Shared contracts to establish before consumers

These are the TypeScript contracts all tasks use. Their declarations belong to the task named; later tasks consume them without redefining them.

| Contract | Owner | Required shape / behavior |
| --- | --- | --- |
| `WorkflowState`, `ArtifactRef`, and persisted `HandoffRecord` | B1 | `WorkflowState { schemaVersion, runId, workspaceRoot, phase, originalRequest: { path, revision }, spec?: ArtifactRef, plan?: ArtifactRef, handoff?: HandoffRecord, decisionsPath, journalPath }`; `ArtifactRef { kind: 'spec'|'plan', path, revision, selectedAt }`. `revision` is a content SHA-256, not an mtime. The immutable original request snapshot is stored under `.agy/runs/<runId>/request.txt`; its SHA-256 remains the run identity reference through handoff and recovery. `HandoffRecord` is declared in `src/core/types.ts` in B1; B7 owns transition/action behavior. |
| `ApprovalRecord`, `DecisionRecord` | B1 | Approval binds `actor`, `artifactKind`, `revision`, `decision`, and `recordedAt`. Decision binds `id`, prompt, answer/status, evidence refs, assumptions, timestamp, and `supersedes?`. Superseding appends a record. |
| `JournalEvent`, `JournalReader`, `JournalWriter` | B2 | Event includes schema version, run/session IDs, source, monotonic source sequence, receive time, kind, typed payload, and stable event ID. Reader exposes valid events, duplicate/out-of-order/error records, and `lastValidSequence`; writer append is durable and idempotent by event ID. |
| `PolicyConfig` and `evaluatePolicy` | B3 | Read only `.agy/config.json` with `supervisor.policy: { version: 1, rules: [{ id, effect: 'allow'|'deny'|'escalate', actions: string[], paths?: string[] }] }`; `evaluatePolicy(action, config, context): PolicyDecision` returns `{ outcome, ruleId?, source, reason }`. Built-in protected-path and explicit-deny rules are final; project config cannot override them. Native runtime policy may further deny/escalate but cannot be loosened by this config. |
| Plan metadata and `runPreflight` | B4 | Plans declare `## Execution metadata`, a `### Files` table (`Path | Intent(existing/new) | Owner | Task`), and a `### Verification` table (`ID | Command | Cwd | Required`). `runPreflight(plan, workspaceRoot)` returns `PreflightResult { ok, findings: Array<{ code, severity: 'error'|'warning', artifactPath?, taskId?, message }> }`; it parses command declarations but never executes them. |
| `RunWorkspace` | B5 | `createRunWorkspace(repoRoot, runId, options)` returns `RunWorkspace { root, branch, baseRevision, controlStateRoot, inputManifest }`. Canonical state stays in `.agy/runs/<runId>` under the original workspace; immutable policy/spec/plan/decision snapshots are copied into `.agy/supervisor-input/<runId>` in the run worktree and verified by content hash. Never use an external symlink or modify/delete user files. |
| `VerificationEvidence` | B6 | Evidence records command argv, cwd, commit SHA, working-tree fingerprint, start/end times, exit code/signal, stdout/stderr refs, and truncation/redaction metadata. Fingerprint covers HEAD, index, tracked worktree changes, and non-ignored untracked path/content hashes; `.git` and `.agy` control state are excluded. |
| `HandoffRecord` transitions and `WorkflowAction` | B7 | Handoff states are `prepared|starting|started|failed|unknown|cancelPending|cancelled`; record idempotency key, approved revisions, decisions snapshot hash, cancellation intent/result, and actual process/session identity/outcome. B7 owns the discriminated `WorkflowAction` union: `{ type: 'approveSpec', runId, artifact: { path, revision } } | { type: 'authorizeHandoff', runId, idempotencyKey } | { type: 'acceptUnresolved', runId, decisionIds } | { type: 'cancel', runId, idempotencyKey, reason? } | { type: 'recover', runId, idempotencyKey }`. Every action is checked against the current run and, for `approveSpec`, the currently selected spec path and content revision; stale identities are rejected. Actions cannot be synthesized from text. B12 consumes this contract without redefining it. |
| `RuntimeCapabilities` and normalized events | B8/B9 | `RuntimeCapabilities { transport, schemaVersion, exactActionBinding, orderedReplay, sessionIdentity }`; `RuntimeEvent` is a discriminated union for `session.started`, `agent.role_reported`, `tool.requested`, `tool.decision`, `process.ended`, and `workflow.evidence`, each carrying run/session/event IDs, source and sequence. `createRuntimeEventAdapter(source, journal): RuntimeEventAdapter` maps only events actually present in the Stage 0-qualified schema. Role values are `planner|critic|orchestrator|reviewer|verifier` only when supplied by that source; text parsing is never the authority for a gate. |
| `RecoveryDecision`, `DeliveryEvidence` | B10/B11 | Recovery returns `resume|restart-required|manual-checkpoint|blocked` with evidence refs and reasons. Delivery state advances only from linked structured reviewer/verifier evidence on the current working-tree fingerprint and reviewed diff scope. |

### Configuration and evidence defaults

- Project configuration path is `.agy/config.json`; only its `supervisor.policy` section is Stage B policy. Each rule has a stable ID, effect, action selector, and optional path selector; unknown fields/effects are configuration errors. Do not add global, environment, or CLI policy sources. Resolution order is non-overridable built-in denies/protected paths, project rules, then additional restrictions from the qualified native runtime. A native deny cannot be weakened by project configuration.
- Canonical run state, journal, and decision log live under `.agy/runs/<runId>` in the original project root. For an isolated worktree, copy read-only approved spec/plan snapshots and the exact policy snapshot into `.agy/supervisor-input/<runId>` inside the worktree, with SHA-256 manifest; this makes uncommitted artifacts and ignored `.agy` configuration available without transferring arbitrary workspace state. Do not copy secrets or expose the original `.agy` tree.
- Journal retains normalized structured events and controlled command output only; it does not retain raw PTY transcripts. Captured stdout/stderr is capped at 64 KiB per stream with explicit truncation metadata. Apply secret-pattern redaction before persistence; if redaction fails, omit the output and persist a failure marker. Retain records until the user removes that run's state; no automatic retention deletion in Stage B. A missing or changing working-tree fingerprint makes evidence stale, even if HEAD is unchanged.
- Review and verification identify both commit SHA and working-tree fingerprint. Any changed tracked/untracked input, approved artifact, policy snapshot, or diff scope invalidates affected evidence. The clean final integrated revision must be re-reviewed and re-verified before delivery.

## Execution Waves

| Wave | Tasks | Purpose |
| --- | --- | --- |
| 1 | B1–B6 | Establish independent persistence, journal, policy, preflight, workspace, and verification contracts. |
| 2 | B7–B8 | Establish workflow transitions and the qualified runtime boundary after Stage 0 selects its contract. |
| 3 | B9 | Connect approved workflow state to an idempotent fresh orchestrator handoff and normalized role/session ingestion. |
| 4 | B10–B11 | Add recovery and evidence-gated review/fix/final verification, consuming the completed handoff contract. |
| 5 | B12 | Connect selected artifacts, approvals, lifecycle state, and safe status/actions across CLI/TUI/polling. |
| 6 | B13 | Update user docs and evidence map to match implemented behavior. |
| 7 | B14 | Exercise representative end-to-end paths and close the Stage B record after review. |

Tasks within each wave own disjoint files. Later waves consume contracts from earlier waves. The orchestrator dispatches tasks by these dependencies; agents do not commit.

## Tasks

### B1 — Versioned workflow state and durable decisions

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/types.ts`, `src/core/ledger.ts`, `src/core/decision-log.ts` (new), `tests/unit/ledger.test.ts`, `tests/unit/decision-log.test.ts` (new)

**Contracts and acceptance criteria:** Extend persisted state compatibly with stable workflow/run identity, immutable original-request snapshot path/revision, artifact revision references, revision-bound approval records, the persisted `HandoffRecord` type, and decision-log references. Keep the original request available to recovery/handoff by verified content hash. Provide schema-version migration that preserves existing ledgers and old status readability. Decision records capture question/decision, answer or unresolved state, evidence/source, assumptions, time, and supersession; never serialize secrets or treat agent text as executable instructions. Ledger updates remain atomic. Corrupt/unknown versions are preserved for diagnosis and do not silently authorize a workflow.

**Risks:** Existing consumers rely on ledger types and migration behavior; keep historical `COMPLETED` records readable without treating them as verified delivery.

**Task checks:** Add failing migration, atomic-write, legacy-ledger, original-request snapshot/hash survival, approval-history, decision-supersession, and corrupt/unknown-version cases. Run `npx vitest run tests/unit/ledger.test.ts tests/unit/decision-log.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. Run `npx tsc --noEmit` because shared ledger contracts affect existing callers.

### B2 — Append-only normalized event journal

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/event-journal.ts` (new), `tests/unit/event-journal.test.ts` (new), `tests/fixtures/stage-b/stream-event.jsonl` (new), `tests/fixtures/stage-b/permission-event.jsonl` (new), `tests/fixtures/stage-b/duplicate-replay.jsonl` (new)

**Contracts and acceptance criteria:** Implement the `JournalEvent`, `JournalReader`, and `JournalWriter` contracts above. Records bind run/session, source/provenance, schema version, source sequence and receive time, event kind, and stable duplicate identity. Enforce the stated output cap, secret-pattern redaction, omission-on-redaction-failure, and until-user-removal retention defaults. Detect malformed, unsupported, duplicate, out-of-order, truncated, and missing segments; surface explicit status and last valid checkpoint without interpreting captured text as instructions. Create the three named fixtures from sanitized, Stage 0-qualified captures only; until then, use generated non-sensitive fixture payloads and label their provenance as synthetic.

**Risks:** Do not infer schema from the two historical fixtures as complete runtime coverage. Event semantics are enabled only for the exact Stage 0-qualified contract.

**Task checks:** Add failing replay/idempotency, ordering, unsupported-version, malformed/truncated record, redaction, and last-valid-checkpoint tests with real temporary directories. Run `npx vitest run tests/unit/event-journal.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. Validate fixture JSONL parsing through the same reader.

### B3 — Project policy config and deterministic evaluator

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/policy.ts` (new), `tests/unit/policy.test.ts` (new)

**Contracts and acceptance criteria:** Read and validate only `.agy/config.json`'s `supervisor.policy` section without changing CLI flags. Implement `evaluatePolicy(action, config, context): PolicyDecision` as specified above. Return the effective rules/source for audit/display. Evaluations return only `allow`, `deny`, or `escalate` plus matched rule/reason. Built-in deny and protected `.env*` rules are non-overridable; unknown/malformed/conflicting policy cannot allow an action. No model call participates. Keep policy parsing separate from runtime enforcement so an unqualified runtime cannot claim enforcement.

**Risks:** Avoid confusing policy configuration with Antigravity's own settings. Do not add user-level, CLI, or environment policy sources beyond the user-approved project config without a new approval.

**Task checks:** Add failing tests for missing/malformed config, deterministic match precedence, deny-wins behavior, protected path variants, unknown action escalation, and audit source. Run `npx vitest run tests/unit/policy.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. Use temporary project fixtures for `.agy/` config.

### B4 — Artifact revision identity and plan preflight

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/preflight.ts` (new), `src/core/artifact-revisions.ts` (new), `tests/unit/preflight.test.ts` (new), `tests/unit/artifact-revisions.test.ts` (new)

**Contracts and acceptance criteria:** Implement `runPreflight(plan, workspaceRoot): PreflightResult` and artifact revision hashing per the shared contracts. Resolve artifact paths against the selected workspace, reject escape/ambiguity, distinguish existing targets from explicitly intended new files, and identify content revisions independently of modification time. Parse the exact `## Execution metadata` section and required tables. Preflight checks declared parallel write ownership overlap and verification-command prerequisites without executing plan commands. Report all actionable findings with artifact/revision context. Changed content yields a new revision and identifies the affected approvals to invalidate.

**Risks:** Artifact polling's current newest-file-by-mtime heuristic is discovery only; it cannot provide selected ownership or approval identity.

**Task checks:** Add failing tests for valid existing and intended-new paths, missing declaration, traversal/absolute external paths, ambiguous matches, content changes with unchanged mtime, overlapping/disjoint ownership, and missing verification prerequisites. Ensure tests use `fs.mkdtempSync` and actual files, not fake path literals. Run `npx vitest run tests/unit/preflight.test.ts tests/unit/artifact-revisions.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B5 — Per-run Git workspace manager

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/worktree.ts` (new), `tests/unit/worktree.test.ts` (new)

**Contracts and acceptance criteria:** Implement `createRunWorkspace(repoRoot, runId, options)` and `RunWorkspace` as specified above. Create, inspect, and remove only supervisor-owned per-run Git worktrees/branches. Record base revision, branch/worktree identity, control-state path, input manifest, and status; preserve the user's current checkout and uncommitted files. Copy immutable approved spec/plan contents, the exact `.agy/config.json` policy snapshot, and accepted decision snapshot into the run worktree's `.agy/supervisor-input/<runId>` and verify every SHA-256. Keep canonical state under the original workspace's `.agy/runs/<runId>`. Detect missing Git, conflicting run identity, unexpected worktree state, and integration/base drift. Do not claim worktree file-access, secret, or network isolation. Overlapping task writes can request task-level isolation; disjoint writes need only explicit ownership.

**Risks:** Git operations are destructive when ownership is unclear. Restrict cleanup to recorded supervisor-owned worktrees and verify resolved paths before removal. For non-Git workspaces, controlled execution cannot claim per-run isolation and must stop or remain in manual planning.

**Task checks:** Add failing tests using temporary initialized repositories for create/reuse, preserved dirty user checkout, foreign worktree rejection, changed base, cleanup ownership, and missing Git metadata. Include a dirty checkout with an untracked spec/plan and ignored `.agy/config.json`; verify the content-hashed approved snapshots/policy are present in the run workspace while every original user file remains untouched. Run `npx vitest run tests/unit/worktree.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B6 — Controlled command execution and evidence records

**Wave:** 1  
**Depends on:** None  
**Files Touched:** `src/core/verification.ts` (new), `tests/unit/verification.test.ts` (new)

**Contracts and acceptance criteria:** Run an explicitly authorized verification command using argument arrays and an explicit cwd/revision context; capture actual start/end, exit code or signal, capped stdout/stderr, redaction and truncation metadata, and structured evidence identity. Record commit SHA plus the B6 working-tree fingerprint (HEAD, index, tracked diff, and non-ignored untracked path/content hashes; exclude `.git` and `.agy` control state). Do not shell-evaluate a plan string or run commands during preflight. Distinguish command execution from agent-reported results. Evidence becomes stale when the source tree, approved artifact, policy snapshot, or diff scope changes. Retain evidence until user removes run state.

**Risks:** Bound output and process lifecycle without discarding evidence needed to audit failures. Never infer a successful verification from process exit 0 alone if command identity/revision is missing.

**Task checks:** Add failing tests with `process.execPath` and temporary scripts for exit 0/nonzero, signal/interruption, cwd, argument fidelity, output capture/redaction failure, 64 KiB stream truncation, duplicate evidence IDs, unchanged-HEAD dirty tree fingerprints, and stale revision detection. Run `npx vitest run tests/unit/verification.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B7 — Lifecycle transitions, approvals, and handoff idempotency

**Wave:** 2  
**Depends on:** B1, B2, B4  
**Files Touched:** `src/core/workflow.ts` (new), `tests/unit/workflow.test.ts` (new)

**Contracts and acceptance criteria:** Compose a state machine that binds the original request/run, current artifact revisions, user spec approval, critic plan `READY`, preflight result, explicit execution authorization, and handoff attempt. `READY` alone never authorizes execution. Approval is revision-bound and changed revisions invalidate only affected approvals. Implement the shared `WorkflowAction` union above, including run-bound `approveSpec` with selected spec path/revision and typed `recover`; reject stale run IDs and stale or non-selected spec identities. Persist handoff intent before launch and use a stable idempotency key; retries reconcile an uncertain attempt instead of spawning another. Cancellation has precedence over launch/readiness: before launch, persist `cancelled` and never spawn; during `starting`/`unknown`, persist `cancelPending`, suppress all further work, reconcile by idempotency/run identity, and terminate only a positively identified supervisor-owned child if it appears. Repeated cancellation is idempotent. Late launch/runtime events after cancellation remain in the journal but cannot revive execution or advance gates. Keep unresolved decisions explicit and block handoff unless the user accepted them as unresolved.

**Risks:** Keep execution authorization distinct from ledger phase, PTY input delivery, agent claims, and critic verdicts.

**Task checks:** Add failing transition tests for ordering, missing approval, stale revision, stale run ID, non-selected spec path/revision, readiness without authorization, preflight errors, accepted unresolved items, repeat/uncertain handoff, cancellation before launch, cancellation during uncertain launch, repeated cancellation, typed recovery, late events after cancellation, original-request identity, and audit history. Run `npx vitest run tests/unit/workflow.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. Run `npx tsc --noEmit` for shared contract consumers.

### B8 — Qualified runtime policy boundary

**Wave:** 2  
**Depends on:** B2, B3  
**Files Touched:** `src/permissions/runtime-policy.ts` (new), `tests/unit/runtime-policy.test.ts` (new)

**Contracts and acceptance criteria:** Implement the `RuntimeCapabilities` and policy adapter boundary in `src/permissions/runtime-policy.ts`. It must declare selected transport, event schema version, action binding, ordering/replay support, and observed session identity. Bind every decision to exact run/session/action identity and arguments. Explicit denies/protected paths cannot be overridden. Unknown, changed, duplicate, stale, or unbound prompts escalate or stop. If the Stage 0 gate or capability is unavailable, fail closed to manual operation and expose the actual limitation; never use PTY text/key injection as enforcement.

**Risks:** The Stage 0 review has not selected a complete qualified adapter contract. Implement the interface and fixture adapter now, but do not dispatch production adapter implementation or enable policy automation until a Stage 0 evidence update names the current CLI/plugin versions, selected transport/schema and permission-bound enforcement call, includes sanitized captures, and passes its replay/duplicate/order/completeness/exit and current-mode gates. Do not guess event fields or label historical probes current.

**Task checks:** Add failing fixture tests for allow, deny, escalation, exact-action binding, changed arguments, duplicate/stale action, unsupported capability, and disabled Stage 0 gate. Run `npx vitest run tests/unit/runtime-policy.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. B9's production ingestion/adapter task is not dispatched until the Stage 0 evidence update meets the gate above.

### B9 — Fresh orchestrator launch and run orchestration

**Wave:** 3  
**Depends on:** B1, B2, B5, B6, B7, B8  
**Files Touched:** `src/core/orchestration.ts` (new), `src/core/runtime-events.ts` (new), `src/cli/commands/run.ts`, `src/pty/runner.ts`, `tests/unit/orchestration.test.ts` (new), `tests/unit/runtime-events.test.ts` (new), `tests/integration/workflow-handoff.test.ts` (new), `tests/fixtures/stage-b/role-lifecycle.jsonl` (new)

**Contracts and acceptance criteria:** Implement `RuntimeEvent` ingestion as a `JournalEvent` producer and map only Stage 0-qualified structured events into roles `planner|critic|orchestrator|reviewer|verifier`. Persist run/session/event identity and provenance. Connect events to the lifecycle service so critic READY remains readiness, reviewer approval is attributable to the actual reviewer session, and verifier identity is attributable to the final independent verifier. Create a fresh orchestrator process/session only after authorized handoff, with verified original-request snapshot, approved spec/plan revisions, durable decisions, run identity, task ownership, and isolated workspace context. Copy the immutable handoff manifest into the workspace as defined in B5. Record actual child run/session identity and outcome. Keep agent execution and commits with the orchestrator. Avoid adding a CLI flag; preserve existing defaults and `--resume` semantics until a distinct workflow-recovery interface is designed. Repeated or uncertain launches use B7 idempotency and do not duplicate workers. Cancellation received before/during launch is reconciled per B7; late launch callbacks cannot revive a cancelled run.

**Risks:** The current CLI starts one selected agent process with raw args; do not silently change current direct-run behavior into a multi-agent lifecycle. Add controlled workflow launch only through existing supervisor interaction and gate it on state readiness. This task includes production adapter/ingestion work and is gated on the Stage 0 contract update described in B8; until then, only fixture-backed integration may be developed.

**Task checks:** Add failing tests using a real temporary project and harmless Node child process for fresh run identity, approved context handoff, process outcomes, repeated requests, spawn failure, cwd/worktree binding, normalized critic READY/reviewer approval/verifier completion, role/session attribution, prose-only claims not advancing gates, and the actual final verifier using B6's controlled runner. Run `npx vitest run tests/unit/orchestration.test.ts tests/unit/runtime-events.test.ts tests/integration/workflow-handoff.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes. Run `npx tsc --noEmit`.

### B10 — Crash and workflow recovery reconciler

**Wave:** 4  
**Depends on:** B1, B2, B4, B5, B7, B9  
**Files Touched:** `src/core/recovery.ts` (new), `tests/unit/recovery.test.ts` (new)

**Contracts and acceptance criteria:** Reconcile journal checkpoints, ledger snapshot, process/session liveness and outcome, artifact revisions/approvals, Git/worktree state, task ownership, and evidence. Distinguish ledger reuse, workflow recovery, and supported underlying conversation resume. Restart is deliberate; a dead PTY is never shown as live. Missing/corrupt journal spans, uncertain process identity, stale artifacts, invalid worktree, or conflicting task state stop at a safe checkpoint rather than execute.

**Risks:** Do not treat task checkboxes, `--resume`, mtime discovery, or phase changes as completion or process identity.

**Task checks:** Add failing tests for clean recovery, dead process, uncertain handoff, partial journal, duplicate events, changed artifact revision, stale verification, foreign worktree, unsupported conversation resume, and original-request hash mismatch. Run `npx vitest run tests/unit/recovery.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B11 — Review/fix and final verification evidence gates

**Wave:** 4  
**Depends on:** B1, B2, B6, B7, B9  
**Files Touched:** `src/core/delivery.ts` (new), `tests/unit/delivery.test.ts` (new)

**Contracts and acceptance criteria:** Record attributable reviewer result and evidence; continue review/fix until approved, then run one final independent verification. A failed verifier returns to repair and review before retry. Link command, cwd, revision, exit, output evidence, reviewer/verifier identity, and diff-scope assessment. Unexpected changes require explanation/review; integration revision changes stale affected evidence. Agent prose, `DONE`, `APPROVE`, `PASS`, or process exit alone keep gates open.

**Risks:** Preserve the workflow preference for review/fix followed by final independent verification. Do not add per-wave final verification or an extra model-only gate.

**Task checks:** Add failing transition tests for reviewer concerns, approval, verifier exit 0/nonzero, failed verification repair loop, changed revision, unexpected diff paths, missing evidence, and duplicate result. Run `npx vitest run tests/unit/delivery.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B12 — CLI/TUI lifecycle controls and source-backed status

**Wave:** 5  
**Depends on:** B1–B11  
**Files Touched:** `src/cli/commands/run.ts`, `src/telemetry/types.ts`, `src/telemetry/store.ts`, `src/telemetry/poller.ts`, `src/tui/App.tsx`, `src/tui/transcript-store.ts`, `src/tui/index.ts`, `src/tui/narrator.ts`, `src/tui/narrator-copy.ts`, `src/tui/components/DecisionCard.tsx`, `src/tui/components/SpecPlanView.tsx`, `src/tui/components/AuditLogView.tsx`, `src/tui/process-presentation.ts`, `tests/unit/tui-app.test.tsx`, `tests/unit/tui-transcript-store.test.ts`, `tests/unit/telemetry-poller.test.ts`, `tests/unit/tui-narrator.test.ts`, `tests/unit/tui-process-presentation.test.ts`, `tests/integration/tui-run.test.ts`

**Contracts and acceptance criteria:** Connect existing UI to typed workflow states/actions, consuming the B7 `WorkflowAction` without redefining it. Route spec approval through `{ type: 'approveSpec', runId, artifact: { path, revision } }`; handoff, cancel, and recovery callbacks use their corresponding typed actions with the current run ID and idempotency key. The workflow rejects callbacks for a stale run or a spec path/revision that is no longer selected. Never send approval text to PTY as the approval record. Ordinary question responses remain PTY input, and permission prompts remain native manual interaction while the Stage 0 gate is closed. Expose cancellation precedence/result for prepared, starting, and uncertain handoffs; repeated cancel is safe, and late callbacks cannot revive state. Polling may discover candidate artifact paths, but cannot replace the selected artifact in `WorkflowState`; content revision change cancels pending approval/handoff and displays stale state. Present revision-specific spec approval, plan readiness, explicit handoff, policy source/effective outcome, preflight findings, recovery checkpoints, review/fix, verification evidence, and final delivery state. Maintain existing view/input ownership and CLI options. All statuses name their source; approvals, launches, review, and verification are shown only from authoritative structured evidence.

**Risks:** Preserve Stage A factual-status behavior and avoid new editorial copy commitments. `src/cli/commands/run.ts` is also owned by B9; B12 depends on B9 and must integrate with its final interface rather than revert or duplicate it.

**Task checks:** Add failing App/store/poller/narrator/presentation cases for run-bound approval callback with selected path/revision (without PTY approval input), rejecting stale-run and non-selected-artifact callbacks, preserving selected artifact against newer discovery candidates, stale-revision cancellation, spec approval vs READY, handoff success/failure/retry, cancel-before-launch, cancel-during-uncertain-launch, repeated cancel, typed recovery, late callback after cancellation, disabled runtime policy, recovery stop, review/fix loop, stale verification, original request persistence, and evidence-backed completion. Run `npx vitest run tests/unit/tui-app.test.tsx tests/unit/tui-transcript-store.test.ts tests/unit/telemetry-poller.test.ts tests/unit/tui-narrator.test.ts tests/unit/tui-process-presentation.test.ts tests/integration/tui-run.test.ts --maxWorkers=1 --minWorkers=1`; after implementation the focused run passes.

### B13 — User documentation, policy contract, and roadmap evidence

**Wave:** 6  
**Depends on:** B12  
**Files Touched:** `README.md`, `docs/roadmap-updates/ROADMAP.md`, `docs/roadmap-updates/stage-b-controlled-development-lifecycle-review.md` (new), `scripts/check-doc-links.mjs` (new), `tests/unit/doc-links.test.ts` (new)

**Contracts and acceptance criteria:** Describe the actual project-policy location/schema and validation, lifecycle/checkpoint meanings, manual handoff, resume distinctions, recovery limits, Git isolation boundaries, delivery evidence, and Stage 0/Stage A prerequisite status. The Stage B review separates implemented behavior, automated evidence, live/runtime gates, and remaining limitations. Keep roadmap claims evidence-backed and leave historical reviews intact. Do not mark Stage 0 or Stage A complete from Stage B work.

**Risks:** Documentation must describe the reviewed implementation, not projected behavior. Avoid changing exact copy policy without user review.

**Task checks:** Add a failing `doc-links.test.ts` case for a broken relative link, then implement `scripts/check-doc-links.mjs` using Node's filesystem/path APIs and validate all touched relative links with `node scripts/check-doc-links.mjs`; it must report the source document and missing target and exit nonzero. Run `npx vitest run tests/unit/doc-links.test.ts --maxWorkers=1 --minWorkers=1`. Check README and roadmap statements against final source. Run `node bin/agy-supervisor.js --help` to confirm CLI compatibility. No broad tests are needed for documentation-only edits.

### B14 — Representative end-to-end lifecycle and failure acceptance

**Wave:** 7  
**Depends on:** B1–B13 and Stage 0/Stage A prerequisite evidence  
**Files Touched:** `tests/integration/workflow-lifecycle.test.ts` (new), `tests/fixtures/stage-b/workflow-success.jsonl` (new), `tests/fixtures/stage-b/workflow-interrupted.jsonl` (new), `tests/fixtures/stage-b/workflow-stale-evidence.jsonl` (new), `docs/roadmap-updates/stage-b-controlled-development-lifecycle-review.md`

**Contracts and acceptance criteria:** Exercise a representative lifecycle from request through spec approval, critic READY, preflight, explicit handoff, implementation/review fixture, final verification, and reviewable isolated branch. The exact named sanitized fixtures cover success, interrupted handoff, and stale evidence; synthetic fixtures are labeled as such until replaced by Stage 0-qualified captures. Include changed spec/plan revisions, failed/uncertain handoff, duplicate retry, denial/escalation, interrupted process, crash recovery, stale verification, and unexpected diff scope. Confirm a failed/interrupted flow recovers without executing stale or unapproved work. Live native checks requiring Stage 0 qualification must be run only once its gate is met and recorded separately from hermetic tests; if unavailable, mark them NOT RUN and keep dependent automation disabled.

**Risks:** Do not represent a fixture-based end-to-end test as a live Antigravity acceptance. Do not repeat resolved Stage 0 cleanup/echo checks. Identify exact runtime, plugin, permission mode, OS, and terminal for any live evidence.

**Task checks:** First add a failing deterministic integration scenario using temporary Git repositories and harmless Node child processes; then implement/fix until `npx vitest run tests/integration/workflow-lifecycle.test.ts --maxWorkers=1 --minWorkers=1` passes. After the independent review/fix loop is approved, the final verifier runs `npm test -- --maxWorkers=1 --minWorkers=1`, `npx tsc --noEmit`, and `npm run build`, records revision/environment/exit codes, and updates the evidence review. Do not run these final checks before the review/fix loop as a substitute for final verification.

## Review and final verification

After all implementation waves, the orchestrator dispatches an independent code reviewer. Implementers fix findings; the reviewer rechecks until approved. Do not start final verification until that loop is approved. Then an independent verifier runs the full suite, full typecheck, and build against the reviewed tree, records the exact revision/environment/commands/results, and confirms the evidence review matches that tree. No worker commits. The orchestrator commits only authorized, reviewed changes after checking for unrelated user changes.

## Planner self-check

- Every Stage B spec requirement maps to B1–B14 or an explicit prerequisite gate above.
- Existing modules and scripts named here were confirmed in the checkout: `src/core/ledger.ts`, `src/core/types.ts`, `src/core/process-outcome.ts`, `src/cli/commands/run.ts`, `src/pty/runner.ts`, `src/telemetry/poller.ts`; `package.json` defines `npm test` and `npm run build`, while `npx tsc --noEmit` is the current typecheck command.
- Non-trivial tasks specify focused failing-then-passing Vitest checks; final full verification follows the independent review/fix loop.
- Same-wave files are disjoint; `run.ts` overlap between B9 and B12 is sequential by dependency.
- Stage 0/Stage A live gates and unverified runtime contracts are not presented as completed evidence.
