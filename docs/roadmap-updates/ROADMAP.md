# Antigravity Master Supervisor: roadmap to v1.0

Status: proposed roadmap for stage selection. Historical roadmap review: 2026-10-23 against `main` at `47c7904`; package version `0.1.0`. Documentation updated 2026-10-24 against the Stage A working tree based on `47c79049af5b8da7c12e1dcb3093070f01805478`. Revised after the [external architecture review](../architecture-review-response.md).

This is a product roadmap, not an implementation plan. Stages describe capabilities, boundaries, dependencies, and evidence required to call them complete. Selecting a stage starts a separate design and planning exercise. Version labels below are proposed milestones, not release commitments or estimates.

## What v1.0 should mean

A developer can give the supervisor a request, settle the product decisions the repository cannot answer, approve the spec, and follow the work through planning, implementation, review, repair, and independent verification to a reviewable development branch. The supervisor preserves context and decisions, shows what actually happened, and offers explicit control over how much it handles autonomously.

The product remains a local terminal application over the existing Antigravity coding-team workflow. It should earn trust as a reliable control layer before promising unattended execution. A successful agent process exit is not proof of successful delivery.

The intended experience remains the conversational TUI: one supervisor voice, inline decisions, team rail, agent zoom, and terminal takeover. The older four-panel dashboard and escalation-modal designs are historical predecessors, not additional interfaces to build.

## Current position

| Area | Evidence-backed position | Remaining boundary |
| --- | --- | --- |
| Foundation and packaging | CLI entry points, doctor, ledger, PTY runner, SDK exports, build and publish workflow exist. | Registry availability, successful remote publishing, and clean-machine installation were not verified in this review. |
| Interactive control and telemetry | Virtual terminal, passive parser, Git/artifact polling, raw passthrough, and live input routing exist. | Parsed output is an observation, not an authoritative lifecycle protocol; parallel activity and output-format changes need stronger evidence. |
| Conversational TUI | Narrator, transcript, composer, cards, rail, zoom, overlays, takeover, and fallback themes are implemented. Stage A adds measured transcript anchoring, bounded resize behavior, local input-delivery feedback, and factual process presentation. | Independent review approved; 403 tests, typecheck and build passed. Representative Windows/POSIX live acceptance remains open. See the [Stage A review](stage-a-interactive-baseline-review.md). |
| Framing and fresh-session fixes | All seven tasks in the latest October 19 plan have implementation commits on October 20. Includes framing, session filtering, ledger reset, `--resume`, and keyboard/card fixes. | Checkboxes were not maintained; implementation coverage does not establish defect-free behavior. |
| Supervisor intelligence | Permission and question cards support human responses. Supervisor prose is generated from templates. | No repo-grounded supervisor reasoner or automatic permission classifier is implemented. |
| Workflow orchestration | One selected `agy` process runs; ledger and parser signals drive presentation. | No complete planner-to-orchestrator process handoff, enforced approval lifecycle, or recovery controller exists. |
| Delivery evidence | Tests, build, and typecheck exist; audit history documents previous review/fix cycles. | Completion presentation does not yet require actual reviewer and verifier evidence. |

The pre-Stage-A baseline in this chat ran 310 tests across 21 suites successfully, plus `npx tsc --noEmit` and `npm run build`; tests passed outside the filesystem sandbox with Unicode terminal mode enabled. This is historical baseline evidence. Stage A's independent review, final 403-test pass, typecheck/build results and unrun live gates are recorded separately in the [Stage A review](stage-a-interactive-baseline-review.md); they do not prove a complete live `agy` workflow.

The Stage A review records the status of these earlier trust gaps and the evidence for their fixes:

- transcript scrolling now uses measured rows and stable source anchors; live navigation acceptance remains open;
- a ledger phase change is not presented as proof that a fresh orchestrator process started;
- process exit and legacy `COMPLETED` are not presented as proof of review or verification.

## Stages

| Stage | Proposed milestone | User-visible outcome | Depends on |
| --- | --- | --- | --- |
| 0 | Architecture qualification | Supported runtime events and permission behavior are established before automation depends on them. | Installed `agy` and existing implementation |
| A | v0.2: trustworthy interactive baseline | The interface is usable and reports only what it can substantiate. | 0 for event-contract decisions; UI fixes can proceed independently |
| B | v0.3: controlled development lifecycle and policy | A request travels through explicit checkpoints and a real handoff, with deterministic permission controls. | 0 and A |
| C | v0.4: assisted supervisor decisions | The supervisor answers routine questions from evidence and escalates meaningful uncertainty. | B |
| D | v0.5: bounded autonomy | Recovery and optional classification reduce interruptions within explicit limits. | B; C only for model-assisted decisions |
| E | v0.9: release candidate | Installation, compatibility, recovery, and delivery are proven under representative use. | A–D |
| F | v1.0: supported release | A documented, stable, supportable supervisor delivers the full agreed workflow. | E release gates |

### Stage 0 — Qualify the runtime contract

**Outcome:** the supervisor has an evidence-backed integration strategy, rather than assuming rendered terminal output is a reliable control protocol.

Evaluate structured headless events, interactive pre/post tool hooks, permission callbacks or rules, and any SDK integration against the installed `agy` version and coding-team plugin. Prefer supported structured events for authoritative tool, permission, and lifecycle facts; keep the PTY for human interaction and use parsing only for explicitly identified coverage gaps. Do not discard the working parser until equivalent coverage is demonstrated. An SDK migration must preserve the project's Node/TypeScript and existing-agent constraints or justify a deliberate change.

Permission behavior is qualified separately for interactive, print, and streaming modes: allow, deny, ask, unavailable approval, workspace boundaries, and configuration loading. Probes use harmless fixture actions in an isolated test workspace. Neither documentation nor reports about another version establish local behavior. An unattended mode that cannot enforce the chosen policy is unsupported; a skip-all-permissions flag is not an integration solution.

Define a versioned event contract with run/session identity, ordering, provenance, and duplicate handling. Persist the necessary normalized events in an append-only JSONL journal, with redaction and retention rules, so replay and crash reconstruction are possible without retaining secrets or treating captured agent text as instructions. Preserve real sanitized session fixtures for event and narrator regression checks.

**Exit gate:** a capability/mode matrix and recorded probes establish what is observable and enforceable, including denied tools and nonzero/zero exit outcomes. Any unobservable or non-atomic approval path remains human-operated. The selected integration has recorded-session replay evidence and explicit failure behavior for lost, malformed, duplicated, or unsupported events.

**Boundary:** local `agy 1.4.3 --help` confirms structured-output and conversation flags; public documentation describes hooks. Interactive hook coverage, event completeness, actual permission semantics, and SDK suitability still require qualification. This stage is a bounded architectural decision, not a wholesale rewrite or an implementation plan.

### Stage A — Trustworthy interactive baseline

**Outcome:** users can rely on the current application while continuing to operate the underlying agents themselves.

Scope includes transcript scrolling and clipping, decision focus and input delivery, resize behavior, terminal entry/exit cleanup, and understandable pause/resume behavior on Windows and POSIX. Status copy distinguishes observed activity, inferred progress, actual process changes, and confirmed outcomes. Unknown review or verification results remain unknown.

Progress records gain a clear distinction between historical plans, implemented capabilities, known defects, and future architecture. The README describes the actual conversational interface and current flags. The existing session filter is described as an artifact-discovery heuristic, not proof of artifact ownership.

Further visual polish is secondary to reliable event input, enforceable spec approval, and truthful delivery status. Retain the UI already built rather than restarting the presentation project.

**Exit gate:** representative live interactive sessions remain navigable, accept responses once, and restore the terminal cleanly; scrolling regressions are covered; the UI never announces a process handoff or verification result without evidence. The standard suite, full typecheck, and build pass.

**Boundary:** no new autonomous approvals or reasoning engine. This stage stabilizes and accurately describes what already exists.

### Stage B — Controlled development lifecycle

**Outcome:** the supervisor controls the journey between agents, rather than merely displaying a running CLI.

The lifecycle ties the original request, current spec and plan, their revisions, approvals, agent sessions, and delivery evidence to the same run. Spec approval is enforceable. Plan readiness is distinct from implementation permission. A controlled handoff starts a genuinely fresh orchestrator with the intended approved artifacts and relevant decisions.

A durable decisions log travels with the approved artifacts. Accepted answers, evidence, assumptions, unresolved questions, and later revisions survive the context reset. Approval is tied to an artifact revision; material changes invalidate the affected approval. Deterministic plan preflight checks path validity (distinguishing existing paths from intended new files), parallel write-ownership conflicts, and verification-command prerequisites without executing arbitrary plan commands as a validation shortcut.

Permission control begins here with deterministic allow/deny/escalate rules over the qualified runtime interface; model classification is optional later. Protected paths such as `.env*` and explicit denies are enforced at the runtime boundary, not merely mentioned in prompts. Policy and configuration precedence are visible and audited. Native runtime enforcement is preferred to injected terminal approval keys.

Resume distinguishes supervisor-ledger reuse, recovery of a workflow, and any supported underlying `agy` conversation resume. Restart, cancellation, a failed handoff, or a stale artifact cannot silently execute the wrong plan. Repeated actions do not create duplicate workers or duplicate handoffs.

Crash recovery reconciles the event journal, approved artifact revisions, Git state, and task evidence; plan checkboxes alone do not certify completed work. A dead PTY is restarted deliberately, not described as still alive. Per-run Git isolation protects the user's checkout; concurrent writers have explicit ownership or separate worktrees and a defined integration/conflict policy. Worktrees do not contain file access, secrets, or network activity. Per-task worktrees are an option for genuinely overlapping parallel work, not a universal requirement for every task.

The orchestrator continues to own task execution and commits. Its review/fix loop runs until approved, followed by final independent verification. The supervisor records and validates those outcomes without becoming a second implementation orchestrator. Verification failures return through fixes and review before verification is retried.

Agent `DONE`, reviewer prose, and verifier prose are claims until associated with evidence. A controlled verification runner records actual command, working directory, revision, exit status, and output, and the supervisor checks that evidence before delivery. Compare the final diff with approved scope; unexpected changes need explanation or review rather than a brittle exact-file allowlist. If integration changes the verified revision, affected verification is stale. No duplicate per-wave final verification or extra LLM-only approval gate is required.

**Exit gate:** a representative request reaches spec approval, critic `READY`, explicit handoff, implementation, review/fix, final verification, and a reviewable branch. A failed or interrupted handoff can be resumed without running unapproved or stale work. Deterministic policy respects explicit denies, and the decisions log survives handoff. Completion is supported by command/revision evidence and reviewed diff scope, not an agent assertion or process exit alone.

**Boundary:** manual handoff is the proposed default. Automatic handoff is a separately selected autonomy policy, not an extra mandatory plan-approval checkpoint after `READY`.

### Stage C — Assisted supervisor decisions

**Outcome:** the supervisor saves the user routine investigation while preserving their authority over product choices.

A repo-grounded reasoner can answer questions about established conventions and accepted requirements, explain the evidence used, and retain answers and assumptions for later stages. Product intent, conflicting evidence, security-sensitive choices, and uncertain answers reach the user as inline decision cards. Unsupported answers are not injected into the agent terminal.

Checkpoint 1 presents the automatic answers, their evidence, and resulting assumptions together for user correction or veto before spec approval. Accepted answers enter the durable decisions log. A second model's agreement does not substitute for deterministic preflight or independent execution evidence.

The reasoner can compare a spec or plan with the accepted request and flag omissions or scope drift. It supplements the planner and critic; it does not silently override their verdicts or add another mandatory approval ceremony. Timeouts, malformed responses, unavailable credentials/quota, and cancellation fall back to human operation.

**Exit gate:** representative recorded and live questions demonstrate correct evidence-backed answers and appropriate escalation. Every automatic answer is attributable and auditable; ambiguous questions remain unanswered until resolved. The whole workflow remains operable with reasoning disabled or unavailable.

**Boundary:** the old architecture's `supervisor.md` invocation and context strategy are design candidates. Their exact runtime contract must be established when this stage is planned.

### Stage D — Bounded autonomy and recovery

**Outcome:** users can opt into fewer interruptions without surrendering control of approvals, scope, or delivery.

Permission handling separates recognition of the pending prompt, policy evaluation, and the actual response. Automatic approval is limited to an explicitly enabled policy and the exact current action. Unknown, changed, destructive, or otherwise restricted actions are escalated. Classifier uncertainty cannot grant permission. Decision records retain the action, reason, policy, and result; “handled for you” counts reflect actual actions.

Use deterministic rules first. A classifier may recommend escalation or classify ambiguous cases within the explicit policy; it cannot override a deny or independently authorize unrestricted destructive commands. Approvals bind to structured action/session identity and arguments at the enforcement boundary. A terminal screen hash can detect some stale observations but cannot make check-then-keystroke injection atomic; without a proven binding, automatic keystroke approval stays disabled. Filesystem restrictions, secret denial, and network restrictions where feasible are separate controls whose effective boundaries must be demonstrated.

Recovery detects credible stalls, failed tasks, and repeated failures, offers bounded diagnosis/retry, and escalates when its budget is exhausted. User pause, cancellation, shutdown, and takeover have clear precedence. Windows soft pause is not represented as an OS-level process freeze.

Bound repeated commands and recovery attempts, elapsed time, and token/cost consumption when the runtime exposes reliable usage. If monetary usage is unavailable, state that limitation and enforce observable time/attempt ceilings. Blocked-task triage follows evidence-driven diagnosis rather than repeated speculative fixes. Scope changes return to planning.

**Exit gate:** allowed routine actions can proceed under the chosen policy; denied or uncertain actions cannot. Stale and duplicate prompts cannot trigger a second approval. Recovery respects attempt/time limits, stops on cancellation, and leaves a readable audit trail. Human control remains available throughout.

**Boundary:** no unlimited retry, silent scope changes, automatic merging, or unrestricted approval engine. The `jev` name and sub-200ms latency in the architecture are aspirations, not established integration or performance guarantees.

### Stage E — Release candidate and operational proof

**Outcome:** someone outside the development workspace can install and complete the workflow reliably.

The supported Node, OS, terminal, `agy`, and coding-team plugin combinations are explicit and tested. Real planner/orchestrator traces become regression evidence for prompt recognition, parallel work, role attribution, and lifecycle outcomes. Long sessions, missing artifacts, unexpected CLI output, crashes, and unavailable reasoning services have understandable behavior. Unrecognized runtime output fails back to user control.

Maintain a small fixed evaluation set (initially 5–10 representative requests) from Stage B onward, including failure and escalation cases. Measure successful verified delivery, missed or incorrect approvals, user interventions by reason, automatic-answer corrections, time, retries, and available usage/cost. Compare against manual operation and earlier stages. Fewer interruptions count as improvement only when correctness and approval boundaries hold; record acceptable release thresholds when the evaluation set is designed.

State retention, schema compatibility, audit redaction, and secret handling are defined. CLI/SDK stability boundaries are deliberate rather than accidental exports of every component. Distribution is tested from the packaged artifact on clean environments, including native PTY dependency installation. CI covers the declared platform matrix and full typecheck as well as tests/build; release publication follows an intentional release policy.

**Exit gate:** fresh-install and representative live end-to-end acceptance pass on every declared supported platform; interrupted runs recover safely; no unresolved defect can bypass approvals, misreport verification, lose accepted decisions, or strand the terminal. Release instructions and troubleshooting are exercised from the shipped package.

**Boundary:** existing CI configuration is evidence that a pipeline was authored, not evidence of successful remote runs or registry publication.

### Stage F — v1.0 release

**Outcome:** a supported release with a clear contract for users and future changes.

Release requires a stable CLI and deliberately scoped SDK, documented configuration and autonomy defaults, upgrade/state-migration guidance, compatibility policy, troubleshooting, and known limitations. Acceptance evidence covers both the normal lifecycle and the important failure paths. The final delivery identifies the branch/commits, actual review verdict, final verification results, unresolved concerns, and any remaining user action.

**Exit gate:** Stage E evidence is accepted, no release-blocking issues remain, version metadata and distribution agree, and a fresh installation reproduces the documented experience. Publishing v1.0 is a separate authorized release action; this roadmap does not publish anything.

## Decisions to settle when choosing a stage

| Decision | Proposed starting position | Needed by |
| --- | --- | --- |
| Runtime event/control transport | Prefer qualified structured events/hooks; preserve PTY for human interaction and documented fallback gaps. | 0 |
| Checkpoint authority | Human approves the spec; critic `READY` ends planning; manual handoff starts execution. | B |
| Automatic handoff | Optional policy chosen explicitly; do not assume it from the original architecture. | B/D |
| Reasoner invocation and context | Prefer a small explicit runtime contract and persistent decision record; evaluate stateless versus resumed calls against actual `agy` support. | C |
| Permission policy | Deterministic enforcement first; human-operated by default; opt-in automation cannot override deny rules or delivery gates. | 0/B; optional classifier in D |
| Parallel write isolation | Per-run isolation; explicit task ownership, with separate task worktrees where required and verified integration. | B |
| Blocker recovery | Bounded triage/retry within the approved scope; scope or plan changes return to planning and appropriate approval. | D |
| Compatibility promise | Select the supported matrix from demonstrated use; cross-platform code alone does not establish support. | E |

These are proposed product defaults, not newly approved specifications. A prior workflow preference for manual handoff and review-before-verification exists in the related coding-team project; it is context for this proposal, not proof of a current supervisor contract. Resolve the conflict with the original automatic-handoff architecture during Stage B design.

## Scope limits for v1.0

Keep the release focused on one local request/workspace workflow and the existing Antigravity agent hierarchy. Fleet scheduling, hosted dashboards, multi-provider agent platforms, multi-user collaboration, remote execution, and automatic PR merge/deployment are outside the proposed v1.0 contract. Do not rebuild the underlying coding-team plugin inside this repository.

No dates or effort estimates are assigned before a stage is selected and properly scoped. Release quality is evidence-based, not a percentage inferred from unchecked plan boxes or lines of code. Stage E compatibility and acceptance evidence should accumulate throughout the earlier stages.

**Recommended first selection: Stage 0.** Qualify events and permission enforcement before committing to more parser-based control. Stage A implementation has independent review approval and passing automated verification (403 tests, typecheck and build); native Windows/POSIX live acceptance remains open. Do not infer Stage B readiness from these implementation results.

## Documentation and evidence map

| Source | How to interpret it |
| --- | --- |
| [README](../../README.md), `package.json`, `.github/workflows/publish.yml` | Current entry points and interface description, package identity, and authored release infrastructure. |
| [Architecture](../antigravity_master_supervisor_architecture.md) and its `.src.html` / `.html` visual companions | Long-term ambition and open decisions. Milestone 2 “in progress,” four-panel navigation, and escalation modals are stale relative to the conversational redesign. |
| [Foundation spec](../superpowers/specs/2026-10-18-supervisor-foundation-design.md) and [plan](../superpowers/plans/2026-10-18-supervisor-foundation-plan.md) | Implemented foundation, not remaining roadmap work. |
| [Interactive TUI spec](../superpowers/specs/2026-10-18-interactive-tui-and-telemetry-design.md) and [plan](../superpowers/plans/2026-10-18-interactive-tui-and-telemetry-plan.md) | Implemented telemetry/control foundation; original panel design superseded. Explicitly deferred intelligence and automated handoff. |
| [UX specification](../tui-design/agysup%20TUI%20UX%20and%20UI%20spec.md) and neighboring mockups | Product experience target. Mockups and screenshots illustrate design/history; they do not prove current runtime behavior. |
| [Conversational redesign spec](../superpowers/specs/2026-10-19-agysup-tui-redesign-design.md) and [plan](../superpowers/plans/2026-10-19-agysup-tui-redesign-plan.md) | Presentation/narration implementation. Explicitly excludes the reasoner, classifier, and multi-PTY respawn engine. Draft labels are not reliable progress indicators. |
| [Framing/session spec](../superpowers/specs/2026-10-19-tui-framing-and-session-scoping-design.md) and [plan](../superpowers/plans/2026-10-19-tui-framing-and-session-scoping-plan.md) | Historical framing/session implementation; current measured-scroll status is in the Stage A review. |
| [Foundation forensic audit](../audit-report.md) | Historical foundation quality/process evidence and lessons; its 54-test snapshot is not the current test count. Plugin-side recommendations belong to the plugin unless separately scoped here. |
| [Session-trace handoff](../agy-session-trace-handoff.md) | Useful planner/executor trace index. Its framing “planner-only” statement is contradicted by October 20 implementation commits. |
| [Stage 0 runtime review](stage-0-runtime-contract-review.md) and [Stage A evidence review](stage-a-interactive-baseline-review.md) | Current evidence boundaries, open Stage 0 gate, approved Stage A implementation, passing automated checks and remaining live acceptance. |
| `src/`, `tests/`, Git history and this chat's earlier verification | Primary evidence for what exists now. Tests support scoped claims, not unimplemented autonomy or live workflow correctness. |

Historical specs and plans are retained unchanged. This roadmap supplies the current synthesis; it does not retroactively certify their checklist steps or approve future stage designs.
