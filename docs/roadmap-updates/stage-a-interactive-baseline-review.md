# Stage A interactive baseline — implementation evidence review

**Status:** implementation is independently reviewed and automated verification passes. Native Windows/POSIX live acceptance remains open; Stage A is not yet accepted.

**Repository:** `D:\Code\AntigravityMasterSupervisor`  
**Branch:** `codex/stage-a-trustworthy-interactive-baseline`  
**Base revision:** `47c79049af5b8da7c12e1dcb3093070f01805478`  
**Approved design:** [Stage A specification](../superpowers/specs/2026-10-24-stage-a-trustworthy-interactive-baseline-design.md)  
**Approved implementation plan:** [Stage A plan](../superpowers/plans/2026-10-24-stage-a-trustworthy-interactive-baseline-plan.md)  
**Stage 0 evidence:** [Stage 0 runtime contract review](stage-0-runtime-contract-review.md)

This document separates implemented behavior, task-scoped automated evidence, historical baseline results, live observations, and remaining gates. A completed task or a scoped test pass does not substitute for the independent review or final verifier.

## Current behavior and boundaries

- The supervisor presents a conversational TUI with measured transcript scrolling, inline decision cards, team rail, agent zoom, local overlays, and raw PTY takeover. PageUp/PageDown scroll the transcript and End returns to the latest content. Layout is bounded to available terminal dimensions, including the 30×8 stress case; the layout recovers when the terminal grows.
- Input delivery feedback distinguishes queued, locally written, failed, and unavailable states. A write callback or a displayed decision does not prove that Antigravity accepted the input or permission decision. People continue to operate native permission prompts.
- Pause is platform-dependent. Windows pauses supervisor input handling and queues input while the child may continue. POSIX attempts `SIGSTOP`/`SIGCONT` against the PTY process ID and reports attempted, failed, or unavailable status; it does not confirm that the child or descendants stopped. Queued writes are run-local and are canceled when that process ends.
- Process outcomes record the fresh process-run identity and reported exit code/signal or startup/interruption details. Exit code 0 records process exit only. It does not establish successful delivery, review, or verification. Legacy ledger status `COMPLETED` stays readable but is not treated as verifier evidence.
- `--resume` preserves supervisor ledger/session state and uses the artifact-discovery path that includes historical files. It launches a new child process with a new run identity; it does not reconnect to an existing child or resume an underlying Antigravity conversation. Artifact timestamps are discovery filters, not process ownership or lifecycle identity.
- The integration remains one Antigravity CLI process over the PTY with passive parsing and workspace/ledger observation. It does not provide an authoritative structured event contract, atomic permission binding, automatic approval, restart/retry, or crash reconstruction.

### CLI surface checked against source

The package exposes `agy-supervisor` and the short executable alias `agysup`. `run [projectDir]` is the default command; `agy-supervisor run [projectDir]` is also supported.

| Run option | Current behavior |
| --- | --- |
| `--agy-bin <path>` | Selects the Antigravity executable; otherwise discovery is used. |
| `--agent <name>` | Passes the selected agent role to the child CLI. |
| `--no-tui` | Uses raw terminal passthrough. Non-interactive terminals also omit the TUI. |
| `--dry-run` | Uses the simulated PTY path and does not launch Antigravity. |
| `--resume` | Preserves ledger/session state and scans historical artifacts, but starts a fresh child process/run identity. |
| `-v, --verbose` | Enables verbose logging. |

The root command and explicit `run` command accept those run options. `doctor [projectDir]` accepts `--agy-bin <path>`, `--dry-run`, and `-v, --verbose`. Global `-h, --help` and `-V, --version` are provided by Commander. The exported `runCommand` API has an `args` option; Commander does not expose a CLI argument-passthrough flag.

## Requirement-to-acceptance map

| Requirement | Implementation and scoped evidence | Live / final acceptance state |
| --- | --- | --- |
| **A1 — row navigation, multiline content, oversized items** | Measured row viewport and controlled logical anchors. Review fixes measure full actual Ink frames for every item kind, including long tokens, decorations and collapsed cards; bounded private probes are disposed and fenced. | Independent review: **APPROVED**; automated regressions pass. Live oldest/newest and tall-card walk: **NOT RUN**. |
| **A2 — bounded resize and PTY/VT propagation** | Tasks 5/7 cover resize, cleanup, small dimensions and grow recovery. Scoped TUI tests include 30×8 behavior and real stdout resize subscription. | Live 100×32, 80×24, 60×18, 30×8 and grow sequence on Windows/POSIX: **NOT RUN**. |
| **A3 — one response, focus, takeover** | Tasks 4/7 cover FIFO delivery, submission identity, split CRLF, focus changes, and view routing in scoped tests. | Harmless native question/decision, single delivery, defer/refocus, and takeover: **NOT RUN**. Atomic runtime permission binding remains unproven. |
| **A4 — pause and session-bound queue** | Tasks 4/5/6/7 cover queue, stale-write fences, and platform-specific feedback in worker-reported tests. | Actual Windows child behavior and POSIX signal behavior: **NOT RUN**. Neither platform's child/descendant pause is confirmed. |
| **A5 — factual status and no revival** | Persisted process outcomes, READY/source attribution, poller fences, local delivery, historical agent presentation, and late callbacks are covered. Real Node PTY integration covers exit 0/7 and PASS text before exit 0. | Independent implementation verification passes. Native Antigravity and cross-platform live lifecycle: **NOT RUN**. A process exit or reported PASS is not proof of verified delivery. |
| **A6 — terminal cleanup and repeat mounts** | Task 5 lifecycle regressions inject independent cleanup failures, restore prior raw/input state, fence late callbacks, and exercise repeated mounts. Real Node PTY exits are covered in the focused integration suite. | Native TUI quit/interrupt screen, shell echo, cursor, input restoration, and orphan-child check on Windows/POSIX: **NOT RUN**. |
| **A7 — current docs and evidence boundaries** | README, roadmap and reviews retain Stage 0 provenance and open live gates. Task 8 links and heading anchors were checked. | Reviewer approved; independent local-link validator passed. Evidence-only final document scope is rechecked separately from unchanged application code. |
| **A8 — full suite, typecheck, build on reviewed tree** | Independent verifier ran the full suite after review, found a stale legacy completion assertion, then reran after implementer correction and reviewer approval. | **PASS:** 403 tests / 26 files; typecheck and build exit 0. |

## Automated evidence recorded so far

Environment for this checkout: Windows build `26300`, Node `v26.3.0`, npm `11.16.0`, PowerShell. The inherited environment had `TERM=dumb` and `NO_COLOR=1`; Unicode-sensitive focused test runs set `TERM=xterm-256color`. Commands that needed atomic ledger renames used the approved elevated run. The default sandbox produced Windows `EPERM` on temporary ledger renames. An elevated parallel full-suite attempt previously crashed in native Node 26 filesystem code; single-worker commands were used for focused evidence.

| Evidence | Exact command / result | Scope and limits |
| --- | --- | --- |
| Pre-change baseline | `$env:TERM='xterm-256color'; npm test -- --maxWorkers=1 --minWorkers=1` — **exit 0, 310 tests across 21 suites** (elevated). | Historical baseline at `47c79049`; not a current full-suite result. |
| Task 3 telemetry | `npx vitest run tests/unit/telemetry-parser.test.ts tests/unit/telemetry-store.test.ts tests/unit/telemetry-poller.test.ts --maxWorkers=1 --minWorkers=1` — worker-reported **45 tests, exit 0** (elevated). | Parser, store, poller; not independent verification. |
| Task 4 input queue | `npx vitest run tests/unit/tui-transcript-store.test.ts tests/unit/tui-narrator.test.ts` — worker-reported **54 tests, exit 0**. | Store/narrator behavior; the worker redirected `TEMP`/`TMP` to the checkout to permit ledger renames. |
| Task 5 lifecycle and real PTY child | `$env:TERM='xterm-256color'; npx vitest run tests/unit/cli.test.ts tests/unit/runner.test.ts tests/unit/raw-passthrough.test.ts tests/unit/tui-lifecycle.test.tsx tests/integration/tui-run.test.ts --maxWorkers=1 --minWorkers=1` — **exit 0, 52 tests across 5 files** (elevated). | Integration uses actual Node PTY children for exit 0 and 7 and a PASS-before-exit-zero case; it does not launch native `agy`. |
| Task 6 presentation | Worker reported a serial focused run of **7 suites / 133 tests**; exact command and output are not retained. A follow-up presentation check, `npx vitest run tests/unit/tui-process-presentation.test.ts --maxWorkers=1 --minWorkers=1`, passed **9 tests, exit 0**. | Task-local evidence only; the 133-test figure is not independently reproducible from the retained command record. |
| Task 7 App integration | With `TERM=xterm-256color`, `TEMP`/`TMP` set to `.task7-temp`, and `NODE_COMPILE_CACHE=.task7-temp/node-cache`: `npx vitest run tests/unit/tui-input-events.test.ts tests/unit/tui-app.test.tsx tests/unit/tui-transcript-viewport.test.tsx tests/unit/tui-lifecycle.test.tsx` — worker-reported **52/52, exit 0**. `npx tsc --noEmit` and `npm run build` also exited 0 at that task state. | Task-scoped checks; the temporary directory and generated cache were cleaned. The final Task 7 run includes the viewport correction described in the next row. |
| Final viewport correction | `$env:TERM='xterm-256color'; npx vitest run tests/unit/tui-transcript-viewport.test.tsx tests/unit/tui-app.test.tsx --maxWorkers=1 --minWorkers=1` — **exit 0, 43 tests** (elevated); `npx tsc --noEmit` — **exit 0**. | Covers the source-anchor convergence correction and App marker-preservation regression. This is not the final full verifier run. |
| Final verifier, initial run | `npm test` in the sandbox failed on temporary-file rename `EPERM`; elevated `npm test` and `npm test -- --maxWorkers=1 --minWorkers=1` then each reported **402 passed, 1 failed**. | Failure was an obsolete store-test expectation of a synthetic CompletionCard after legacy COMPLETED. No source defect was found. |
| Final verifier, reviewed correction | With `TERM=xterm-256color`, elevated `npm test` — **exit 0, 403 tests / 26 files**; all 5 real Node PTY integration tests pass. | Test-only correction requires factual legacy narration and rejects synthetic success/handoff; reviewer approved before rerun. |
| Final typecheck/build | `npx tsc --noEmit` — **exit 0**, rerun independently after the test-only correction because tests are included by tsconfig. `npm run build` — **exit 0**, ESM and declarations. | Build evidence is reused because its application/configuration inputs are unchanged. Final typecheck evidence covers the corrected tests. |
| Final links and CLI smoke | Task 8 PowerShell local-target validator — **exit 0**; `node bin/agy-supervisor.js --help` — **exit 0**. | Final evidence-only document/link scope is checked after this record is updated; unchanged application evidence remains valid. |

### Independent review and fix history

The registered reviewer returned nine required findings covering exact source-anchor rows, disappearing anchors, same-chunk takeover bytes, overlay row budgets, ended-agent presentation, pause feedback, progress provenance, independent cursor restoration, and the retained Task 7 command. Implementers fixed each finding with focused regressions; the same reviewer rechecked until **APPROVED**, with no remaining advisory nits. Anchor rechecks included zero offsets, long multi-row tokens, monochrome decorations, full task labels, plain notes, commit lines, legacy completion records and private-renderer cleanup. After the first full verifier found the obsolete completion-card assertion, its test-only fix received separate reviewer approval before the passing full rerun. No application code changed after final approval.

Graph reads/refreshes were rejected by automatic approval review for possible repository source or metadata export. No graph workaround was used; final review used local source. This tooling limitation does not supply runtime evidence.

### Revision and working-tree fingerprint

At the verification handoff, Git HEAD was `47c79049af5b8da7c12e1dcb3093070f01805478`, with implementation and documentation in the reviewed working tree. The independent verifier's passing-run manifest covers 50 source/test/document files and has SHA-256 `7296f439eb2d2cda55f7af89a6900ea5c2150f54af905688ad309a46a2d08572`. It identifies the reviewed/tested tree before final evidence-only document updates. Unrelated pre-existing docs and fixtures are excluded. Final document hashes and links are validated separately; the tested application source, tests, dependencies and configuration are unchanged. A working-tree fingerprint is an identity aid, not a commit or signed patch. No commit, push or merge was performed during implementation verification; subsequent delivery is identified by Git history and the pull request.

## Runtime discovery and live acceptance

Read-only discovery on 2026-10-24 found `agy 1.4.7`; `agy plugin list` reported `antigravity-coding-team` version `1.0.0` enabled. `agy --help` exposes `--model`. `--mode` help listed `accept-edits`, `auto`, and `plan`; it does not verify a current `request-review` setting. No signed-in interactive acceptance run was performed. The two user-supplied 2026-10-24 Stage 0 terminal captures are recorded separately in the [Stage 0 review](stage-0-runtime-contract-review.md), with their provenance and limitations. They are not fresh live acceptance for this implementation.

No POSIX terminal was available. A sandboxed WSL query returned `E_ACCESSDENIED`; an elevated read-only query exited 0 with no distro listed. No Windows Terminal/ConPTY run of this Stage A build occurred. Thus native `agy`, current permission mode, Windows live resize/input/cleanup, and POSIX pause/terminal behavior remain open.

### Live protocol for the later acceptance owner

Use a disposable workspace and a signed-in local CLI. First record current `agy --version`, `agy plugin list`, `agy --help`, and permission setting; require `request-review` for native interaction. Do not use skip-permissions or alter global hooks/settings. The planned Windows launch is:

```powershell
node bin/agy-supervisor.js --help
$liveWorkspace = Join-Path $env:TEMP ('agysup-stage-a-live-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $liveWorkspace | Out-Null
node --input-type=module -e "import { runCommand } from './dist/cli/index.js'; await runCommand(process.argv[1], { args: ['--model', 'claude-sonnet-5-5-medium'] });" $liveWorkspace
```

On POSIX, build the same checkout and call the same exported `runCommand` API with a disposable directory from `mktemp -d`; use that environment's documented temporary-root handling. Do not add a CLI argument-passthrough flag. If model access or signed-in authentication is unavailable, record the actual error and stop that live protocol rather than changing model or permission settings.

Record separately on Windows Terminal/ConPTY and one identified POSIX terminal:

1. A harmless read-only conversation, a clarification question, and multiline output longer than the viewport. Walk oldest/latest content and every row of a tall card; scroll back while output arrives, then resize 100×32, 80×24, 60×18, 30×8 and grow again. Record visible markers, row bounds, focus, and recovery.
2. One harmless permission approval and one decline only when a native prompt appears. Record exactly what the native tool result says; do not equate assistant prose, a prompt, or an exit code with action execution.
3. Answer one question once, defer/refocus another, visit rail/zoom/overlays, then enter and leave raw takeover. Confirm no trailing Enter answers the next question.
4. Pause, queue a harmless message, resume and observe the write. On Windows, record whether the child continues. On POSIX, record the attempted signal and observed behavior without claiming all descendants froze. Exit while paused and check that queued input cannot leak into a later process run.
5. Exercise normal quit, child exit, nonzero exit, and catchable Ctrl+C/termination through disposable Node PTY children. Check factual ledger outcome, restored screen/cursor/input, shell echo, and absence of an owned orphan child. Distinguish these Node-child checks from native `agy` behavior.

Record exact OS/terminal/Node/npm/agy/plugin versions, permission mode, commands, exits, outcomes, output relevant to each criterion, and any skipped path. Leave a result **NOT RUN** until it is actually performed.

### Emergency recovery

- Prefer the TUI's normal quit path (`Ctrl+C` twice) and wait for the process outcome and terminal restoration.
- If an unexpected failure leaves a POSIX terminal in raw or alternate-screen mode, try `stty sane; printf '\033[?1049l\033[0m\033[?25h'` in that terminal, or open a fresh terminal. On Windows, close and reopen the terminal tab if normal display/input does not return.
- Confirm the supervisor-owned child has stopped before removing a disposable workspace. Do not kill unrelated `agy` processes or change global permission/hook configuration as recovery.
- An uncatchable kill or host crash cannot run cleanup. The ledger is not a crash-recovery engine and may lack a terminal outcome for that interruption.

## Documentation checks

Task 8 validates relative Markdown targets and manually checks key anchors after the files are written. The external links in the Stage 0 review are historical/source references; this task does not requalify their live content. No application tests, full build, or live acceptance are performed solely to validate documentation.

## Remaining limitations

- Stage 0 remains incomplete. The user-confirmed cleanup and two supplied interactive captures address specific historical cells only; current `request-review` and runtime hook-loading diagnostics are not verified.
- The passive PTY parser and artifact polling do not supply authoritative, ordered, replay-safe runtime events. They cannot establish atomic permission binding, ownership, or delivery.
- Pause may not stop the process tree. `--resume` does not restart or reconnect a child. An uncatchable crash cannot restore a terminal or guarantee a persisted process outcome.
- Independent code review and full automated verification pass. Native `agy`, Windows live terminal and POSIX live acceptance remain **NOT RUN** and are required before Stage A is accepted. No POSIX distribution was available through the installed WSL query. The live protocol above identifies the concrete remaining checks.
