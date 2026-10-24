# Stage A: trustworthy interactive baseline — implementation plan

Date: 2026-10-24  
Status: plan-critic READY on 2026-10-24; awaiting manual handoff; execution has not started  
Approved spec: [2026-10-24-stage-a-trustworthy-interactive-baseline-design.md](../specs/2026-10-24-stage-a-trustworthy-interactive-baseline-design.md)  
Approval: user explicitly approved the design in this chat on 2026-10-24.  
Source baseline: `main`, `47c79049af5b8da7c12e1dcb3093070f01805478`.

## Goal and boundaries

Deliver the approved Stage A behavior: usable transcript row scrolling, safe resize and input ownership, honest pause/delivery feedback, reliable terminal restoration, and factual process/report presentation. Keep the existing conversational interface and manual operation. Closing Stage 0, native permission enforcement, lifecycle orchestration, restart/retry, SDK migration, new flags/dependencies, publishing, and UI redesign are excluded.

Stage 0 remains incomplete. After spec approval, the user reported residual-hook removal and supplied interactive allow/deny excerpts, explicitly confirming approval of the first run and request-review for both. Read-only inspection subsequently confirmed valid JSON and no `munder-hive` entry in either manifest. The approved spec's evidence addendum preserves the source/limits of these observations. Do not repeat that basic native flow as an outstanding user task. Event-contract/replay/exit-code gaps remain independent of Stage A. No authenticated `agy` probes are required for automated task checks; use real temporary directories, `process.execPath`, mock streams and deterministic PTY children. Actual supervisor TUI timing and Windows/POSIX terminal behavior still require the live acceptance below.

## Repository grounding and execution rules

- TypeScript/React/Ink ESM: `package.json:30` supplies `npm test` (`vitest run`) and `npm run build` (`tsup`). `tsconfig.json:2` uses strict NodeNext and includes tests. `vitest.config.ts:3` uses the Node environment. `tsup.config.ts:4` builds SDK/CLI, Node18 target and declarations. `.github/workflows/publish.yml:13` runs Node20 Ubuntu build/tests; it does not establish Windows acceptance or full typecheck. There is no lint or typecheck npm script: use `npx tsc --noEmit` directly.
- Existing symbols were checked in source: `runCommand(targetDir?, options?): Promise<void>` (`src/cli/commands/run.ts:25`); `PtyRunner.start(): Promise<number>`, `onExit(callback: ExitListener): void`, `isProcessRunning(): boolean` (`src/pty/runner.ts:56`, `:68`, `:125`); `ExitListener(code, signal?)` (`src/pty/types.ts:30`). The exit callback retains signal and precedes promise resolution, including synchronous dry-run exits.
- `pollWorkspaceOnce(projectDir, options?): WorkspacePollSnapshot` and `PollWorkspaceOptions.syncLedger/minMtimeMs` already exist (`src/telemetry/poller.ts:8`, `:240`). `TelemetryStore.pollNow()/startPolling()/stop()/getSnapshot()` and the role-based status writer exist (`src/telemetry/store.ts:120`, `:155`, `:203`, `:217`, `:287`). These are observation mechanisms, not authoritative agent lifecycle events.
- `TranscriptStore.answerFocusedDecision(freeformText?)`, `submitUserMessage(text)`, `handlePtyExit(code)`, `pause()/resume()/dispose()` exist (`src/tui/transcript-store.ts:260`, `:281`, `:458`, `:471`, `:569`). Their queue currently contains bare strings and marks cards answered before paused writes are delivered. `AppProps.dimensions` and the stdin router exist (`src/tui/App.tsx:33`, `:473`).
- Ink publicly exports `measureElement`; installed `node_modules/ink/build/measure-element.js:4` measures Yoga height. `Box` supports `overflowY` and numeric `marginTop` (`node_modules/ink/build/components/Box.d.ts:17`), and its renderer clips descendants (`node_modules/ink/build/render-node-to-output.js:57`). This establishes a candidate implementation, not runtime proof. Task 2 must prove partial-card clipping and measurement updates with rendered tests before relying on them. Do not import transitive `string-width`/`wrap-ansi` as undeclared application dependencies.
- The graph was indexed on `feat/tui-redesign`; source is authoritative. Refresh it if used during execution, without installing hooks or rewriting configuration. No current application verification was run during planning.
- Before workers, the orchestrator establishes isolation using the execution workflow, carries the approved untracked spec/plan into that checkout, inventories unrelated files, and preserves them. Existing untracked roadmap/review/fixture material is input, not permission to commit all untracked files. No reset, restore, checkout, global-hook edits, dependency installation, pushing, merging, or publishing is a task here.
- Dispatch registered implementers with one task each. They are not alone in the checkout: own only listed files, preserve others' changes, never delegate or commit, and report exact checks/exit codes. Only the orchestrator updates shared task progress and stages explicit authorized paths.

## Shared contracts

The following are **new internal contracts**, not claims that these APIs already exist. Task owners implement the listed signatures or a type-equivalent shape while preserving existing public call signatures through optional additions.

1. In `src/core/types.ts`, add `ProcessOutcome` with `runId`, `sessionId`, `observedAt` and a discriminated outcome: `kind: 'exit'` with optional numeric `exitCode`/`signal`; `kind: 'interrupted'` with supervisor signal/exit code; or `kind: 'startup_error'` with a bounded error message. Add `ProcessRunContext` containing fresh per-invocation identity and optional terminal outcome. Ledger schema/status union and historical readability stay intact. `--resume` reuses session identity, never process identity.
2. In new `src/core/process-outcome.ts`, provide `createProcessRunContext(sessionId: string): ProcessRunContext`, `recordProcessOutcome(projectDir: string, outcome: ProcessOutcome): { ledger: SupervisorLedger; recorded: boolean }`, and `formatProcessOutcome(outcome: ProcessOutcome): string`. Persist `metadata.kind = 'PROCESS_OUTCOME'`, invocation/session IDs, outcome kind, and only reported exit/signal data. Idempotency is per process invocation, not session. Reject a mismatched current ledger session; do not overwrite unrelated state. Normal exit0 becomes `IDLE`, nonzero/startup error/unknown termination becomes process `FAILED`, and supervisor interruption retains `IDLE` plus factual interruption evidence and external 130/143 as appropriate. Missing code never becomes zero. This is a small same-process outcome helper, not a crash-recovery engine.
3. Add optional outcome/source fields to `TelemetrySnapshot` in `src/telemetry/types.ts`. Sources distinguish `agent_output`, `artifacts`, and recorded `ledger`; parser reports stay explicitly attributed. Extend the reported-verdict union to preserve `READY` rather than rewriting it to `DONE`. Legacy callers omitting additive fields continue to compile and get an unknown/reported interpretation, never verified success.
4. Task 3 adds optional `processRun` to `TelemetryStoreOptions`, `handleProcessOutcome(outcome: ProcessOutcome): void`, and a status-promotion fence in `PollWorkspaceOptions`. Ending a context is irreversible; a fresh context is required for a deliberate new invocation. Task 4 adds optional `processRun` to `TranscriptStoreOptions`, `handleProcessOutcome(outcome: ProcessOutcome): void`, and snapshot-local delivery information. Existing `handlePtyExit(code)` remains a compatibility wrapper without inventing a fresh identity per callback.
5. Task 2 adds a measured viewport contract in new `src/tui/transcript-viewport.ts`: `TranscriptWindow` with numeric `totalRows`, `visibleRows`, `clampedOffset`, `startRow`; `getTranscriptWindow(totalRows: number, viewportRows: number, scrollOffset: number, hintRows: number): TranscriptWindow`; and `TranscriptProps.onViewportMetrics?: (metrics: TranscriptViewportMetrics) => void`. `TranscriptViewportMetrics` extends that window with measured per-item start/height and logical-segment/source-offset-to-row mappings, plus an optional anchor. An anchor is `{ itemId: string; segmentKey: string; sourceOffset: number; viewportRow: number }`, identifying a logical text/field segment and position rather than merely a stale wrapped-row number. Task 2 supplies measurement/anchor capture and remapping in the same helper; Task 7 owns the controlled anchor state and navigation. Use actual Ink measurements for layout/remapping, not a second independent renderer/height estimator. The existing `scrollOffset` prop means display rows back from bottom.
6. Task 5 optionally adds `processRun?: ProcessRunContext` to `MountSupervisorTuiOptions`, and `SupervisorTuiInstance.handleProcessOutcome?: (outcome: ProcessOutcome) => void`. The CLI owns persistence for CLI-launched runs; standalone mounts use the same helper once. Consumers fence and project an outcome without writing another completion event. New internals need no new SDK exports.

## Execution Waves

| Wave | Tasks | Dependency boundary |
| --- | --- | --- |
| Wave 1 | Task 1 — outcome/source contracts; Task 2 — measured transcript viewport | Disjoint core/type and transcript files. |
| Wave 2 | Task 3 — observation fences; Task 4 — input queue/delivery | Both consume Task 1; disjoint telemetry and transcript-store/narrator files. |
| Wave 3 | Task 5 — process/terminal lifecycle; Task 6 — factual presentation | Contracts and queue/fence APIs are ready. Lifecycle and presentation ownership are disjoint. |
| Wave 4 | Task 7 — App routing, anchoring, resize and integration | One owner integrates prior APIs in App and its test suite. |
| Wave 5 | Task 8 — current documentation and acceptance record | Describes implemented behavior and records remaining live checks. |

Use at most the actual available slots. Same-wave tasks below own disjoint files; sequential reuse of a file in later waves is intentional. A wave boundary is not a reviewer/verifier gate.

## Tasks

### Task 1 — Define factual process outcomes and additive observation types

**Wave:** 1  
**Depends on:** None  
**Files Touched:** Modify `src/core/types.ts`, `src/telemetry/types.ts`; create `src/core/process-outcome.ts`, `tests/unit/process-outcome.test.ts`.

**Contracts and acceptance criteria:** Implement shared contracts 1–3. Use existing `LedgerEvent.metadata` and atomic ledger save/update helpers (`src/core/ledger.ts:17`, `:119`), without changing schema version or reinterpreting old `COMPLETED` as evidence. Make one invocation produce at most one terminal event, while two fresh invocations under a resumed session can each record an outcome. Return `recorded: false` for a duplicate without mutating its factual result. A stale session must fail explicitly, not overwrite a new ledger. Pure formatting uses approved factual wording and never supplies verifier success. Startup error, interruption, numeric exit0/nonzero, signal-only and wholly unknown exit remain distinct. Optional added snapshot fields and `READY` preserve consumer compatibility.

**Risks:** The existing persistence is synchronous single-writer read/modify/write, not cross-process locking. Do not claim concurrent-run isolation. A signal number is not a numeric child exit code; the CLI wrapper's own 130/143 is not the child's reported exit. No credential-bearing raw output belongs in event metadata.

**Task checks:** Add behavior tests using `fs.mkdtempSync`, real `initLedger` and cleanup in `finally`; demonstrate failing assertions before implementing the helper, then pass `npx vitest run tests/unit/process-outcome.test.ts tests/unit/ledger.test.ts`. Run `npx tsc --noEmit` after additive shared types change; report consumer type failures for the owning dependent task and resolve incompatible contract changes before dispatch. Test duplicate callbacks, resumed identities, stale-session rejection and unchanged historical ledger reads.

### Task 2 — Scroll actual rendered rows, including inside tall cards

**Wave:** 1  
**Depends on:** None  
**Files Touched:** Modify `src/tui/components/Transcript.tsx`, `tests/unit/tui-transcript-cards.test.tsx`; create `src/tui/transcript-viewport.ts`, `tests/unit/tui-transcript-viewport.test.tsx`.

**Contracts and acceptance criteria:** Implement shared contract 5 using post-layout Ink measurements of unshifted item/content boxes, a bounded clip viewport, and a translated child. Prove this works in installed Ink through the tests before expanding it. Retain card components and existing aggregation; do not flatten/recreate their presentation. Remove estimated entry-count clamping as the navigation authority. Account for explicit newlines, blank rows, wrapping, wide/combining characters, ANSI, card borders/padding and actual label width through the real render. Expose stable item boundaries and anchor capture/remapping for Task 7, including text-prefix/segment measurements where needed to map source offsets through wrapping. Keep clipping translation separate from measured content dimensions, and prevent the full content from flex-shrinking to the viewport, so clipping/margins cannot corrupt total height. Clamp all arithmetic, reserve the actual wrapped hint height, and render safely while initial layout measurement is not yet available.

The window formula uses total measured rows and available visible rows: offset0 follows the bottom; rows are traversable within one card taller than the viewport. A zero-row viewport must not force one row outside its budget. A width/height/item/status change invalidates measurements and triggers a bounded, convergent update, never an effect loop.

**Risks:** `measureElement` is zero before layout. Remeasure on actual render dependencies; content revisions and card expansion can change height without changing item IDs. Rendering retained history is acceptable for this minimal fix, but a 500-item test must remain operable without unbounded state updates. If Ink cannot implement correct partial clipping, report the concrete failed behavior to the orchestrator rather than importing an undeclared dependency or silently weakening A1.

**Task checks:** First add rendered regressions that fail on current `Transcript`: oldest multiline content reachable, all labeled rows of one oversized card visible across scroll windows, newest row reachable, no over-height/blank window. Then implement and pass `npx vitest run tests/unit/tui-transcript-viewport.test.tsx tests/unit/tui-transcript-cards.test.tsx`. Assert actual frame lines/markers, not agreement between two estimators. Cover narrow widths, hint wrapping, empty content, huge offsets, item-height changes and measurement stability. Shared props require `npx tsc --noEmit`.

### Task 3 — Preserve reported readiness and fence late observations

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:** Modify `src/telemetry/parser.ts`, `src/telemetry/store.ts`, `src/telemetry/poller.ts`, `tests/unit/telemetry-parser.test.ts`, `tests/unit/telemetry-store.test.ts`, `tests/unit/telemetry-poller.test.ts`.

**Contracts and acceptance criteria:** Implement shared contract 4 for telemetry. Preserve parsed `READY` with source attribution; it can end the critic's reported activity but does not mean plan/spec approval or implementation permission. Attach source only to observations supported by that path. Keep existing parsing/artifact discovery and current mtime filtering; do not invent native event/session identity.

Add `PollWorkspaceOptions.allowStatusPromotion?: boolean` with existing behavior for callers that omit it, and have an ended telemetry context pass `false`. Also make the standalone poller consult the latest persisted process start/outcome evidence before promoting an ended invocation; a new start event explicitly establishes the next run. The guard is checked at the status write, not merely when scheduling a poll. Snapshot discovery may continue, but no parser event, timer tick or ledger sync may resurrect an ended context or treat task checkboxes as verified work. Snapshot phase provenance and process outcome are consistent with persisted evidence. Historical ledgers without these fields stay readable and unknown.

**Risks:** Both `handleTelemetryEvent` and `pollWorkspaceOnce` can write status; guarding only one leaves the defect. Existing `syncLedger` governs all synchronization, while the new option only governs promotion; do not accidentally lose discovered path data for active sessions. A reused ledger session ID is not a fresh process run.

**Task checks:** Red regressions: after ending a context, feed an execution dispatch, finish a queued poll and call standalone polling against a ledger with an outcome; assert IDLE/FAILED is unchanged while observed artifacts remain available. Add a subsequent distinct started invocation and confirm normal observation behavior returns. Verify `READY` stays READY and no checkpoint becomes APPROVED. Implement and pass `npx vitest run tests/unit/telemetry-parser.test.ts tests/unit/telemetry-store.test.ts tests/unit/telemetry-poller.test.ts`. Use real temp artifacts/Git fixtures following existing tests. Run `npx tsc --noEmit` for type/consumer changes.

### Task 4 — Track queued versus locally delivered input within one session

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:** Modify `src/tui/transcript-store.ts`, `src/tui/narrator.ts`, `tests/unit/tui-transcript-store.test.ts`, `tests/unit/tui-narrator.test.ts`.

**Contracts and acceptance criteria:** Replace bare-string queued writes with internal entries holding payload, local process generation/run ID, optional card ID/revision and submission ID. Keep `answerFocusedDecision(freeformText?, submission?)` and `submitUserMessage(text, submissionId?)` backward-compatible via optional additions. Define the optional submission as `{ id: string; decisionId: string }`. A duplicate submission ID cannot submit against the next focused card; distinct submissions are not time-debounced. Bound remembered IDs to this live session and retain IDs for queued/in-flight entries until resolved.

Expose a new local `delivery` field on decision/failure transcript items (`pending | queued | written | error` with optional bounded error context). “Written” means only that the live write callback returned. A paused answer stays visibly queued and cannot be submitted twice. Snapshot focus and pending counts remain coherent; queued cards are not misrepresented as accepted by `agy`. Resume validates the queued card's locally known identity, prompt/options revision and process generation before one FIFO flush. Changed/stale entries are cancelled with factual local feedback, never silently retargeted. A throwing callback leaves error/unknown local delivery, never answered success or automatic retry.

Implement `handleProcessOutcome` for both zero/nonzero cases: dedupe by run ID, cancel queues and outstanding writes before further input, and append one factual outcome note using Task 1 formatting. Keep `handlePtyExit` as a wrapper tied to the existing local context, including callers without an injected context; do not generate a new ID per repeated callback. Disposal is idempotent and fences future dispatch/writes. Signal attempts and Windows input-only pause are distinguished in snapshot feedback; no process-stop acknowledgment is fabricated. Preserve existing permission/manual response sequences and slash commands; take-over/open/quit local actions need no queued PTY write.

**Risks:** Narrator currently deduplicates prompts by question and can change options under a stable card ID; validate a local revision/fingerprint too. Ending a run must not produce both this note and an old fabricated completion card. A successful `process.kill` call is only a signal-send result, not proof every descendant stopped.

**Task checks:** Red regressions for queued/not-written card state, duplicate ID across two cards, distinct rapid submissions, stale prompt/options, FIFO, callback throw, exit/dispose then resume, duplicate outcome, signal failure and Windows no-signal path. Implement and pass `npx vitest run tests/unit/tui-transcript-store.test.ts tests/unit/tui-narrator.test.ts`. Use existing `createStore`/mock callback harness (`tests/unit/tui-transcript-store.test.ts:17`) and actual temp fixtures. Run `npx tsc --noEmit` for the narrator/snapshot contract; Task 6 consumes rather than redefines it.

### Task 5 — Unify process outcomes and make terminal cleanup resilient

**Wave:** 3  
**Depends on:** Tasks 1, 3, 4  
**Files Touched:** Modify `src/cli/commands/run.ts`, `src/tui/index.ts`, `src/pty/runner.ts`, `src/pty/raw-passthrough.ts`, `tests/unit/cli.test.ts`, `tests/unit/runner.test.ts`, `tests/unit/raw-passthrough.test.ts`, `tests/integration/tui-run.test.ts`; create `tests/unit/tui-lifecycle.test.tsx`.

**Contracts and acceptance criteria:** Create one fresh invocation context before mounting/subscribing, append process-start metadata to the existing startup event (`kind: 'PROCESS_STARTED'`, run/session IDs), and share context with telemetry/transcript/mount. Register a single persistence owner on `PtyRunner.onExit(code, signal)` before start. It terminalizes the local context and consumers before late callbacks can promote status, records once, then projects the same outcome into the UI. `start()` resolution may provide a same-ID fallback when no callback was observed, never a second outcome or a signal overwrite. Dry-run, standalone TUI mount, and no-TUI operation use the same factual semantics. Resume creates a fresh invocation ID even when it reuses a ledger.

Remove both `COMPLETED`-on-exit writes. Preserve nonzero CLI exit propagation. Make startup setup/mount/start exceptions and catchable interruption record their distinct outcome and unwind partially acquired resources. Register cleanup early enough that a thrown mount, raw setup or render cannot strand listeners or alternate screen. Handle data/exit callbacks that arrive during or after disposal; pending VT write promises cannot notify/rerender disposed instances. Runner subscriptions must be releasable or callbacks fenced; public `onData`/`onExit` callers that ignore return values remain compatible.

Capture original raw/input state before mutation and restore it exactly where observable. TUI, raw and outer CLI cleanup must not fight by forcing raw=false after another owner restored raw=true. Use one clear owner per resource and independently attempt store/timer/listener/VT/PTY/Ink/raw/screen cleanup even if an earlier operation throws. Set the idempotence fence before cleanup and settle `waitUntilExit` on every supported path. No cleanup stage may bypass screen/raw restoration. Keep ConPTY/POSIX behavior and forwarding intact.

Persist outcome before unmount. For interactive TUI launches, emit a single factual outcome line plus “Review and verification not confirmed” to the restored normal terminal after unmount; this avoids losing the summary with the alternate screen and changes no quit lifecycle. The no-TUI path remains passthrough plus persisted outcome, with no synthetic success footer. Standalone mounted use retains a factual transcript/audit record. Never announce task retry or offer a write to a dead PTY as if it were live.

**Risks:** Callback ordering, startup partial acquisition, TUI unmount during exit, and signal/kill reentrancy are the primary races. Remove the current temporal dependency on a fully initialized Ink instance before a synchronous exit callback. Different platform signals are not interchangeable. Test cleanup throws without suppressing evidence of the primary error.

**Task checks:** Add failing lifecycle tests using a fake runner/streams and injected failure at each cleanup stage. Assert all later stages run once, original raw=true/false restore, no listener growth across two mounts, and no disposed writes/rerenders. Extend real `process.execPath` PTY integration for exit0, exit7, a child printing `PASS` then exiting0, resume twice with different invocation IDs, and raw/no-TUI behavior; restore `process.exitCode` in test cleanup. Add signal metadata/dry-run callback-order runner tests. Pass `npx vitest run tests/unit/cli.test.ts tests/unit/runner.test.ts tests/unit/raw-passthrough.test.ts tests/unit/tui-lifecycle.test.tsx tests/integration/tui-run.test.ts`, then `npx tsc --noEmit` and `npm run build` for mount/runner contracts and CLI bundle compatibility. Native PTY failure is an environment/test gap, not a mocked pass.

### Task 6 — Make every status surface factual

**Wave:** 3  
**Depends on:** Tasks 1, 2, 3, 4  
**Files Touched:** Modify `src/tui/narrator.ts`, `src/tui/narrator-copy.ts`, `src/tui/components/Transcript.tsx`, `src/tui/components/HeaderBar.tsx`, `src/tui/components/TeamRail.tsx`, `src/tui/components/AuditLogView.tsx`, `src/tui/components/ZoomView.tsx`, `src/tui/components/DelegationCard.tsx`, `src/tui/components/DecisionCard.tsx`, `src/tui/components/FailureCard.tsx`, `src/tui/components/FooterBar.tsx`, `src/tui/components/CommandPalette.tsx`, `tests/unit/tui-narrator.test.ts`, `tests/unit/tui-header-footer.test.tsx`, `tests/unit/tui-rail-zoom-takeover.test.tsx`, `tests/unit/tui-views.test.tsx`, `tests/unit/tui-transcript-cards.test.tsx`; create `src/tui/process-presentation.ts`, `tests/unit/tui-process-presentation.test.ts`.

**Contracts and acceptance criteria:** Add a small pure `deriveProcessPresentation(ledger: SupervisorLedger, snapshot?: TelemetrySnapshot)` projection returning factual outcome/source text, explicit unconfirmed review/verification, and reported-versus-recorded progress. Props added to existing components are optional until Task 7 connects them; ledger/snapshot-only fallbacks are conservative. Do not build another authoritative event reducer or new control state.

Neutralize legacy `COMPLETED` in normal and compatibility header, phase strip, rail, audit and completion-card paths: no build/verify completion checks, reviewer `approved` from checked tasks, “All checks passed”, blanket completion of running cards, “merge when ready”, or unobserved process handoff. Keep historical data readable without rewriting it on view. Parsed READY/DONE/APPROVE/PASS and test summaries are attributed reports. A phase, checkbox, role label or recorded checkpoint is not a new human approval. Preserve critic readiness separately from spec approval and execution handoff. Remove speculative “is fixing”/“reviewer will check”/retry-started assertions unless observed; retain existing manual choices with honest descriptions.

Render Task 4 queued/written/error state without implying native runtime acceptance. Pause/help/palette/footer copy describes Windows input queueing and attempted POSIX child signals. Factual unknowns must remain distinguishable from an untouched initial IDLE run and from a known process exit. Keep the measured Transcript viewport API introduced by Task 2 intact as text/card heights change.

Include agent zoom: `formatAgentStep(step, isLast)` in `src/tui/components/ZoomView.tsx:66` currently treats an absent exit code as `ok`, and its summary calls zero observed failures “nothing failed.” Unknown command outcomes stay unknown, parsed command/test summaries are attributed to agent output, and no observed failure means only that no failure was observed. Keep the raw-output area and existing zoom interaction. Add these regressions in the owned `tests/unit/tui-rail-zoom-takeover.test.tsx` suite.

**Risks:** A green icon or phase checkmark can imply success even when nearby prose is neutral. Audit and compatibility rendering are part of acceptance. Reported agent completion can collapse a reported-activity card but must retain attribution and cannot become verified delivery. All source variants must name their actual source, including artifacts and recorded ledger state.

**Task checks:** First regress all unsupported claims: exit0/unknown code, legacy COMPLETED, phase-only approval/handoff, reported READY/PASS, completed artifact tasks with no review, no verifier record, queued card, signal-send failure. Assert both words and semantic success markers. Implement and pass `npx vitest run tests/unit/tui-process-presentation.test.ts tests/unit/tui-narrator.test.ts tests/unit/tui-header-footer.test.tsx tests/unit/tui-rail-zoom-takeover.test.tsx tests/unit/tui-views.test.tsx tests/unit/tui-transcript-cards.test.tsx`. Run `npx tsc --noEmit` for added props/contracts. Do not edit App while Task 5 is active.

### Task 7 — Integrate viewport anchoring, small terminals and single input ownership

**Wave:** 4  
**Depends on:** Tasks 2, 3, 4, 5, 6  
**Files Touched:** Modify `src/tui/App.tsx`, `tests/unit/tui-app.test.tsx`; create `src/tui/input-events.ts`, `tests/unit/tui-input-events.test.ts`.

**Contracts and acceptance criteria:** Introduce an internal stateful input decoder `createInputDecoder(): { push(chunk: string): NormalizedInputEvent[]; reset(): void }` with new `NormalizedInputEvent = { id: string; kind: 'submit' | 'key' | 'text'; raw: string; key?: string }`. Each normalized event carries a local monotonically unique submission identity; reset clears decoder state without reusing IDs in the current session. Consume CRLF once even when split across chunks. Preserve normal CR-only/LF-only entry, pasted multiline composer content, escapes, raw takeover and distinct rapid keypresses. Maintain decoder state across focus/view transitions so a trailing LF cannot submit the next card. Route each event once against a mode/card snapshot and pass the optional submission/card identity into Task 4. Raw takeover owns raw bytes; existing escape/back navigation continues to work without double forwarding.

Consume measured viewport metrics. Maintain follow-bottom at offset0/End; while scrolled back, capture a stable item/content anchor and rebase its row as new output, card expansion and width changes alter layout. Do not merely retain a static offset from bottom. Preserve the exact visible content on append, and map the same logical text segment/cell offset to its new wrapped row on reflow where retained. For non-text cards anchor stable field/option identity and the nearest corresponding row. Clamp only when the anchored content disappears or the viewport cannot retain it. Pass source/outcome/delivery data into Task 6 surfaces.

Replace the fixed six-row body floor and blanket 80x24 guard with a budget bounded by actual rows, including measured/wrapped header, composer, palette and pinned hint. At 100x32, 80x24 and 60x18, existing interaction remains navigable. At 30x8, render within bounds without crashing, preserve existing recovery/takeover routes, and recover full navigation when grown; no new small-screen interface is introduced. Exercise actual stdout resize subscription without `dimensions`, separately from fixed-dimension rerender tests. Coordinate its layout with Task 5's VT/PTY dimension updates. Capture/restore the previous App raw mode rather than unconditionally forcing false; outer cleanup must preserve that state.

**Risks:** `ink-testing-library` stdout defaults to fixed columns and has no rows; override the test stream properties and emit real resize events, then restore them. A supplied `dimensions` prop bypasses the subscription and cannot prove event handling. Prevent measurement/scroll feedback loops and stale callbacks from old modes. The existing 70x20 guard expectation must be replaced with the approved bounded-layout behavior.

**Task checks:** Add red tests for split CRLF before switching focus/view; repeated same submission ID vs distinct subsequent Enter; each view's exclusive routing; appended output while scrolled back; reflow of anchored text; all rows of a tall decision; End; real resize shrink/grow; 30x8 bounds and recovery; original raw state and unmount callbacks. Implement and pass `npx vitest run tests/unit/tui-input-events.test.ts tests/unit/tui-app.test.tsx tests/unit/tui-transcript-viewport.test.tsx tests/unit/tui-lifecycle.test.tsx`. Run `npx tsc --noEmit` and `npm run build` for the integrated public App/mount interfaces. Keep actual native `agy` permission atomicity explicitly unproven.

### Task 8 — Document current behavior and record acceptance evidence

**Wave:** 5  
**Depends on:** Tasks 1–7  
**Files Touched:** Modify `README.md`, `docs/roadmap-updates/ROADMAP.md`, `docs/roadmap-updates/stage-0-runtime-contract-review.md`; create `docs/roadmap-updates/stage-a-interactive-baseline-review.md`.

**Contracts and acceptance criteria:** Describe the shipped conversational UI, aliases and every existing run flag from `src/cli/index.ts`, manual permission/takeover, actual pause behavior, ledger-only resume, factual process outcomes, artifact-discovery limitations and legacy status compatibility. Preserve historical specs/plans/audits. Update current roadmap/review links for their relocated directory (Stage0 fixture links need `../../tests/fixtures/stage-0/...`); retain Stage0 incomplete status and historical evidence dates. Carry the approved spec's 2026-10-24 addendum into the Stage0 review: user-performed hook cleanup independently confirmed in configuration, user-confirmed request-review and explicit approval, expanded native allow output with numeric code0 and expected echo marker, and expanded native permission-check failure/decline output. Preserve its user-provided terminal-capture provenance; do not promote it into a structured-event fixture or completed runtime contract. Mark basic residual-config cleanup/interactive flow and numeric-zero result addressed, with runtime-loading diagnostics and remaining engineering probes separately unconfirmed.

The new Stage A review links approved spec/plan and maps A1–A8 to implementation/task evidence, defect status and final verification/live evidence references. Mark unrun checks explicitly `NOT RUN`; never fill them from historical totals or task completion boxes. Record environment, revision/diff fingerprint, exact commands and exit status/output, separately identifying unit, real PTY child, native `agy`, Windows and POSIX evidence. Include the live protocol below, cleanup/emergency-recovery instructions, and remaining limitations. Initial final-verifier/live rows can honestly be NOT RUN; they are acceptance gaps until actual results arrive, not placeholders for omitted design.

**Risks:** Root README and relocated docs have different relative-link bases. `--resume` does not resume an underlying conversation or implement recovery. SDK-exposed ledger status stays legacy-compatible but cannot certify delivery. Do not update snapshots of historical check counts as though those checks just ran.

**Task checks:** Review documentation against `src/cli/index.ts`, `src/core/types.ts`, actual implemented pause/input/outcome behavior and approved spec. Validate touched local Markdown targets with this PowerShell block from repo root; it checks target existence, not URL/heading semantics. Manually check heading anchors and skip explicitly labelled external/historical references only when documented.

```powershell
$docPaths = @('README.md', 'docs/roadmap-updates/ROADMAP.md', 'docs/roadmap-updates/stage-0-runtime-contract-review.md', 'docs/roadmap-updates/stage-a-interactive-baseline-review.md')
foreach ($docPath in $docPaths) {
  $docText = Get-Content -LiteralPath $docPath -Raw
  foreach ($match in [regex]::Matches($docText, '\]\(([^)]+)\)')) {
    $link = $match.Groups[1].Value.Trim('<', '>')
    if ($link -match '^[a-zA-Z][a-zA-Z0-9+.-]*:' -or $link.StartsWith('#')) { continue }
    $target = [uri]::UnescapeDataString($link.Split('#')[0])
    if ($target -and -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $docPath).Path) $target))) {
      throw "Broken local target in ${docPath}: $link"
    }
  }
}
```

Task 8 does not execute full application verification or certify live acceptance. The following review/verifier sequence owns those results.

## Requirement-to-acceptance map

| Spec requirement | Tasks | Final evidence |
| --- | --- | --- |
| A1: correct row navigation and tall items | 2, 7 | Rendered viewport/App regressions; live transcript walk. |
| A2: resize bounds and PTY/VT/listener propagation | 2, 5, 7 | Measurement, resize-event and lifecycle regressions; live shrink/grow. |
| A3: one local response, focus and takeover | 4, 7 | Queue/submission/decoder/App regressions; harmless native agent question. |
| A4: honest pause and session-bound queue | 4, 5, 6, 7 | FIFO/stale/exit/signal tests; separately recorded Windows/POSIX observations. |
| A5: factual status on all surfaces, no revival | 1, 3, 4, 5, 6, 7 | Outcome, parser/poller, presentation and real Node-child integration. |
| A6: terminal cleanup, repeated mounts | 5, 7 | Failure injection and raw-state regressions; catchable live exit checks. |
| A7: accurate current docs and progress | 8 | Document/link review and evidence summary. |
| A8: suite/typecheck/build on reviewed change | Final verifier | Exact commands/results, environment and revision/diff scope. |

## Review, final verification and live acceptance

After all tasks/waves, the orchestrator dispatches one registered code-reviewer against the full change and approved spec. Required findings go to implementer fixes with focused checks, then the same reviewer rechecks affected scope until approved. There are no automatic per-wave verifier runs or additional LLM approval checkpoints.

Only after reviewer approval, dispatch a registered verifier with no workers writing. Run from the isolated repository root: `npm test`, `npx tsc --noEmit`, `npm run build`, plus Task 8's local-link validator. No nonexistent lint command. Record cwd, Node/npm/OS/terminal versions, revision and a diff fingerprint including untracked/new task files, command exit codes, relevant output and skipped checks. Tests needing Unicode terminal mode should record `TERM`/`COLORTERM`/`NO_COLOR` rather than silently modifying unrelated configuration. If permissions/native PTY/tooling block a required check, report it as unrun; request only the narrow required access or user help. Failures return through implementer fix -> reviewer approval -> verifier for affected checks and final relevant coverage.

For native live acceptance, confirm installed `agy`/plugin versions, current help support for `--model`, and `request-review`. Keep Stage0 environment cleanup separate. Smoke-check the actual CLI, then use the existing exported `runCommand` API to pin `claude-sonnet-5-5-medium` while exercising the same TUI run path. Commander does not expose `RunOptions.args`; do not invent a CLI passthrough flag. From the built checkout, this PowerShell sequence creates an actual disposable workspace and launches the signed-in local CLI through its existing API:

```powershell
node bin/agy-supervisor.js --help
$liveWorkspace = Join-Path $env:TEMP ('agysup-stage-a-live-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $liveWorkspace | Out-Null
node --input-type=module -e "import { runCommand } from './dist/cli/index.js'; await runCommand(process.argv[1], { args: ['--model', 'claude-sonnet-5-5-medium'] });" $liveWorkspace
```

On POSIX use the same built API invocation with a real directory from `mktemp -d` passed as its final argument; use that environment's documented temporary-root handling. If model or signed-in access is unavailable, report the error rather than silently switching models. No product flags, launchers, bypass permissions or global-hook edits are added.

Record the following on Windows Terminal/ConPTY and at least one identified POSIX terminal/environment:

1. Start a representative interactive session; ask for harmless read-only conversation with a clarification question and enough multiline output to exceed the viewport. Use a harmless native command approval only when needed to exercise existing decision cards. No project edits are required.
2. Walk oldest/latest content and an oversized card with PageUp/PageDown/End; scroll back, let output append, then resize through 100x32, 80x24, 60x18 and 30x8 before growing. Record reachability, bounds, focus and recovery.
3. Answer one question/decision once, defer/refocus another, and visit rail, zoom, overlays and raw takeover. Confirm native response once and no trailing-enter answer of the next question; distinguish this observed path from atomic permission guarantees.
4. Pause, queue a harmless message, resume and observe one write. On Windows record that the child can continue; on POSIX record the attempted child signal and actual observed behavior without claiming every descendant froze. Exit while paused and ensure the queue cannot leak to a later session.
5. Exercise normal quit, normal child exit, nonzero exit and catchable Ctrl+C/termination paths using disposable Node PTY children for deterministic failure cases. Verify shell echo, cursor, screen and input restoration, no orphan owned child, and a factual persisted outcome. A TUI-exit summary must survive alternate-screen teardown; no “all checks passed” or fresh-orchestrator claim may appear.

If a POSIX/native-terminal environment or signed-in session is unavailable, request that concrete user check and keep the corresponding acceptance row NOT RUN. Automated tests, previous live probes, or Ubuntu CI configuration do not substitute. Implementation can be reviewable while Stage A's live exit gate remains open; never report Stage A complete until required acceptance passes.

The orchestrator maintains `stage-a-interactive-baseline-review.md` with actual review/verifier/live results as they arrive. Results-only evidence updates must identify the tested code/diff scope; they cannot silently change implementation after review. Unchanged code-check evidence may be reused for evidence-only updates; have the final verifier validate the final documentation/link scope. Any behavior/config/dependency change returns through the normal fix/review/verifier loop.

Only the orchestrator commits authorized verified paths. Do not include unrelated untracked roadmap/fixtures wholesale; identify required input dependencies explicitly when carrying/staging planning artifacts. No push, merge or release is authorized by this plan.

## Manual handoff

After plan-critic READY, planning stops. The user hands this plan and the approved spec to `team-run` in an execution chat. That handoff authorizes execution without another plan-approval question. The Stage0 human checklist remains independent; no application code or runtime configuration is changed by this planning chat.
