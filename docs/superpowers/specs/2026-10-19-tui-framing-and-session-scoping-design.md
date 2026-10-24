# TUI Framing, Viewport & Session Scoping Fixes — Design Spec

## 1. Goal

Fix the structural layout, visual framing, session artifact scoping, lifecycle status transitions, and input/telemetry bugs identified in the conversational TUI overhaul so that:
1. Launching `agysup` renders a full-viewport, structurally framed terminal interface in the alternate screen buffer with horizontal/vertical rules and T-junctions matching [`docs/tui-design/agysup TUI UX and UI spec.md`](file:///D:/Code/AntigravityMasterSupervisor/docs/tui-design/agysup%20TUI%20UX%20and%20UI%20spec.md).
2. Starting a new session displays a clean initial state (only the initial supervisor greeting, `Spec ▸` active, hidden team rail, `"Describe what you want built"` placeholder) instead of loading historical workspace specs/plans or immediately jumping into `EXECUTING` (`Plan approved. Starting execution.`).
3. Pre-existing specs/plans from prior sessions are ignored unless modified/created during the active session (`mtimeMs >= sessionStartedAt`) or the user explicitly passes `--resume`.

---

## 2. User-Approved Decisions

1. **Session Scoping & `--resume` CLI Flag:**
   - Default `agysup run` starts a fresh session (`resetSessionLedger(projectDir)` or `initLedger(projectDir, { reset: !options?.resume })`), recording the session's `createdAt` timestamp and resetting `status: 'IDLE'`, `checkpoints` to `'UNINITIALIZED'`, and `activeAgent: null`.
   - Workspace polling (`pollWorkspaceOnce`) filters candidate spec and plan files by `fileStat.mtimeMs >= minMtimeMs` (where `minMtimeMs` defaults to the active session's start timestamp unless `--resume` is active).
   - Add `--resume` to `agysup` / `agysup run` in [`src/cli/index.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/cli/index.ts) and [`src/cli/commands/run.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/cli/commands/run.ts) to preserve the prior `.agy/supervisor_state.json` and allow loading existing workspace spec/plan artifacts (`minMtimeMs = 0`).
2. **Full-Screen Viewport & Structural Framing:**
   - Enter the terminal alternate screen buffer (`\x1b[?1049h\x1b[2J\x1b[H`) on TUI mount in [`src/tui/index.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts) when `process.stdout.isTTY` is true, and restore the main screen buffer (`\x1b[?1049l`) on cleanup/unmount.
   - Set explicit `height={rows}` and `overflow="hidden"` on the root `<Box>` in [`src/tui/App.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx#L671) so `flexGrow={1}` expands the body region to fill the terminal viewport.
   - Render structural divider rules in theme token `line` (`#2C4A5E`) as specified in Section 2 of [`docs/tui-design/agysup TUI UX and UI spec.md`](file:///D:/Code/AntigravityMasterSupervisor/docs/tui-design/agysup%20TUI%20UX%20and%20UI%20spec.md#L23-L38):
     - A 1-row horizontal rule beneath `HeaderBar` (`─` across full width, or `─` + `┬` + `─` aligned with the 32-column `TeamRail` when side-by-side).
     - A 1-column vertical rule (`│` repeated for `bodyRows` in `theme.colors.line`) between the left body pane (`Transcript` / `ZoomView`) and `TeamRail` when `isRailSideBySide` is true.
     - A 1-row horizontal rule above the `Composer` / `FooterBar` area (`─` across full width, or `─` + `┴` + `─` when `isRailSideBySide` is true and composer is visible).
3. **Session Lifecycle & Phase Strip Behavior:**
   - Do not unconditionally mutate `ledger.status = 'EXECUTING'` on startup in [`src/cli/commands/run.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/cli/commands/run.ts#L134-L147). On a fresh session, start in `'PLANNING'` (or remain `'IDLE'` until start, without emitting a fake `'EXECUTING'` phase transition).
   - Transition `ledger.status` to `'EXECUTING'` only when a plan is discovered/approved in the session, when an execution subagent (`orchestrator`, `implementer`, `code-reviewer`, `verifier`) starts, or when `--resume` resumes an active execution ledger.
   - Ensure `HeaderBar` phase strip never marks both `Spec ▸` and `Build ▸` simultaneously active.
4. **Git Branch Detection & Fallback:**
   - In [`src/core/discovery.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/core/discovery.ts#L56-L78), if `git branch --show-current` throws or returns empty, always attempt `git rev-parse --abbrev-ref HEAD` before falling back.
   - In [`src/telemetry/poller.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/poller.ts#L241-L247), when `gitResult.isGit` is false or `gitResult.branch` is unavailable, fall back to `path.basename(resolvedDir)` instead of `'unknown'`.

---

## 3. Architecture & Component Changes

### 3.1 Session Scoping & Ledger Initialization
- **[`src/cli/index.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/cli/index.ts) & [`src/cli/commands/run.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/cli/commands/run.ts):**
  - Add `resume?: boolean` to `RunOptions` and register `--resume` on both root and `run` CLI commands.
  - In `runCommand`:
    - Call `initLedger(projectDir, { reset: !options?.resume })`.
    - When starting `ptyRunner`, if `!options?.resume`, set `ledger.status = 'PLANNING'` (instead of `'EXECUTING'`). If `options?.resume` is true and the existing ledger already has tasks/plan or was `'EXECUTING'`, preserve its status.
    - Pass `sessionStartedAt` (from `Date.parse(ledger.createdAt)` when `!options?.resume`, or `0` when `options?.resume`) into `mountSupervisorTui`.
- **[`src/core/ledger.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/core/ledger.ts):**
  - Extend `initLedger(projectDir: string, options?: { reset?: boolean }): SupervisorLedger`. When `options?.reset` is `true`, create and atomically save a fresh default ledger with a new `sessionId`, `createdAt: now`, `status: 'IDLE'`, and `'UNINITIALIZED'` checkpoints.
- **[`src/telemetry/poller.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/poller.ts) & [`src/telemetry/store.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/store.ts):**
  - Extend `PollWorkspaceOptions` with `minMtimeMs?: number`.
  - In `findLatestFile(projectDir, relativeDirs, filePattern, minMtimeMs)`: ignore files where `minMtimeMs !== undefined && fileStat.mtimeMs < minMtimeMs`.
  - In `TelemetryStoreOptions`, accept `sessionStartedAt?: number` and pass `minMtimeMs: this.sessionStartedAt` to `pollWorkspaceOnce()`.
  - When a session-scoped plan with tasks (`tasks.length > 0`) is discovered or an execution subagent starts (`orchestrator`, `implementer`, `code-reviewer`, `verifier`), transition the ledger from `'PLANNING'` / `'CHECKPOINT_SPEC'` to `'EXECUTING'`.

### 3.2 Viewport Framing, Alternate Screen Buffer & Layout Height
- **[`src/tui/index.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts):**
  - On `mountSupervisorTui`: if `process.stdout.isTTY`, write `\x1b[?1049h\x1b[2J\x1b[H` before `render(...)`.
  - On `cleanup`: if `process.stdout.isTTY`, write `\x1b[?1049l` after `inkInstance.unmount()`.
- **[`src/tui/App.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx):**
  - Root container: `<Box flexDirection="column" width={columns} height={rows} overflow="hidden">`.
  - Add helper `renderHorizontalRule(columns: number, isRailSplit: boolean, junctionChar: string, lineColor: string, ruleChar: string)` to render:
    - Top divider directly below `HeaderBar` using `glyphs.teeDown` (`┬` / `+`) at column `columns - 33` when `isRailSideBySide` is active in main body view, or a continuous `glyphs.hr` (`─` / `-`) line otherwise.
    - Bottom divider directly above `Composer` (or above `FooterBar` when composer is hidden) using `glyphs.teeUp` (`┴` / `+`) at column `columns - 33` when `isRailSideBySide` is active, or a continuous `glyphs.hr` line otherwise.
  - Between the left pane (`<Box flexGrow={1}>`) and `<TeamRail width={32} ... />`, render a 1-column vertical divider `<Box width={1} flexDirection="column">` containing `bodyRows` lines of `glyphs.vr` (`│` / `|`) in `theme.colors.line`.
  - Update `bodyRows` calculation to account for exact fixed rows:
    - `HeaderBar` (1 row) + top horizontal rule (1 row) + bottom horizontal rule (1 row) + `Composer` (1–4 rows when visible, plus `CommandPalette` rows when open) + `FooterBar` (1 row).
- **[`src/tui/glyphs.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/glyphs.ts):**
  - Ensure `GlyphSet` includes `vr` (`│` in Unicode, `|` in ASCII), `teeDown` (`┬` in Unicode, `+` in ASCII), and `teeUp` (`┴` in Unicode, `+` in ASCII) alongside existing `hr` (`─` / `-`).

### 3.3 HeaderBar, Narrator, and TeamRail Fixes
- **[`src/tui/components/HeaderBar.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/HeaderBar.tsx):**
  - Ensure phase active state is mutually exclusive:
    - `buildCurrent`: `((specApproved && planApproved) || (status === 'EXECUTING' && totalTasks > 0)) && status !== 'COMPLETED'`
    - `planCurrent`: `!buildCurrent && (specDone || status === 'CHECKPOINT_SPEC') && !planDone && status !== 'COMPLETED'`
    - `specCurrent`: `!buildCurrent && !planCurrent && !specDone && status !== 'COMPLETED'`
- **[`src/tui/narrator.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/narrator.ts) & [`src/tui/narrator-copy.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/narrator-copy.ts):**
  - Do not emit `'Plan approved. Starting execution.'` when transitioning from `'IDLE'` to `'PLANNING'`, or when `nextStatus === 'EXECUTING'` but `state.tasks.length === 0` and `!state.hasStarted`.
- **[`src/tui/components/TeamRail.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/TeamRail.tsx):**
  - Treat `ledgerStatus === 'IDLE' || ledgerStatus === 'INITIALIZING' || ledgerStatus === 'PLANNING' || ledgerStatus === 'CHECKPOINT_SPEC'` with `tasks.length === 0` as planning phase (`planner`, `researcher`, `plan-critic`) so that opening the rail with `Tab` during early session discovery shows the planning team rather than `orchestrator`/`implementer`.

### 3.4 Input, Viewport Slicing, Card & Parser Bug Fixes
- **Windows CRLF Double-Enter Fix ([`src/tui/App.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx#L470-L472)):**
  - In `processNavChunk`, when `char === '\r'` and `input[i] === '\n'`, advance `i++` to consume the `\r\n` pair as a single Enter keystroke.
- **Transcript Row-Height Slicing ([`src/tui/components/Transcript.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/Transcript.tsx#L259-L265)):**
  - Estimate each transcript item's rendered terminal row height (e.g., 1–2 rows for notes/turns, 4–6 rows for `DelegationCard`, `4 + options.length` rows for `DecisionCard`/`FailureCard`, 5 rows for `CompletionCard`) and slice visible items so total estimated rows fit within `maxRows`, wrapped in `<Box flexDirection="column" height={maxRows} overflow="hidden">`.
- **Decision & FailureCard Parity ([`src/tui/App.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx), [`src/tui/transcript-store.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/transcript-store.ts), [`src/tui/components/FooterBar.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/FooterBar.tsx), [`src/tui/components/FailureCard.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/FailureCard.tsx)):**
  - Include `FailureCard` alongside `DecisionCard` for `decisionOptionCount`, `deferFocusedDecision()` (`Esc`), and digit selection bounds checking (`digit <= options.length`).
  - Pass `decisionOptionCount` to `FooterBar` so it renders dynamic option digits (e.g. `1 2 choose` for 2 options, `1 2 3 choose` for 3 options) instead of hardcoding `1 2 3 choose`.
  - In `FailureCard.tsx`, do not wrap the fallback string (`"The <role> reported it is blocked and did not say why..."`) in quotation marks when `item.reason` is empty/missing.
- **Takeover Banner De-duplication ([`src/tui/components/TakeoverView.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/TakeoverView.tsx)):**
  - Keep the return instruction (`"You are typing into the agent's terminal. Press Ctrl+] to return."`) in `FooterBar` (or top 1-line banner only) without duplicating it in both places.
- **CommandPalette Keyboard Navigation ([`src/tui/App.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx), [`src/tui/components/CommandPalette.tsx`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/CommandPalette.tsx)):**
  - Support Up/Down arrow selection and `Tab` autocomplete when `composerText.startsWith('/')` and matching slash commands exist.
- **TelemetryParser `<SYSTEM_MESSAGE>` Subagent Completion Guard ([`src/telemetry/parser.ts`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/parser.ts#L315-L335)):**
  - Only complete an active subagent on `isSystemMsg` when an explicit verdict (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`, `READY`, `FINDINGS`, `Approve`, `Request changes`) is matched or a return-message header from the subagent is detected, rather than blindly defaulting every `<SYSTEM_MESSAGE>` line to `'DONE'`.

---

## 4. Autonomous Engineering Defaults

- **Terminal Resize & Cleanup:** Automatically recalculate `bodyRows`, horizontal rule widths, and vertical rule height on `stdout` resize events; always emit `\x1b[?1049l` on unmount/exit to leave the user's shell clean.
- **Non-TTY / Test Compatibility:** Only emit `\x1b[?1049h` / `\x1b[?1049l` when `process.stdout.isTTY` is truthy so `ink-testing-library` unit tests remain clean and unaffected by alternate screen escape codes.
- **Backward-Compatible Defaults:** When `pollWorkspaceOnce(projectDir)` is called directly by unit tests without `minMtimeMs`, default `minMtimeMs` to `undefined` (no mtime filtering) unless `TelemetryStore` provides `sessionStartedAt`.

---

## 5. Out of Scope

- Changing the core 8-token truecolor palette or round card border aesthetic defined in [`docs/tui-design/agysup TUI UX and UI spec.md`](file:///D:/Code/AntigravityMasterSupervisor/docs/tui-design/agysup%20TUI%20UX%20and%20UI%20spec.md).
- Adding mouse scrolling or clickable UI widgets.
- Modifying Antigravity (`agy`) internal agent prompts or plugin rules outside this repository.
