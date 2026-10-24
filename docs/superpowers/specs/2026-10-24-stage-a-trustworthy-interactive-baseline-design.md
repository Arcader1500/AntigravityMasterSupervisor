# Stage A: trustworthy interactive baseline

Date: 2026-10-24  
Status: approved by the user in this chat on 2026-10-24  
Repository baseline: `main`, `47c79049af5b8da7c12e1dcb3093070f01805478`  
Roadmap: [Stage A](../../roadmap-updates/ROADMAP.md#stage-a--trustworthy-interactive-baseline)  
Runtime evidence: [Stage 0 review](../../roadmap-updates/stage-0-runtime-contract-review.md)

## Goal and confirmed requirements

Make the existing conversational terminal interface navigable, reliable to operate, and accurate about what the supervisor knows. Users continue to operate the underlying agent themselves.

The user confirmed that “Stage 1” means roadmap Stage A. Remaining Stage 0 qualification is a separate gate, not an implementation prerequisite for these independent fixes. Stage A completion does not close Stage 0 or authorize Stage B runtime control.

The user approved factual wording such as “Agent process exited with code 0”, “Phase inferred from agent output”, and “Review and verification not confirmed”, and removal of the fresh-orchestrator message until a new process is actually launched. Apply that wording approach consistently to transcript, header, team rail, audit view, help, and documentation. A source-specific variant must name the actual source: artifact-derived progress is inferred from artifacts, not from agent output.

Keep the conversational transcript, composer, inline decisions, team rail, zoom, artifact overlays, and terminal takeover. Preserve current CLI entry points, flags, keyboard bindings, and manual permission decisions. No new launchers, ports, flags, information architecture, or autonomous behavior are proposed.

## Evidence and present defects

These are current source findings, not newly executed acceptance results.

| Finding | Source evidence | Design consequence |
| --- | --- | --- |
| Scrolling clamps by entry count while choosing visible content by estimated rows; text height ignores explicit newlines. | `src/tui/components/Transcript.tsx:10`, `:306`; PageUp/PageDown/End in `src/tui/App.tsx:480`. | Use one consistent display-row model for layout and scrolling. |
| Resize changes App dimensions and separately resizes PTY/virtual terminal, but tests do not establish live TUI reflow. | `src/tui/App.tsx:66`, `:331`; `src/tui/index.ts:238`. | Cover layout reflow, terminal propagation, and listener cleanup together. |
| CRLF suppression, focus selection, paused FIFO input, raw-mode cleanup and platform-specific signals already exist. | `src/tui/App.tsx:529`; `src/tui/transcript-store.ts:218`, `:252`, `:471`; `src/tui/index.ts:259`; `src/pty/raw-passthrough.ts`. | Preserve working behavior and cover timing/ownership gaps; do not replace it wholesale. |
| Both CLI run and TUI PTY-exit handling write `COMPLETED` on process exit 0. | `src/cli/commands/run.ts:156`; `src/tui/index.ts:311`. | Both writers must distinguish process outcome from delivery. |
| A ledger phase transition emits a fresh-orchestrator assertion; `COMPLETED` generates “All checks passed” and completes running cards. | `src/tui/narrator.ts:628`; `src/tui/narrator-copy.ts:5`, `:127`. | Ledger phase and process exit must not manufacture approval, handoff, review, or verification. |
| Header completion checkmarks and rail reviewer state can also imply unsupported success. | `src/tui/components/HeaderBar.tsx:139`; `src/tui/components/TeamRail.tsx:179`; audit status in `src/tui/components/AuditLogView.tsx:31`. | Truthful presentation applies to every surface, not just the completion card. |
| The parser translates critic `READY` to `DONE` and derives command/test/verdict facts from terminal text. | `src/telemetry/parser.ts:313`, `:457`. | Keep reported readiness distinguishable from approval, execution permission, and verified delivery. |
| Artifact pollers can promote `IDLE` into `EXECUTING` from discovered tasks. | `src/telemetry/poller.ts:346`; `src/telemetry/store.ts:138`. | Late observations must not revive an exited process. |

Stage 0 found that denied tools can coexist with headless `SUCCESS` and process exit 0. Its fixtures and permission matrix are historical samples from 2026-10-23, not a complete event contract. Initial read-only checks on 2026-10-24 reported local `agy 1.4.6` and residual hooks in both manifests listed below. The subsequent user cleanup and interactive check are recorded in the post-approval addendum. No authenticated or model-backed probe was run by the planning agent.

## Architecture and behavior

### Transcript viewport

Keep the existing Ink/React rendering and transcript item model. Introduce a shared internal layout calculation so viewport bounds, scroll bounds, and rendered content agree on display rows at the current width. Internal helper placement is an engineering choice.

The calculation accounts for explicit newlines, blank lines, wrapping, terminal display width, role-label width, borders, padding, and card expansion state. ANSI formatting is not visible width. Empty or zero-sized inputs cannot cause division by zero or invalid slices.

`scrollOffset` has one meaning: display rows back from the bottom of the currently rendered transcript. Preserve PageUp/PageDown increments of five and End returning to the latest content. Clamp against total display rows and available viewport rows, after reserving the existing pinned-decision hint. A single item taller than the viewport must be traversable; merely keeping that item mounted while permanently clipping some rows is insufficient.

All retained rendered history must be reachable, including the oldest multiline message and the last row of a tall card. Existing intentional aggregation of simultaneous cards is preserved. Scrolling must not change decision focus or submit input. New output while scrolled back must not silently jump the user to the bottom or lose their location; End explicitly returns to following the newest content. Resize reflows and clamps safely while preserving the user's location as far as the retained content allows.

### Dimensions and resize

Use the real available terminal dimensions to budget header, transcript, composer, existing overlays, and pinned hint. Do not rely on a fixed minimum body height that exceeds a small terminal. Resizing updates the viewport, PTY and virtual terminal consistently; content must recover when the terminal grows again. Test narrow and short dimensions for bounded rendering and absence of crashes. Existing zoom, overlay, and raw-takeover routes remain available rather than introducing a new small-screen interface.

### Input ownership and decision delivery

Exactly one current view owns each input event: chat/composer, focused decision, rail, zoom, overlay, or terminal takeover. Preserve the first pending decision/failure focus rule, numbered selection, write-in responses, Escape/defer, and End/pinned-hint navigation. Switching view or resizing does not consume an extra Enter or transfer a trailing LF to the next card.

For a single submission, the supervisor emits one intentional response sequence for the locally focused card. Duplicate processing of the same submission cannot answer a second card. Distinct later keystrokes remain usable; this is not a blanket debounce of rapid typing. Local pending/queued/delivered state must not claim that the underlying runtime accepted a response without acknowledgment.

This is a local input-routing guarantee. The PTY/parser has no proven atomic action identity, and Stage A does not claim exactly-once execution or stale-action safety inside `agy`. When a prompt cannot be interpreted confidently, retain manual terminal takeover and avoid inventing or automatically sending an answer.

### Pause, resume, and terminal takeover

Retain queued outgoing input and FIFO delivery on resume within the same live local session. On Windows, pause holds supervisor-routed input; the child can continue running and emitting output. On POSIX, the existing SIGSTOP/SIGCONT attempt targets the known child PID; signal success must be observed before describing the child as stopped. This does not promise suspension of every descendant process.

Pause help and feedback describe the behavior actually available. A queued answer is not a delivered answer. Queues cannot leak into a new or dead PTY; disposal cancels them. Before sending a queued decision response, ensure its locally known session/card is still current. Local validation is not proof of atomic runtime binding. Resume after exit cannot write to or resurrect the exited process. Takeover continues to mean direct human terminal operation; it must not be described as supervisor-enforced freezing or permission control.

### Process outcome and delivery evidence

Keep the existing ledger schema/status union readable. Reuse `LedgerEvent.metadata` for factual process outcomes rather than introducing the Stage 0 journal or a new lifecycle engine. A process-ended event contains an identifiable event kind, numeric exit code when reported, signal when reported, and timestamp. Missing signal/exit information stays absent or explicitly unknown; it is not converted into success.

For a new Stage A run, child exit 0 ends the live session with `IDLE` and `activeAgent: null`, accompanied by its process-ended event. Nonzero exit remains `FAILED`, meaning process failure. Interruption/spawn failure remains distinguishable from a normal exit. Neither path declares task or delivery success. Preserve CLI nonzero exit propagation and normal zero-exit behavior.

Both the run-command and TUI-exit paths must agree on the outcome; shared internal handling or idempotent handling prevents duplicate final notes/events. An exit terminalizes the current local process observation: late parser, ledger-poll, or artifact-poll callbacks may preserve observations but cannot restore a live/active phase. A deliberately launched next invocation establishes a new live boundary; Stage A adds no restart controller.

`COMPLETED` remains readable for compatibility with historical ledgers and exported types, but does not prove verified delivery. Existing records are displayed as recorded legacy state with review/verification unconfirmed; they are not rewritten merely by viewing them. New exit handling does not synthesize `COMPLETED`. The same compatibility rule applies to raw ledger status exposed in audit/SDK documentation. Existing `--resume` ledger/artifact reuse semantics remain documented as they are; they do not imply recovery or underlying conversation resumption.

Use a factual end-of-process summary within the existing presentation lifecycle. It must remain observable even if the TUI unmounts promptly. Do not keep an extra terminal screen alive or change quit behavior just to show it. Raw/no-TUI operation retains passthrough and factual persisted outcome; no synthetic task-success footer is introduced.

| Input evidence | Allowed presentation | Unsupported inference |
| --- | --- | --- |
| PTY child reports exit 0 | “Agent process exited with code 0”; review and verification unconfirmed. | All checks passed; tasks completed; reviewed delivery; branch ready to merge. |
| PTY child reports nonzero/signal | Report the observed process outcome and available error context. | Every task failed; a retry has started; a dead terminal can accept input. |
| Ledger phase or artifact progress | Display its source, recorded/inferred phase, and observed task counts. | Spec approved, plan approved, fresh orchestrator launched, or verification passed solely from the phase. |
| Agent text says `READY`, `DONE`, `APPROVE`, or `PASS` | Display an attributed reported verdict; keep critic readiness distinct. | Human spec approval, implementation authorization, or independently verified delivery. |
| Parsed test summary | Attribute the summary to observed agent output. | The supervisor ran the command, verified the current revision, or knows a repair is underway. |
| Git commit/artifact observation | Display the observed commit/artifact and heuristic association. | Artifact ownership, reviewed scope, or task completion solely from a file/commit. |

Remove synthetic verifier success, automatic completion of all running cards, unsupported reviewer approval, speculative repair/retry statements, and fresh-process claims. Apply the distinction to header phase checkmarks, rail states, cards, audit view, phase notes, and summary copy. Unknowns remain unknown. Stage A has no authoritative verified-delivery producer; building that producer belongs to Stage B.

### Terminal lifecycle and error handling

Preserve TTY detection, alternate screen, raw passthrough and ConPTY support. Normal quit, normal child exit, nonzero child exit, startup failure after partial setup, Ctrl+C, and supported termination signals use idempotent cleanup. Restore the caller's previous input/raw-mode state where available, restore the normal screen/cursor, remove listeners/timers, dispose stores/virtual terminal, and release or kill the owned child as appropriate. Cleanup failure in one resource must not skip restoration of the rest.

No terminal program can restore state after an uncatchable kill or host crash; test catchable exits and document emergency recovery separately. Windows and POSIX signal behavior is recorded distinctly. Missing PTY/TTY dimensions, vanished prompts, invalid input, and absent historical outcome metadata degrade to safe bounded presentation or manual control, without fabricated approvals or results.

## Documentation and progress records

Update the README to describe the current conversational interface, actual existing CLI flags and aliases, manual permissions, pause limitations, takeover, and ledger-only `--resume`. Identify artifact timestamp filtering as discovery, not ownership or session identity. Describe process completion separately from verified work.

The Stage A implementation should leave one current evidence summary under `docs/roadmap-updates/`, linking this spec and the later approved implementation plan. It distinguishes implemented capabilities, known defects, historical test evidence, new automated/live acceptance results, and future architecture. Keep historical specs/plans/audits intact. Do not infer progress from unchecked or checked historical plan boxes. Preserve Stage 0's explicit incomplete status. Correct relative links in touched current roadmap/review documents where relocation into `roadmap-updates/` has broken them; this is documentation hygiene, not a new audit project.

## Acceptance requirements

| ID | Required outcome | Evidence |
| --- | --- | --- |
| A1 | Reach oldest/newest content and every row of an oversized item using existing navigation; correct multiline/wrapped/blank-line/display-width handling. | Regression tests with actual rendered output and boundary assertions, not estimates tested against themselves; live transcript walk. |
| A2 | Pending hint, focus, overlays, composer and transcript stay bounded across resize; PTY/VT dimensions follow and listeners are cleaned up. | Resize events through real App dimension subscription in tests, plus live shrink/grow. Include 100x32, 80x24, 60x18, and stress at 30x8, recovering on grow. |
| A3 | One local submission produces one response sequence; CR/LF/CRLF, successive cards, option/write-in, defer/refocus, view switches and takeover do not cross-submit. | Store/App routing regressions and a harmless live agent question/decision. This does not certify atomic runtime approval. |
| A4 | Pause/resume has documented platform behavior, FIFO same-session queueing, no writes after disposal/exit, and no claim of delivery while queued. | Store/signal-path tests; Windows and POSIX live pause observations recorded separately. |
| A5 | Exit 0, nonzero, signal/startup failure, legacy `COMPLETED`, reported `READY`/`PASS`, missing verifier data, duplicate/late callbacks and poller ticks cannot fabricate approval, handoff, review, or verified delivery. | CLI/TUI/store/narrator/header/rail/audit regressions; persisted outcome and summary checked together. |
| A6 | Terminal state is restored on supported normal/error/interrupted paths; remounting does not accumulate handlers. | Mocked lifecycle failure coverage and catchable live exit checks on Windows and POSIX. |
| A7 | README/current progress links and statements reflect the shipped interface and evidence, while Stage 0 remains incomplete. | Documentation review, local target validation, and the Stage A evidence summary. |
| A8 | Standard suite, full typecheck, and build pass on the reviewed implementation. | Record `npm test`, `npx tsc --noEmit`, `npm run build`, revision, environment, outputs and exit codes. No new dependencies required by this design. |

Unit/component tests cannot establish live terminal behavior or real `agy` protocol timing. Stage A exit requires representative live checks, including navigation, single response delivery and terminal restoration. Obtain Windows and at least one identified POSIX environment result; lack of POSIX access is an explicit open acceptance item, not a cross-platform success claim. This is a bounded Stage A check, not the full Stage E compatibility matrix.

No application tests, typecheck, build, authenticated probes, or Stage A live acceptance were executed by the planning agent. Historical totals such as 310 passing tests are not current verification. The user-supplied Stage 0 check below is separate evidence. This spec defines acceptance; the implementation plan and independent post-review verification come after approval.

## Stage 0: requested human environment checks

These checks can proceed independently and do not block approving or implementing this Stage A design. They address access/environment gaps in the earlier investigation, not every remaining Stage 0 requirement.

### Residual-hook cleanup

The following files initially contained the top-level `munder-hive` hook set on 2026-10-24. The user subsequently completed this cleanup; the post-approval addendum records the confirmation. These steps are retained as the reproduction protocol, not a request to repeat a completed check.

- `C:\Users\athar\.gemini\config\hooks.json`
- `C:\Users\athar\.gemini\antigravity-cli\hooks.json`

Close running `agy` sessions. Back up each file, open it in an editor, and remove only the `munder-hive` top-level entry, preserving any other entries and valid JSON. If that is the only entry, the resulting object is `{}`. Do not remove the coding-team plugin or unrelated hooks. This chat has not changed either file.

In a normal signed-in PowerShell terminal, confirm versions and check both edited manifests:

```powershell
agy --version
agy plugin list
$hookPaths = @(
  'C:\Users\athar\.gemini\config\hooks.json'
  'C:\Users\athar\.gemini\antigravity-cli\hooks.json'
)
foreach ($hookPath in $hookPaths) {
  $hookConfig = Get-Content -LiteralPath $hookPath -Raw | ConvertFrom-Json
  [pscustomobject]@{
    Path = $hookPath
    HasMunderHive = $hookConfig.PSObject.Properties.Name -contains 'munder-hive'
  }
}
```

Expected: valid JSON, `HasMunderHive = False` for both, and coding-team remains enabled. This confirms configuration cleanup, not what a running process loaded. `agy --version`/`--help` do not expose loaded-hook diagnostics. During the next session, retain any startup hook diagnostic; absence of the old message alone is not proof of runtime hook removal. If diagnostics are unavailable, record runtime loading as unconfirmed.

### Signed-in interactive permission sanity check

Use the existing Antigravity settings to confirm `request-review`; no setting path or CLI permission flag is invented here. Do not use skip-permissions. Use the already selected model `claude-sonnet-5-5-medium`; if it is unavailable, report the error rather than silently switching models.

Create a disposable workspace and start the native interactive CLI there:

```powershell
$probeDir = Join-Path $env:TEMP ('agysup-stage0-human-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeDir | Out-Null
Push-Location -LiteralPath $probeDir
try {
  agy --model claude-sonnet-5-5-medium --prompt-interactive 'Request permission to run exactly cmd /c echo STAGE0_DENY_CHECK. Do not edit files or run other commands.'
} finally {
  Pop-Location
}
```

Decline the actual native approval prompt. Confirm the command did not execute; a repeated marker in agent prose is not execution evidence. In that same session, request `cmd /c echo STAGE0_ALLOW_CHECK`, approve it once, and inspect the native tool result for execution. If no approval prompt appears, stop the check and report effective settings and what happened; do not force an approval. Exit normally. Share CLI/plugin versions, displayed mode if available, whether the deny/allow prompts appeared, native tool outcomes, and any hook diagnostic, without credentials or authorization URLs. No edits are requested, and only harmless echo commands should run.

This sanity check repeats a previously observed interactive path after environment cleanup. It does not prove atomic action binding, configuration precedence, workspace enforcement, cross-mode parity, or Stage 0 completion. If the agent can run the same test through an authorized signed-in process, the user need not repeat it solely because an earlier sandbox could not authenticate.

### Work retained by the agent

Equivalent cross-mode permission/boundary/configuration probes, the exit-7-versus-reported-1 mismatch, structured-event completeness and identity, replay/duplicates/reconnect behavior, source precedence, versioned normalization, redaction/retention, and sanitized denial fixtures remain engineering investigation. Human approval of a harmless echo cannot settle them. SDK assessment remains deferred unless a concrete candidate is proposed.

### Post-approval Stage 0 evidence — 2026-10-24

The user reported removing `munder-hive` successfully and supplied two native CLI interaction excerpts. In a follow-up answer, the user explicitly confirmed that the first run showed a permission prompt they approved and that `request-review` was enabled for both runs. Both excerpts used `cmd /c echo STAGE0_DENY_CHECK`; the marker name does not determine the permission result.

- Allow: the user supplied the expanded native tool output, which states `Command exited with code 0` and prints `STAGE0_DENY_CHECK`. The user confirms explicit approval. This supports actual echo execution and numeric zero exit for this interactive run, beyond the CLI assistant's prose. It is a user-provided terminal capture, not an independently captured structured-event fixture.
- Deny: the expanded native tool output reports `permission check failed` for that exact command and says the user denied permission; it is followed by `User declined the tool call` and an interrupted prompt. This directly supports the observed permission-enforcement/decline path for this action.
- Cleanup: a subsequent read-only agent check parsed both exact manifests successfully as JSON and found `HasMunderHive = False` for each. The user performed the edits; the agent changed no global configuration. Runtime hook-loading diagnostics were not supplied, so absence from configuration is confirmed separately from runtime loading.

Accept this as post-cleanup human interactive allow/deny evidence, including a numeric-zero tool result, under user-confirmed request-review. Do not request repetition of the same basic flow merely because the planning sandbox cannot authenticate. Exact probe-time CLI/plugin versions and runtime hook-loading diagnostics are not included; earlier `agy 1.4.6` discovery is not proof of the version of a pasted run. This does not settle the nonzero-exit mismatch, atomic approval binding, cross-mode coverage, or event/replay contract; Stage 0's exit gate remains incomplete. This evidence addendum changes no approved Stage A scope.

## Defaults, exclusions, and approval boundary

Autonomous engineering defaults: reuse current dependencies and PTY/parser; use internal shared row-layout helpers; preserve schema/CLI compatibility; use existing ledger event metadata for outcomes; use idempotent cleanup, empty-state guards and local input/session checks; limit new tests to meaningful behavioral regressions. No worktree or application changes are made during design.

Out of scope: closing Stage 0, replacing the PTY/parser, a new structured-event adapter or journal, global hook edits, SDK migration, fresh planner-to-orchestrator launch, enforced artifact-revision approvals, verification execution/evidence collection, automatic permission decisions, classifier/reasoner, restart/retry controller, worktree orchestration, publishing, or UI redesign. Human-operated PTY approvals remain subject to the Stage 0 limitations.

The user approved this design before task decomposition on 2026-10-24. The selected team-plan workflow requires a separate implementation-plan phase followed by plan-critic `READY` and manual handoff to `team-run`. This document defines the approved design and acceptance requirements; it does not authorize application implementation in the planning chat.
