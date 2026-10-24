# Assessment of the preliminary architecture review

Reviewed 2026-10-23. This assessment revises the [v1.0 roadmap](roadmap-updates/ROADMAP.md); it does not authorize or implement the roadmap stages.

The review has substantial merit, especially its distinction between terminal presentation and an enforceable control protocol. Several concerns were already represented in the roadmap, but runtime qualification, deterministic-first permission handling, replay, decisions handoff, and measurable autonomy needed stronger and earlier gates.

## Findings and disposition

| Review point | Assessment and roadmap response |
| --- | --- |
| Replace scraping with supported structured interfaces where possible | Accept the direction, conditional on demonstrated coverage. Added Stage 0 before further control automation. Keep the PTY for interactive use and retain parser fallbacks until replacement coverage is proven. |
| Headless permission reports conflict | Treat reports as hypotheses, not facts about this installation. Require harmless allow/deny/ask probes per version/mode, including workspace configuration loading. Never assume headless is safe simply because it exits zero. |
| Start permissions with rules, not a model | Accept. Moved deterministic enforcement into Stage B, independent of Stage C reasoning. Optional classification stays in D and cannot override denies. |
| Worktree, secret denial, network controls | Accept with qualification: a worktree separates edits but is not a security sandbox. Runtime controls must separately enforce access and any feasible network restrictions. |
| Screen hash before Ctrl+K | Helpful stale-state detection, insufficient authorization binding. A screen can change after checking. Prefer native action-bound permission hooks; leave automatic key injection disabled when atomic binding cannot be established. |
| Independently verify DONE and scope | Accept. Require controlled command results tied to the delivered revision and review of unexpected diff scope. Keep the existing reviewer/fix/final-verifier cadence; do not introduce redundant final checks on every wave. |
| Deterministic plan checks before another LLM audit | Accept. Check path intent, parallel ownership conflicts, and command prerequisites. Planned new files need not already exist, and preflight must not blindly execute arbitrary commands. |
| Evidence and veto for automatic interview answers | Accept. Present the answer/evidence/assumption record at spec approval and persist it for the execution agent. |
| Crash resume from checkboxes and Git | Accept the need, strengthen the method: reconcile journal, artifact revisions, Git, and execution evidence. Checkboxes alone are insufficient; a dead PTY is not recoverable as a live process. |
| Stall/loop detection and budgets | Accept. Explicit attempt/time budgets and usage limits where observable; unavailable monetary accounting must be disclosed rather than invented. |
| Worktree for every parallel task | Conditional. Require isolated concurrent writes and a conflict/integration policy, but do not mandate worktrees for read-only or disjoint tasks. Reverify integrated changes when previous evidence becomes stale. |
| Append-only JSONL and replay | Accept. Bring a versioned, redacted event journal and real-session fixtures into Stage 0, with ordering, provenance, retention, and duplicate handling. |
| Fixed requests and interruption metrics | Accept. Add 5–10 initial evaluation requests, starting at Stage B, with correctness and approval failures measured alongside interruption count. |
| Build permissions and gates before more TUI work | Accept for future work. Preserve the implemented UI and fix known trust defects; do not undo it merely because the original milestone order was imperfect. |
| Add named skills | Adopt the practices where useful, not a mandatory skill dependency. Verification, evidence-driven debugging, isolation, and safe parallel ownership are outcomes. Installing skills or changing the related coding-team plugin is outside this documentation revision. |

## What was verified, and what remains unproven

The local executable at `C:\Users\athar\AppData\Local\agy\bin\agy.exe` reports **1.4.3**. Read-only `agy --help` confirms `--output-format` with JSON/streaming formats, streaming input, `--conversation`, `--continue`, `--sandbox`, and a separate skip-permissions option. Flag availability is not proof of enforcement or complete event coverage.

The current [headless documentation](https://www.antigravity.google/docs/cli/headless/) describes structured output and policy-based permission handling. It says unavailable approvals can be soft-denied while the process still exits zero, so exit status alone cannot establish completion. This differs from the review's unqualified report that print mode approves everything; local behavior still needs testing.

The [CLI hooks documentation](https://www.agy.dev/docs/hooks?tab=cli) describes interactive hook inspection and workspace/global/plugin hook configuration. The [hook contract](https://antigravity.google/docs/hooks) documents pre/post tool events and permission decisions. These are credible alternatives to investigate, not proof that all prompts, subagents, cancellation, or permission events are observable on the installed build.

An [SDK exists](https://antigravity.google/docs/sdk/lifecycle), but its documented Python API is not an automatic fit for this native Node/TypeScript project or proof it can preserve the existing coding-team plugin. SDK selection remains an architectural decision.

No model-driven tool probes, destructive permission tests, hook installation, settings changes, runtime migration, or SDK dependency changes were performed. The mode matrix and live coverage tests are explicit Stage 0 deliverables. Historical architecture/spec documents remain historical inputs; the roadmap and this assessment record the revised direction.
