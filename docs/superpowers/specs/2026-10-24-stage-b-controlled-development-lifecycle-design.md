# Stage B: controlled development lifecycle and policy

Date: 2026-10-24  
Status: draft for user approval  
Repository: `D:\Code\AntigravityMasterSupervisor` on `dev`  
Roadmap: [Stage B](../../roadmap-updates/ROADMAP.md#stage-b--controlled-development-lifecycle)  
Runtime evidence: [Stage 0 review](../../roadmap-updates/stage-0-runtime-contract-review.md)  
Stage A evidence: [Stage A review](../../roadmap-updates/stage-a-interactive-baseline-review.md)

## Goal

Make the supervisor own a durable, recoverable control path from the original request through spec approval, plan readiness, explicit execution handoff, implementation, review/fix, final independent verification, and evidence-backed delivery. Preserve the existing conversational TUI and Antigravity coding-team hierarchy. The orchestrator remains responsible for task execution and commits; the supervisor coordinates, enforces checkpoints and policy, and records evidence.

## Confirmed requirements and design decisions

- Use the Stage B roadmap as the feature boundary. Manual handoff is the default. Critic `READY` means planning is ready; it does not authorize implementation. Automatic handoff remains an optional future policy and is not added as a second mandatory approval after `READY`.
- The user selected a supervisor project configuration for deterministic permission rules. Store project policy under the existing `.agy/` convention. The exact schema, precedence display, and migration behavior are implementation details to settle in the plan; policy must be visible and audited.
- A spec approval is an explicit user action tied to the exact artifact revision. Material edits invalidate the affected approval. A critic verdict, PTY input delivery, ledger phase, or agent statement is not approval evidence.
- Plan preflight checks declared paths (distinguishing existing paths from intended new files), parallel write ownership, and verification-command prerequisites. Preflight must not execute arbitrary plan commands.
- A handoff starts a genuinely fresh orchestrator session with the approved spec, READY plan, and durable decisions. Retried UI actions and recovery cannot create duplicate workers or handoffs.
- Preserve accepted answers, evidence, assumptions, unresolved questions, and later changes in a durable decisions log that follows the approved artifacts across the context reset.
- Deterministic permission policy uses allow, deny, and escalate outcomes. Protected paths (including `.env*`) and explicit denies are enforced at a qualified runtime boundary; model classification is out of scope. Native enforcement is preferred over terminal key injection. Unknown, stale, or unbound actions escalate or stop safely.
- Resume distinguishes ledger reuse, workflow recovery, and supported underlying Antigravity conversation resume. A restart is deliberate. Recovery reconciles journal, approved artifact revisions, Git state, process/session identity, and task evidence.
- Isolate each run from the user's checkout. Define write ownership for parallel tasks; use separate task worktrees only for genuinely overlapping writes. The orchestrator owns commits and integration. Worktrees do not provide file-access, secret, or network isolation.
- Review/fix continues until review is approved, then one final independent verification runs. Verification failures return through repair and review before another final verification attempt.
- Delivery requires controlled evidence: actual command, working directory, revision, exit status, and output; agent DONE/reviewer/verifier prose alone is a claim. Compare the final diff with approved scope, explain or review unexpected changes, and invalidate verification if integration changes its revision.
- Preserve existing CLI entry points and flags, manual permission behavior, and the conversational UI. No new launcher, CLI flag, port, interface reorganization, or automatic merge/deploy is specified. Exact editorial copy is not prescribed here.

## Evidence and current boundary

The current implementation has an atomic JSON ledger with checkpoint fields and events, process-run identities/outcomes, PTY decision cards, and workspace/Git/artifact polling. These are persistence and observation primitives, not an enforced lifecycle:

- The checkpoint type can represent `APPROVED` and `REJECTED`, but inspected production paths do not assign those states. The spec card sends approval text to the PTY; approval is not bound to artifact content. (`src/core/types.ts`; `src/telemetry/poller.ts`; `src/tui/transcript-store.ts`.)
- Artifact discovery selects matching files by path/name and modification time. It does not prove ownership or bind approval to a revision. (`src/telemetry/poller.ts`.)
- `--resume` reuses ledger state and starts a new child process; it does not recover an interrupted workflow or reconnect to an underlying conversation. (`src/cli/commands/run.ts`; `src/pty/runner.ts`.)
- Permission prompts are inferred from PTY text and answered with PTY input. There is no deterministic policy engine or atomic action binding. (`src/telemetry/parser.ts`; `src/tui/transcript-store.ts`.)
- Git branch/dirty state and last commit are observed, but the launch path has no per-run worktree isolation. The ledger has no controlled reviewer/verifier command evidence record. (`src/telemetry/poller.ts`; `src/pty/runner.ts`; `src/core/types.ts`.)

Stage 0 remains incomplete. Its review says not to use runtime events or permissions for automation until current mode/loading, comparable cross-mode behavior, event completeness/order/replay/duplicate handling, nonzero exit reporting, and a versioned contract with journal redaction/retention are qualified. Stage A implementation review and automated checks passed, but native Windows/POSIX live acceptance remains open. Stage B's runtime-authoritative permission and lifecycle behavior is gated on those prerequisites; the Stage B design does not treat historical probes as current qualification.

## Architecture and behavior

### Run record, artifacts, and decisions

Represent one supervisor workflow as a stable run identity with linked artifact revisions, decision-log entries, agent process/session identities, journal events, Git state, and delivery evidence. Preserve compatibility with the existing ledger through an explicit migration/version strategy. Use the Stage 0 normalized append-only journal contract for replay and crash recovery; do not treat mutable ledger snapshots or plan checkboxes as event history or completion proof.

For every approved spec/plan, persist a stable content revision identifier alongside its resolved path. Approval records identify the approver action, artifact revision, and time. A changed artifact clears or supersedes only the approvals it affects and prevents handoff until the new required checkpoint is satisfied. Keep old decisions and approvals as history rather than rewriting them. Store decisions as attributable records: question/decision, accepted answer or status, evidence/source, assumptions, unresolved state, timestamp, and any superseding entry. Avoid storing secrets or raw agent text as executable instructions.

Artifact resolution must be explicit and workspace-bounded. The plan's path declarations distinguish existing paths from planned new paths. Invalid, escaping, ambiguous, or stale paths block preflight and explain the condition. File modification time can support discovery but never establish ownership, approval, or revision identity.

### Checkpoints and plan preflight

Maintain distinct states for spec review/approval, plan critic readiness, execution authorization/handoff, review, and verification. The user approves the spec revision. The plan critic's `READY` establishes readiness only. Manual handoff is a separate explicit action that is enabled only when the selected spec revision is approved, the plan is `READY`, preflight passes, and required decisions are resolved or explicitly accepted as unresolved.

Preflight checks path declarations and intended-new-file annotations, duplicate/overlapping parallel write ownership, and declared verification commands for required metadata/prerequisites. It validates declarations without running arbitrary commands. A failed preflight leaves execution unauthorized and reports actionable findings.

### Controlled handoff and orchestration

Create a fresh orchestrator process/session for each authorized handoff. Bind the process to the current run, approved artifact revisions, durable decisions, explicit task ownership, and isolated run workspace. Persist the handoff intent before launch and record the actual process/session identity and outcome. Use an idempotency identity so retry after an uncertain launch reconciles the existing attempt rather than starting a duplicate worker. A failed launch remains failed/unknown until checked; it cannot advance the lifecycle based on a ledger phase or text claim.

The supervisor records orchestrator task, review/fix, and verifier evidence but does not execute implementation tasks or commit on the orchestrator's behalf. The orchestrator owns commits. Review iterations continue until an attributable approved review result; only then does the final independent verifier run. If verification fails, send the work back through repair and review, and retry verification only after those gates. No duplicate per-wave final verification or LLM-only approval gate is introduced.

### Permission policy

Read deterministic project rules from the supervisor project config under `.agy/`. Resolve and display the effective policy and its source. Explicit denies and protected-path rules are non-overridable; an allow cannot weaken them. Missing, malformed, conflicting, or unsupported policy configuration fails closed to escalation/manual operation. The runtime adapter must enforce policy against the exact current action using a Stage 0-qualified interface. PTY prompt recognition, terminal screen hashes, or injected keys alone do not satisfy this requirement.

Until Stage 0 establishes an enforceable and action-bound interface for the selected mode, the supervisor may display policy and retain manual interaction, but must not claim it enforced an allow/deny decision or automatically approve an action. No classifier participates in policy evaluation.

### Git isolation, integration, and delivery evidence

Start work in a per-run isolated Git workspace so changes do not modify the user's checkout during execution. Reconcile branch, base revision, worktree status, and resulting commits as run evidence. Assign one owner per writable path for parallel tasks; isolate genuinely overlapping writes separately and define an explicit integration/conflict step. The orchestrator performs commits and integration. Conflicts, unexpected paths, or loss of the base revision stop progression for review or user action.

Record each controlled verification with the exact command, cwd, source revision, start/end status, exit code or signal, and retained output appropriate to the journal's redaction/retention policy. Record reviewer/verifier identity and the result as structured evidence linked to that revision. Compare final changed paths/content scope with the approved plan and record unexpected changes for explanation/review. If the verified revision changes, mark affected evidence stale and rerun the required review/verification chain. Process exit 0 or reported `PASS` does not substitute for this evidence.

### Resume and crash recovery

Expose three separately named concepts in state and behavior: ledger/session reuse, supervisor workflow recovery, and underlying Antigravity conversation resume when the installed runtime supports it. On recovery, reconcile the event journal, process liveness/outcomes, artifact revisions and approvals, Git/worktree state, task ownership, and evidence. Resume only from a state whose required prior evidence is present and still current. A dead PTY is reported dead and restarted only through a deliberate, authorized transition. Unknown outcomes, missing/corrupt journal segments, stale artifacts, changed revisions, and conflicting Git state block the next action or return to a safe human checkpoint. Recovery cannot execute unapproved or stale work.

### User interface and CLI

Keep the existing conversational TUI, decision cards, audit view, terminal takeover, and CLI surface. Present the lifecycle as explicit source-backed states and actions: approval of a spec revision; plan readiness; explicit handoff; active/recovered/stopped process; review/fix; verification; and evidence-backed delivery. Show the selected artifact revisions, effective policy/source, unresolved decisions, preflight findings, handoff identity, and verification revision where relevant. Preserve existing input ownership and factual-status rules. Exact wording and visual details remain an implementation choice, not an editorial-copy approval in this spec.

No new CLI options or launchers are required by this design. The project policy lives in `.agy/` and is read by existing project discovery; new configuration is validated with actionable path/field errors. Any future CLI flag or launcher proposal requires separate user confirmation before it is included.

## Error handling and safe fallback

- If runtime qualification or the native enforcement adapter is unavailable, deny automatic policy enforcement and leave the user in manual control.
- If journal parsing encounters an unsupported, malformed, duplicated, out-of-order, or missing event, record the condition, avoid advancing from untrusted state, and recover from the last valid checkpoint or stop for the user.
- If an artifact revision changes after approval or handoff preparation, invalidate the affected approval and block launch until reviewed again.
- If launch result is uncertain, reconcile process/session identity and journal before retry; do not create a duplicate handoff.
- If recovery cannot prove which task, revision, process, or workspace is current, do not resume execution automatically.
- If a reviewer or verifier reports a result without controlled evidence, retain it as an attributed claim and keep the gate open.
- If verification evidence no longer matches the integrated revision or reviewed diff scope, mark it stale and require the affected gates again.
- Persist policy decisions, checkpoint transitions, retries, approvals, handoffs, denials/escalations, recovery actions, and evidence references in an auditable way while applying journal redaction and retention rules.

## Out of scope

- Stage C repo-grounded automatic question answering and model-based reasoning.
- Stage D classifier-assisted approval, unattended recovery/retry budgets, or bounded autonomy beyond deterministic Stage B rules.
- Stage 0 runtime qualification itself; it remains a prerequisite and separate evidence gate.
- Stage A native Windows/POSIX acceptance work; it remains an open acceptance gate.
- Rebuilding the coding-team plugin or changing its authority model; the orchestrator owns implementation and commits.
- New launcher, CLI flag, network port, remote execution, hosted/multi-user operation, multi-provider support, automatic merge/deployment, or automatic PR creation.
- Exact user-facing editorial copy, release commitments, dates, or effort estimates.

## Acceptance outcomes

1. A representative request maintains one run identity across the approved spec and plan revisions, durable decisions, agent sessions, journal, Git changes, review, verification, and delivery evidence.
2. Spec approval is bound to its exact revision; plan `READY` cannot authorize implementation; material changes invalidate affected approval; failed or repeated handoff actions do not launch duplicate orchestrators.
3. Preflight detects invalid/external paths, missing intended-new-file declarations, conflicting parallel write ownership, and missing verification prerequisites without executing plan commands.
4. The controlled handoff starts a fresh orchestrator with the intended approved revisions and decisions, in a per-run isolated Git workspace, and records the actual session identity.
5. Policy configuration is validated, its effective source/precedence is visible, explicit denies and protected paths cannot be overridden, and an unqualified/unbound runtime action remains manual/escalated.
6. Recovery reconciles journal, artifact revision, process, Git, ownership, and task evidence. An interrupted or failed handoff can recover without executing stale or unapproved work.
7. Review/fix reaches approved review before final independent verification. A failed verification returns through repair/review. Completion requires controlled command/revision evidence and a reviewed diff scope; stale evidence cannot certify a changed revision.
8. The decisions log and audit evidence survive context reset and are not corrupted by repeated events or recovery. Unsupported or malformed events fail safely.
9. Stage 0 qualification and Stage A live acceptance prerequisites are explicitly recorded; no Stage B exit claim relies on unresolved capabilities.

This document specifies intended behavior and acceptance outcomes only. It does not authorize application-code changes. After approval, a separate implementation plan will decompose the work and a plan critic will check it before manual handoff to execution.
