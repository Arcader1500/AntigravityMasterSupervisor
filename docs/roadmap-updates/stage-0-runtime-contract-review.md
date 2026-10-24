# Stage 0 review: qualify the Antigravity runtime contract

**Status:** Incomplete — historical permission paths and configuration cleanup have additional evidence, but current runtime mode/loading, event completeness, replay and reliable nonzero-exit reporting remain unqualified. The Stage 0 exit gate is not met.

**Reviewed:** 2026-10-23  
**Repository:** `main` at `47c79049af5b8da7c12e1dcb3093070f01805478`  
**Roadmap:** [ROADMAP.md — Stage 0](ROADMAP.md#stage-0--qualify-the-runtime-contract)  
**Purpose:** preserve evidence and unresolved probes for the next stage-design work. This review is not an implementation plan or approval to automate permissions.

Sanitized event samples: [stream-json write probe](../../tests/fixtures/stage-0/stream-json-write-probe.jsonl) and [lifecycle hook capture](../../tests/fixtures/stage-0/hook-lifecycle.jsonl). They retain observed event structure while replacing local paths and session IDs. Request-review allow/deny probes are summarized from live output and are not preserved as raw sanitized JSONL, so do not treat those summaries as replay fixtures.

Current read-only discovery on 2026-10-24 found Antigravity CLI `1.4.7` and `antigravity-coding-team` plugin `1.0.0` enabled. `agy --help` exposes `--model`; the listed `--mode` values are `accept-edits`, `auto`, and `plan`, which do not establish the current permission setting. No signed-in interactive acceptance run was performed for this review, so `request-review` is not verified as the current mode. A WSL distro query returned no distro; no POSIX terminal was available for live acceptance. These are discovery results, not permission/runtime qualification.

## Findings

### Local runtime and plugin

| Item | Observed evidence | What it establishes |
| --- | --- | --- |
| Antigravity CLI | `agy.exe` resolved to `C:\Users\athar\AppData\Local\agy\bin\agy.exe`; initial `agy --version` printed `1.4.3`. When the subsequent runtime process started, its language server reported `1.4.6`, and a follow-up `agy --version` also printed `1.4.6`. | Runtime probes below ran on `1.4.6`; initial discovery was on `1.4.3`. Treat this review as version-specific and recheck after CLI updates. |
| CLI modes | `agy --help` lists `--print`, `--output-format` values `text`, `json`, and `stream-json`, and `--input-format stream-json` for print mode. A Sonnet 5.5 stream-json no-tool turn emitted `init`, `step_update`, and `result`; a second turn emitted a `write_file` tool step. | Structured stream events cover the observed response and tool call. One fixture does not establish completeness, all tool output shapes, lifecycle coverage, or duplicate/reconnect behavior. |
| Permission flags | Help lists `--dangerously-skip-permissions` as auto-approving all tool permission requests. | This is an unsafe bypass, not an enforcement mechanism. It is not a candidate for unattended supervisor policy. |
| Coding-team plugin | `agy plugin list` reported `antigravity-coding-team` enabled, version `1.0.0`, with 8 skills, 7 agents, 2 rules, and 1 MCP server. | The target plugin is installed and enabled locally. The listing does not qualify its hook behavior or its agent lifecycle events. |
| MCP entry | The same listing showed `code-review-graph` disabled (`uv run code-review-graph serve`). | This MCP server cannot be assumed to supply runtime events in the current setup. |
| Hook initialization and ownership (historical probe) | CLI startup reported “loaded 1 named hooks from 2 hooks.json file(s).” Both user-level manifests then contained a `munder-hive` hook set with PreToolUse, PostToolUse, PreInvocation, PostInvocation, and Stop triggers; they invoked `C:\Users\athar\HarnessAgents\hive\bin\hive-node.cmd ... agy-hook.cjs`. The coding-team plugin directory had no `hooks.json`. The user clarified that `munder-hive` was residual configuration from a removed orchestrator. | This was legacy user-level configuration, not part of the coding-team integration. The user later removed it and an agent independently checked both manifests; current runtime loading diagnostics remain unconfirmed. |
| Authentication and model selection | The initial sandboxed CLI startup reported “You are not logged into Antigravity” and `Access is denied` loading the stored token from the keyring. An unsandboxed harmless print request using the default model returned `RESOURCE_EXHAUSTED` / HTTP 429 for that model. Repeating the request with `--model=claude-sonnet-5-5-medium` returned `AUTH_OK`, status `SUCCESS`, exit code 0. | The user's sign-in is available to the unsandboxed CLI process, but not to the sandboxed one. Claude Sonnet 5.5 medium was accepted and produced a response. This qualifies a one-turn print invocation only; it does not qualify tool permissions or event completeness. The earlier quota response applied to the default model at that time. |
| Permission mode in probe | Initial stream probes emitted `init.permission_mode: "always-proceed"` without a skip-permissions flag. The user then changed the setting to `request-review`; subsequent print and stream runs emitted `request-review`. | The discrepancy was resolved by the user's settings change. Permission conclusions below apply to the later request-review runs only. See [headless mode](https://www.antigravity.google/docs/cli/headless/) and [permission settings](https://www.antigravity.google/docs/permissions?tab=cli). |

### Existing supervisor boundary

- `src/cli/commands/run.ts` starts one `PtyRunner`, passing through the configured `agy` executable and raw `args`; it does not select a structured output mode or a permission policy.
- `src/pty/runner.ts` exposes PTY data chunks and process exit code/signal. It launches `agy` in the target project directory and copies the process environment.
- `src/telemetry/store.ts` feeds committed terminal lines to `TelemetryParser`; `src/telemetry/types.ts` defines normalized UI telemetry but has no runtime session ID, source provenance, sequence number, or duplicate key.
- Permission decisions are currently inferred from terminal text and answered by PTY keystrokes. This is presentation/input behavior, not evidence of an atomic or policy-enforced approval boundary.
- `package.json` has no Antigravity SDK dependency. The current integration is the CLI plus PTY; SDK suitability and compatibility are not established by this inspection.

## Capability and permission matrix

| Mode | Allow | Deny | Ask / unavailable approval | Workspace boundary | Config loading |
| --- | --- | --- | --- | --- | --- |
| Interactive PTY | One-time Yes approved a harmless `cmd /c echo`; command ran and returned code 0. | User selected No on a second harmless echo request; UI showed “User declined the tool call.” | Approval card appeared in request-review. This establishes the interactive prompt path. | Not qualified interactively. | Normal signed-in user profile used; isolated settings behavior not tested in this mode. |
| Print (`--print`, stream-json output) | Harmless workspace `write_file` ran under request-review and content was read back as `ALLOWED`. | Isolated temp profiles with explicit `permissions.deny` blocked the write; the marker was absent and the output identified a configured deny rule. | A command request without an interactive approver was denied; result included `denied_actions` for `command`. Process status was SUCCESS/exit 0 despite the denied tool. Explicit `permissions.ask` also soft-denied headlessly. | A path under `%TEMP%` was allowed; a path outside workspace and `%TEMP%` was denied and absent. This shows observed CLI boundary behavior for these probes only. | Isolated `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` settings loaded for synthetic deny/ask/allow profiles; normal global settings were not modified. |
| Streaming (`--input-format stream-json --output-format stream-json`) | Workspace write ran under request-review; persistent input stream write also succeeded. | Isolated explicit deny blocked a write and returned `denied_actions`; marker absent. | Command without an approver soft-denied with `denied_actions`; process exited 0. | Same outside-workspace path was denied by the CLI probe. | Synthetic isolated profile rules loaded for explicit deny; `init.permission_mode` reported `request-review`. |

The interactive one-time approval and denial establish that the PTY can surface and submit a decision, but do not establish that a UI parser binds the decision atomically to a stable action identity. Headless `SUCCESS` and exit code 0 do not mean every requested tool ran: inspect the tool step and `denied_actions`. Do not infer unattended permission handling from these results.

### Additional probe evidence

- The authenticated model for runtime probes was `claude-sonnet-5-5-medium`; no skip-all-permissions flag was used. The initial `always-proceed` state was changed by the user to `request-review` before the permission matrix probes.
- Isolated synthetic profiles exercised `permissions.deny`, `permissions.ask`, and an explicit harmless command allow. Deny and Ask blocked writes in headless mode. The explicit allowed command requested `cmd /c exit 7`, but the reported tool error said “Command exited with code 1” and contained no numeric `exit_code`; record nonzero exit propagation as unresolved. Interactive echo established only the zero-exit case.
- An isolated PreToolUse hook successfully denied a harmless write using the CLI hook response `{decision:"deny",reason:"..."}`; the marker was absent. A malformed hook command and an unsupported `hookSpecificOutput` response both failed closed. The top-level response schema is documented in [Antigravity hooks](https://antigravity.google/docs/hooks).
- A synthetic print-mode lifecycle hook captured `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, then a second `PreInvocation`/`PostInvocation` pair and `Stop`. The Stop payload included `terminationReason:"NO_TOOL_CALL"` and `fullyIdle:true`. This is one observed sequence, not proof of complete lifecycle coverage.
- A second synthetic-profile run exercised lifecycle hooks through an interactive invocation and produced a harmless `write_file` event; this is represented in the sanitized lifecycle fixture. That run took place after the first-run setup screen was exited; no Terms of Service or optional interaction-data consent was accepted.
- At the time of the original probe, the `munder-hive` handler was a residual from a removed orchestrator, per the user. Static inspection found that it returns without action when `AGENT_ID` or `HIVE_SOCK` is absent; otherwise it sends tool/session data over a local socket and interprets returned directives. The probe shell lacked those variables, but the CLI hook subprocess environment was not captured. The later user cleanup and manifest check are recorded below; current runtime loading remains unconfirmed. This is not an intended coding-team capability.

### Post-approval user evidence — 2026-10-24

The user reported removing the residual `munder-hive` entries and supplied two native CLI terminal excerpts. The user confirmed that the first run displayed a permission prompt they approved, and that `request-review` was enabled for both captured runs. The commands requested `cmd /c echo STAGE0_DENY_CHECK`; the marker text alone does not determine whether a command ran.

- **Allow:** the supplied expanded native tool output reports `Command exited with code 0` and prints `STAGE0_DENY_CHECK`. The user confirms explicitly approving the prompt. This is direct user-provided terminal evidence of this harmless command executing with numeric exit 0; it is not a structured-event fixture captured by this repository.
- **Deny:** the supplied expanded native tool output reports `permission check failed` for that command and says permission was denied, followed by `User declined the tool call` and an interrupted prompt. This is user-provided evidence of the observed interactive decline path.
- **Configuration cleanup:** a subsequent read-only check parsed both exact hook manifests as JSON and found no `munder-hive` property. The user made the edits; no agent changed global configuration. No current CLI startup diagnostic was supplied, so runtime hook loading remains unconfirmed.

This addendum addresses the basic cleanup check, one interactive allow/deny path, and a numeric-zero result for those captures. It does not establish the current permission mode, the CLI/plugin version used for the captures, atomic action binding, nonzero exit propagation, cross-mode parity, workspace/configuration coverage, or event ordering/replay. The later read-only discovery above found `agy 1.4.7`; it does not identify the version used in the captures. Do not repeat the same basic cleanup or interactive echo flow solely because the planning agent lacked signed-in access. Stage 0 remains incomplete.

## Integration assessment

1. **Keep the current PTY while qualifying alternatives.** It is the working human interaction path. Do not remove the parser based on help output or a plugin manifest.
2. **Probe stream-json first as the structured-event candidate.** It is explicitly advertised by the installed CLI and fits a CLI integration, but it must demonstrate authoritative tool, permission, and lifecycle events before it can drive control state. Keep PTY attached for human interaction and any documented coverage gaps.
3. **Inspect and probe hooks separately.** Local startup confirms hook files are loaded, but does not reveal whether hooks cover interactive and noninteractive modes or whether a hook can block an action synchronously. Do not make permission policy depend on them until these properties are demonstrated.
4. **Defer an SDK choice.** The repository is Node/TypeScript, but this inspection found no SDK integration or compatibility evidence. Compare any SDK only after its supported runtime, event coverage, and agent/plugin compatibility are demonstrated against the installed CLI/plugin.
5. **Keep all approval paths human-operated until a mode-specific allow/deny/ask matrix proves enforcement.** If an approval cannot be observed and bound to the exact action/session, treat it as unavailable and stop for the user.

These are provisional investigation choices, not a versioned event contract or a completed Stage 0 architecture decision.

## Event contract requirements for the next review

Any selected source must be normalized into versioned events that retain:

- run and underlying session/conversation identity;
- source/provenance and schema version;
- source ordering plus receive time, with explicit handling for reconnects and out-of-order delivery;
- stable duplicate detection, including replay behavior;
- event kind and typed action/result data, without interpreting captured agent text as instructions;
- explicit parse/unsupported-event errors and a safe fallback to human control.

The append-only JSONL journal still needs a concrete redaction and retention policy. It must avoid secrets and preserve only the normalized evidence needed for replay and crash reconstruction. Real sanitized session fixtures should cover event and narrator regression checks.

## Remaining probes before Stage 0 can pass

Run these only in a disposable, isolated workspace with harmless fixture actions and a usable authenticated CLI environment. Record exact CLI/plugin versions, commands, inputs, raw sanitized outputs, exit statuses, and resulting filesystem changes. Do not use skip-all-permissions.

1. Complete remaining cross-mode cells: interactive ask/unavailable approval and workspace-boundary/config behavior; compare print and stream allow/deny/ask with equivalent actions. Preserve sanitized raw captures for those outcomes.
2. Capture current CLI startup diagnostics after the user-confirmed hook-manifest cleanup to establish which hooks the installed CLI actually loads. The configuration check is addressed; runtime loading is not confirmed. This is environment evidence, not a coding-team plugin change.
3. Compare structured stream events with PTY output for numeric zero/nonzero child exit, event identity/order, completeness, reconnect/replay, and duplicate handling. The command-exit-7 vs reported-exit-1 mismatch remains open.
4. Establish event contract and source precedence, including schema versioning, redaction/retention, parse/unsupported-event handling, and safe PTY fallback. Add sanitized real fixtures for permission-denial outcomes.
5. SDK suitability remains deferred unless a concrete candidate is proposed; if proposed, verify Node/TypeScript and installed coding-team plugin/agent compatibility.

## Exit-gate decision

**Not passed.** Historical request-review runs observed harmless interactive approval/decline, headless allow/deny/ask soft-denial, configured deny/ask rules, workspace boundary behavior, hook denial/fail-closed behavior, and synthetic lifecycle sequences in print and interactive invocations. The user later confirmed `request-review` for the two supplied interactive captures and supplied evidence of an approved echo with numeric exit 0 and a denied echo. The user also removed the residual `munder-hive` entries, and a subsequent agent check confirmed both manifests were valid JSON without that property. Current read-only discovery found `agy 1.4.7`, but did not verify its active permission mode or loaded-hook diagnostics. Remaining gaps include current mode/loading confirmation, comparable cross-mode coverage, event identity/replay/duplicate/completeness, reliable nonzero exit reporting, and a versioned event contract with journal policy and permission-denial fixtures. Do not use runtime events or permissions for automation in Stage B or later until these gaps are addressed.

## Evidence limits

- Commands observed: `agy --version`, `agy --help`, `agy plugin list`, agent/MCP listing commands, interactive TUI, print-mode and persistent stream-input probes, plus isolated synthetic profiles. Default-model request returned quota error, exit code 3. Authenticated runtime probes used `--model=claude-sonnet-5-5-medium`. Later interactive, print, and stream runs reported `request-review`; see matrix and additional probe evidence for outcomes. Temporary hook/profile artifacts were created for controlled probes; source code and global settings were not changed.
- The initial sandboxed CLI process could not access the Windows keyring or user-level log/crash paths and lacked network access. The later unsandboxed probe could authenticate/reach the service. No credentials or authorization codes were captured in the review document.
- This was read-only source inspection, user-authorized CLI probing, and documentation/fixture work. No application source, global configuration, ledger, or runtime integration was changed. No tests/build were run because no implementation changed; runtime behavior was probed directly as described above.
