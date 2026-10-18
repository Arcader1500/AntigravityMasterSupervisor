# Interactive TUI Dashboard, Live PTY Control & Stream Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `agy-supervisor` with a multi-panel Ink TUI dashboard, modal keyboard passthrough for controlling the live `agy` ConPTY session, a headless virtual terminal buffer (`@xterm/headless`), a pure passive regex stream telemetry parser, a workspace Git/artifact poller, and updated architecture documentation.

**Architecture:** `PtyRunner` (`src/pty/runner.ts:21`) streams raw ANSI chunks into `VirtualTerminal` (`@xterm/headless`), which maintains an accurate 2D terminal buffer for Panel `[2]` and emits settled plain-text lines to `TelemetryParser`. `WorkspacePoller` inspects Git branch/commit state and discovers Spec/Plan markdown artifacts in `docs/superpowers/{specs,plans}/` and `docs/plans/`, feeding `TelemetryStore`, which drives a 4-panel React/Ink TUI (`src/tui/App.tsx`) with Vim/Tmux-style modal input routing (`i`/`Enter` to lock keyboard into `agy`, `Ctrl+]` to detach back to TUI navigation) and a `--no-tui` raw stdio passthrough mode.

**Tech Stack:** Node.js (>=18), TypeScript (ESM + React JSX), `ink`, `react`, `@xterm/headless`, `node-pty`, `commander`, `colorette`, `tsup`, `vitest`, `ink-testing-library`.

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| Wave 1 | Task 1 | Dependencies (`ink`, `react`, `@xterm/headless`), JSX build config, and Architecture Doc status update | `package.json`, `package-lock.json`, `tsconfig.json`, `docs/antigravity_master_supervisor_architecture.md` |
| Wave 2 | Task 2, Task 3 | Headless virtual terminal + raw stdio passthrough + `PtyRunner` PID helpers (Task 2); Telemetry schemas + passive regex parser (Task 3) | Task 2: `src/pty/types.ts`, `src/pty/runner.ts`, `src/pty/virtual-terminal.ts`, `src/pty/raw-passthrough.ts`, `tests/unit/runner.test.ts`, `tests/unit/virtual-terminal.test.ts`, `tests/unit/raw-passthrough.test.ts`<br/>Task 3: `src/telemetry/types.ts`, `src/telemetry/parser.ts`, `tests/unit/telemetry-parser.test.ts` |
| Wave 3 | Task 4 | Workspace Git & Spec/Plan markdown poller and observable `TelemetryStore` | `src/telemetry/poller.ts`, `src/telemetry/store.ts`, `tests/unit/telemetry-poller.test.ts`, `tests/unit/telemetry-store.test.ts` |
| Wave 4 | Task 5, Task 6 | Ink TUI panels (`HeaderBar`, `FooterBar`, `MainStatusView`, `SpecPlanView`, `AuditLogView` in Task 5; `LivePtyView` in Task 6) | Task 5: `src/tui/components/HeaderBar.tsx`, `src/tui/components/FooterBar.tsx`, `src/tui/components/MainStatusView.tsx`, `src/tui/components/SpecPlanView.tsx`, `src/tui/components/AuditLogView.tsx`, `tests/unit/tui-views.test.tsx`<br/>Task 6: `src/tui/components/LivePtyView.tsx`, `tests/unit/live-pty-view.test.tsx` |
| Wave 5 | Task 7 | Root `App.tsx` with modal input router (`NAVIGATION` vs `PTY_INTERACT` + `Ctrl+]`) and `mountSupervisorTui` | `src/tui/App.tsx`, `src/tui/index.ts`, `tests/unit/tui-app.test.tsx` |
| Wave 6 | Task 8 | CLI `--no-tui` & `--agent` wiring in `runCommand`, root exports, and integration verification | `src/cli/index.ts`, `src/cli/commands/run.ts`, `src/index.ts`, `tests/unit/cli.test.ts`, `tests/integration/tui-run.test.ts` |

---

## Tasks

### Task 1: Dependencies, JSX Build Configuration & Architecture Doc Status Update

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `package.json:36-46`
- Modify: `tsconfig.json:2-11`
- Modify: `docs/antigravity_master_supervisor_architecture.md:1-241`

- [ ] **Step 1: Add runtime and test dependencies to `package.json` and enable JSX in `tsconfig.json`**
  - In `package.json:36-46`, add runtime dependencies `@xterm/headless` (`^5.5.0`), `ink` (`^5.0.1`), and `react` (`^18.3.1`), and devDependencies `@types/react` (`^18.3.0`) and `ink-testing-library` (`^4.0.0`).
  - In `tsconfig.json:2-11`, add `"jsx": "react-jsx"` inside `compilerOptions`.
  - Run `npm install` to update `node_modules` and `package-lock.json`.

- [ ] **Step 2: Update `docs/antigravity_master_supervisor_architecture.md` with current project status and TypeScript architecture**
  - Update Section 2 (`docs/antigravity_master_supervisor_architecture.md:23-45`) and Section 3 (`docs/antigravity_master_supervisor_architecture.md:166-179`) to reflect the **TypeScript / Node.js stack**:
    - Replace `Python Master Supervisor TUI (Textual App)` with `TypeScript Master Supervisor TUI (Ink + React CLI App)`.
    - Replace `pywinpty` / `pexpect` with `node-pty (Windows ConPTY & POSIX PTY)` (`src/pty/runner.ts:21`).
    - Replace `pyte` with `@xterm/headless (Virtual Terminal Buffer)`.
    - Update `[2] Live PTY Terminal Panel` description to specify **Modal PTY Interaction**: press `i` or `Enter` on Tab `[2]` (or `t` globally) to lock keyboard input into `agy`, and `Ctrl+]` to detach back to TUI tab navigation.
    - Update `[3] Spec & Plan Reader` and Workspace Persistence (`docs/antigravity_master_supervisor_architecture.md:50-53`) to list `docs/superpowers/specs/*-design.md` and `docs/superpowers/plans/*-plan.md` alongside `docs/plans/`.
  - Add **Section 1.3: Project Status & Milestone Roadmap** immediately after Section 1 (`docs/antigravity_master_supervisor_architecture.md:18`):
    - **Milestone 1 (Foundation & Packaging) — ✅ COMPLETED:** CLI binaries (`agy-supervisor`, `agysup`), `doctor` preflight (`src/core/discovery.ts:333`), atomic `.agy/supervisor_state.json` ledger (`src/core/ledger.ts:17`), and `PtyRunner` (`src/pty/runner.ts:21`) with 54 passing tests.
    - **Milestone 2 (Interactive TUI, Live PTY Control & Passive Telemetry) — 🚧 IN PROGRESS:** Multi-panel Ink TUI (`[1]`–`[4]`), `@xterm/headless` virtual terminal, Vim/Tmux-style modal PTY keyboard lock (`i`/`Enter` to focus, `Ctrl+]` to detach), `--no-tui` raw passthrough, passive regex telemetry parser, and Git/artifact poller.
    - **Milestone 3 (Two-Tier Supervisor Intelligence & Checkpoint Gate) — ⏳ PLANNED:** `jev` reflex permission classifier (`ctrl+k`), `supervisor.md` autonomous Q&A reasoner, auto-popup escalation modal (`[E]`), and automatic 2-checkpoint `planner` $\rightarrow$ `orchestrator` PTY handoff.
  - Update **Section 5: Open Design Decisions** (`docs/antigravity_master_supervisor_architecture.md:235-241`):
    - Mark **OD-1** as **RESOLVED (Milestone 2):** Pure Passive Regex Parsing against `@xterm/headless` terminal lines + workspace artifact polling (no sentinel tags required).
    - Mark **OD-5** as **RESOLVED (Milestone 1):** `node-pty` with `useConpty: true` on Windows (`src/pty/runner.ts:95-97`).

- [ ] **Step 3: Run verification commands**
  - Run: `npx tsc --noEmit && npm test`
  - Expected: Exit code 0 with all 54 existing tests passing and `@xterm/headless`, `ink`, `react` resolvable by TypeScript.

- [ ] **Step 4: Commit**
  - `git add package.json package-lock.json tsconfig.json docs/antigravity_master_supervisor_architecture.md`
  - `git commit -m "docs(arch): update architecture status for Phase 2 and configure Ink/xterm dependencies"`

---

### Task 2: Headless Virtual Terminal Buffer, Raw Stdin Passthrough & `PtyRunner` PID Helpers

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Modify: `src/pty/types.ts:40-54`
- Modify: `src/pty/runner.ts:37-57`
- Create: `src/pty/virtual-terminal.ts`
- Create: `src/pty/raw-passthrough.ts`
- Modify: `tests/unit/runner.test.ts:1-178`
- Create: `tests/unit/virtual-terminal.test.ts`
- Create: `tests/unit/raw-passthrough.test.ts`

- [ ] **Step 1: Write failing unit tests for `PtyRunner.getPid()`, `VirtualTerminal`, and `attachRawPassthrough`**
  - In `tests/unit/runner.test.ts`, add a test verifying `runner.getPid()` returns `undefined` before start / in dry-run and a numeric PID during a live `process.execPath` spawn, and `runner.isProcessRunning()` reflects running state.
  - Create `tests/unit/virtual-terminal.test.ts` testing `VirtualTerminal`:
    - Writing ANSI sequences (`\x1b[32mHello\x1b[0m\r\nWorld\r\n`) updates `getViewportLines()` with stripped plain-text lines `["Hello", "World"]` (padded/sliced to viewport height).
    - Carriage-return spinner overwrites (`frame1\rframe2\rDone\r\n`) resolve to `"Done"` on the line and invoke `onLineCommit` listeners with `"Done"` without emitting duplicate empty lines.
    - `resize(100, 40)` updates `getCols()` / `getRows()` to `100` and `40`.
  - Create `tests/unit/raw-passthrough.test.ts` testing `attachRawPassthrough`:
    - Using an `EventEmitter` mock stream with `isTTY = true` and `setRawMode = vi.fn()`, verify incoming buffer chunks on `stdin` call `ptyRunner.write(chunk.toString('utf8'))`, `stdout` resize events call `ptyRunner.resize(cols, rows)`, and calling `detach()` restores `setRawMode(false)` and removes listeners.

```typescript
import { describe, it, expect } from 'vitest';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';

describe('VirtualTerminal', () => {
  it('buffers ANSI streams, handles carriage-return overwrites, and emits settled lines', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    const committed: string[] = [];
    vt.onLineCommit((line) => committed.push(line));

    await vt.write('\x1b[36mSpinning...\x1b[0m\r\x1b[2KCompleted step 1\r\nSecond line\r\n');
    const lines = vt.getViewportLines();
    expect(lines[0]).toBe('Completed step 1');
    expect(lines[1]).toBe('Second line');
    expect(committed).toContain('Completed step 1');
    expect(committed).toContain('Second line');
    vt.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (Red)**
  - Run: `npx vitest run tests/unit/runner.test.ts tests/unit/virtual-terminal.test.ts tests/unit/raw-passthrough.test.ts`
  - Expected: FAIL due to missing `src/pty/virtual-terminal.js`, `src/pty/raw-passthrough.js`, and `getPid` on `PtyRunner`.

- [ ] **Step 3: Implement `PtyRunner` helpers, `VirtualTerminal`, and `attachRawPassthrough`**
  - In `src/pty/runner.ts:37-57`, add:
    - `getPid(): number | undefined { return this.ptyProcess?.pid; }`
    - `isProcessRunning(): boolean { return this.isRunning; }`
  - In `src/pty/types.ts`, export `VirtualTerminalOptions` (`cols?: number; rows?: number; scrollback?: number`) and `RawPassthroughHandle` (`detach: () => void`).
  - In `src/pty/virtual-terminal.ts`, implement `VirtualTerminal` wrapping `@xterm/headless` (`Terminal` from `@xterm/headless` with `{ cols, rows, scrollback: 1000, allowProposedApi: true }`):
    - `write(data: string): Promise<void>`: writes `data` into `this.term.write(data, resolve)` and inspects newly committed lines before the cursor row (`buffer.active.baseY + buffer.active.cursorY`), emitting deduplicated non-empty trimmed lines via `onLineCommit` callbacks.
    - `getViewportLines(maxRows?: number): string[]`: reads `this.term.buffer.active` from `viewportY` for `rows` lines using `line.translateToString(true)`, returning visible non-trailing-blank lines (or up to `maxRows` lines).
    - `getCursorLine(): string`: returns the current active cursor line `translateToString(true)`.
    - `resize(cols: number, rows: number): void`, `getCols(): number`, `getRows(): number`, `dispose(): void`.
  - In `src/pty/raw-passthrough.ts`, implement:
    - `attachRawPassthrough(ptyRunner: Pick<PtyRunner, 'write' | 'resize'>, stdin?: NodeJS.ReadStream, stdout?: NodeJS.WriteStream): RawPassthroughHandle`
    - Enables `stdin.setRawMode(true)` if `stdin.isTTY && typeof stdin.setRawMode === 'function'`, calls `stdin.resume()`, forwards `stdin.on('data', ...)` to `ptyRunner.write(...)`, forwards `stdout.on('resize', ...)` to `ptyRunner.resize(stdout.columns, stdout.rows)`, and returns `{ detach }` which removes listeners and restores raw mode.

- [ ] **Step 4: Run tests to verify they pass (Green)**
  - Run: `npx vitest run tests/unit/runner.test.ts tests/unit/virtual-terminal.test.ts tests/unit/raw-passthrough.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/pty/types.ts src/pty/runner.ts src/pty/virtual-terminal.ts src/pty/raw-passthrough.ts tests/unit/runner.test.ts tests/unit/virtual-terminal.test.ts tests/unit/raw-passthrough.test.ts`
  - `git commit -m "feat(pty): add @xterm/headless VirtualTerminal and raw stdin passthrough"`

---

### Task 3: Telemetry Schemas & Pure Passive Regex Stream Parser

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Create: `src/telemetry/types.ts`
- Create: `src/telemetry/parser.ts`
- Create: `tests/unit/telemetry-parser.test.ts`

- [ ] **Step 1: Write failing unit tests for `TelemetryParser` (`tests/unit/telemetry-parser.test.ts`)**
  - Test passive detection of:
    1. **Subagent dispatches:** Lines matching `invoke_subagent` or subagent role/type names (`researcher`, `plan-critic`, `implementer`, `code-reviewer`, `verifier`, e.g., `Invoking subagent: researcher (Codebase Researcher)` or `"TypeName": "implementer"`) set `state.activeSubagent` to the matched subagent name and emit an activity item with actor `ORCH` or `PLANNER`.
    2. **Subagent completion:** Lines matching `[Message] timestamp=... sender=...` or `SYSTEM_MESSAGE` or status verdicts (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`, `READY`) clear `activeSubagent` (or record completion) and append an activity feed entry.
    3. **Tool actions:** Lines matching tool names (`view_file`, `write_to_file`, `edit_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `grep_search`, `ask_question`, `call_mcp_tool`) or `toolAction` / file path patterns update `state.lastAction` and append a deduplicated `ActivityFeedItem` (capped at 100 items).
    4. **Command execution:** Lines matching command executions or exit codes (e.g. `run_command: npm test`, `Exit code: 0`, `Exit 0`) update `state.lastCommand`.
    5. **Interactive prompts (`waitingForInput`):** Lines matching `ask_question` prompts, `? `, or `ctrl+k` / `Allow command` permission prompts set `state.waitingForInput = true`, and subsequent tool/input progress clears `waitingForInput = false`.

```typescript
import { describe, it, expect } from 'vitest';
import { TelemetryParser } from '../../src/telemetry/parser.js';

describe('TelemetryParser (Pure Passive Regex)', () => {
  it('detects active subagent dispatch, tool actions, commands, and interactive prompts', () => {
    const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

    parser.processLine('invoke_subagent -> implementer (Task 2 Worker)');
    expect(parser.getState().activeSubagent).toBe('implementer');

    parser.processLine('write_to_file -> src/telemetry/parser.ts');
    expect(parser.getState().lastAction).toContain('write_to_file');
    expect(parser.getState().lastAction).toContain('src/telemetry/parser.ts');

    parser.processLine('run_command: npx vitest run (Exit 0)');
    expect(parser.getState().lastCommand).toContain('npx vitest run');

    parser.processLine('Press ctrl+k to approve command execution');
    expect(parser.getState().waitingForInput).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (Red)**
  - Run: `npx vitest run tests/unit/telemetry-parser.test.ts`
  - Expected: FAIL due to missing `src/telemetry/parser.js`.

- [ ] **Step 3: Implement `src/telemetry/types.ts` and `src/telemetry/parser.ts`**
  - In `src/telemetry/types.ts`, define and export:
    - `TuiPanelId = 1 | 2 | 3 | 4`
    - `InputMode = 'NAVIGATION' | 'PTY_INTERACT'`
    - `ActivityFeedItem`: `{ id: string; timestamp: string; actor: string; message: string }`
    - `PlanTaskItem`: `{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed'; commitSha?: string }`
    - `ParserState`: `{ mainAgent: string; activeSubagent: string | null; subagentStartedAt: number | null; lastAction: string | null; lastCommand: string | null; waitingForInput: boolean; activityFeed: ActivityFeedItem[] }`
    - `WorkspacePollSnapshot`: `{ branch: string; dirtyFilesCount: number; lastCommit?: { sha: string; subject: string }; specPath: string | null; specContent: string | null; planPath: string | null; planContent: string | null; tasks: PlanTaskItem[] }`
    - `TelemetrySnapshot`: full merged interface matching Spec Section 4.2.
  - In `src/telemetry/parser.ts`, implement `TelemetryParser`:
    - Constructor `constructor(options?: { mainAgent?: string; maxFeedItems?: number })` (defaults: `mainAgent = 'agy'`, `maxFeedItems = 100`).
    - `processLine(rawLine: string): void`: strips remaining ANSI sequences if any, ignores blank or pure box-drawing/spinner lines, applies passive regex rules for subagent start/end, tool calls, command results, and interactive input prompts (`ask_question`, `ctrl+k`), and pushes deduplicated `ActivityFeedItem` entries (ignoring consecutive identical messages).
    - `clearWaitingForInput(): void`: resets `waitingForInput = false` (called when user sends keystrokes into the PTY).
    - `getState(): Readonly<ParserState>`.

- [ ] **Step 4: Run test to verify it passes (Green)**
  - Run: `npx vitest run tests/unit/telemetry-parser.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/telemetry/types.ts src/telemetry/parser.ts tests/unit/telemetry-parser.test.ts`
  - `git commit -m "feat(telemetry): implement pure passive regex TelemetryParser and schemas"`

---

### Task 4: Workspace Git & Spec/Plan Artifact Poller and `TelemetryStore`

**Wave:** 3  
**Depends on:** Task 2, Task 3  
**Files Touched:**
- Create: `src/telemetry/poller.ts`
- Create: `src/telemetry/store.ts`
- Create: `tests/unit/telemetry-poller.test.ts`
- Create: `tests/unit/telemetry-store.test.ts`

- [ ] **Step 1: Write failing unit tests for `WorkspacePoller` and `TelemetryStore`**
  - In `tests/unit/telemetry-poller.test.ts`:
    - Create a temporary directory via `fs.mkdtempSync(path.join(os.tmpdir(), 'agy-poller-'))`, write sample Spec (`docs/superpowers/specs/2026-10-18-sample-design.md`) and Plan (`docs/superpowers/plans/2026-10-18-sample-plan.md`) containing `### Task 1: Setup` (`- [x] **Step 1**`) and `### Task 2: UI` (`- [ ] **Step 1**`).
    - Verify `pollWorkspaceOnce(tempDir)` discovers both files, extracts `specContent` and `planContent`, parses the 2 tasks (`Task 1: Setup` as `'completed'`, `Task 2: UI` as `'pending'` or `'in_progress'`), and updates `.agy/supervisor_state.json` checkpoints via `updateLedger` (`src/core/ledger.ts:108`).
  - In `tests/unit/telemetry-store.test.ts`:
    - Instantiate `TelemetryStore` with a `VirtualTerminal` (`src/pty/virtual-terminal.ts`), `TelemetryParser` (`src/telemetry/parser.ts`), and `projectDir`.
    - Feed PTY output into the store, verify `store.getSnapshot()` merges `ParserState`, `WorkspacePollSnapshot`, `VirtualTerminal.getViewportLines()`, and elapsed timers (`totalElapsedMs`, `phaseElapsedMs`, `subagentElapsedMs`), and notifies `store.subscribe(listener)` callbacks.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pollWorkspaceOnce } from '../../src/telemetry/poller.js';

describe('WorkspacePoller', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-poller-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers latest spec and plan files and parses task progress', () => {
    const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
    const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, '2026-10-18-demo-design.md'), '# Demo Spec');
    fs.writeFileSync(
      path.join(plansDir, '2026-10-18-demo-plan.md'),
      '### Task 1: Alpha\n- [x] Step 1\n### Task 2: Beta\n- [ ] Step 1\n'
    );

    const snapshot = pollWorkspaceOnce(tmpDir);
    expect(snapshot.specPath).toContain('2026-10-18-demo-design.md');
    expect(snapshot.planPath).toContain('2026-10-18-demo-plan.md');
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks[0]).toMatchObject({ title: 'Task 1: Alpha', status: 'completed' });
    expect(snapshot.tasks[1]).toMatchObject({ title: 'Task 2: Beta', status: 'pending' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (Red)**
  - Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts`
  - Expected: FAIL due to missing `src/telemetry/poller.js` and `src/telemetry/store.js`.

- [ ] **Step 3: Implement `src/telemetry/poller.ts` and `src/telemetry/store.ts`**
  - In `src/telemetry/poller.ts`:
    - `parsePlanTasks(markdown: string): PlanTaskItem[]`: extracts `### Task N: ...` sections and evaluates checkbox states (`- [x]` vs `- [ ]`) within each task block: all checked $\rightarrow$ `'completed'`, some checked $\rightarrow$ `'in_progress'`, none checked $\rightarrow$ `'pending'`.
    - `pollWorkspaceOnce(projectDir: string): WorkspacePollSnapshot`:
      - Calls `checkGitRepo(projectDir)` (`src/core/discovery.ts:45`) for `branch`, counts dirty lines via `git status --porcelain`, and reads `git log -1 --format="%h|%s"` for `lastCommit`.
      - Searches `docs/superpowers/specs` and `docs/plans` for newest `*-design.md` / `*-spec.md`, and `docs/superpowers/plans` and `docs/plans` for newest `*-plan.md`.
      - Syncs discovered `specPath` / `planPath` into `.agy/supervisor_state.json` using `updateLedger` (`src/core/ledger.ts:108`) when paths change.
  - In `src/telemetry/store.ts`, implement `TelemetryStore`:
    - Connects `PtyRunner` (`src/pty/runner.ts:21`), `VirtualTerminal` (`src/pty/virtual-terminal.ts`), `TelemetryParser` (`src/telemetry/parser.ts`), and `pollWorkspaceOnce` (`src/telemetry/poller.ts`).
    - Maintains `startedAt`, `phaseStartedAt`, and `subagentStartedAt` timestamps; computes `totalElapsedMs`, `phaseElapsedMs`, and `subagentElapsedMs`.
    - When `pollWorkspaceOnce` detects a new `lastCommit.sha`, appends a `[GIT]` commit event to the activity feed and calls `appendLedgerEvent` (`src/core/ledger.ts:122`).
    - Exposes `startPolling(intervalMs?: number): void`, `stop(): void`, `getSnapshot(): TelemetrySnapshot`, and `subscribe(listener: () => void): () => void`.

- [ ] **Step 4: Run tests to verify they pass (Green)**
  - Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/telemetry/poller.ts src/telemetry/store.ts tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts`
  - `git commit -m "feat(telemetry): add WorkspacePoller and observable TelemetryStore"`

---

### Task 5: Ink TUI Sub-Components — Header, Footer, Main Status, Spec/Plan & Audit Views

**Wave:** 4  
**Depends on:** Task 2, Task 3, Task 4  
**Files Touched:**
- Create: `src/tui/components/HeaderBar.tsx`
- Create: `src/tui/components/FooterBar.tsx`
- Create: `src/tui/components/MainStatusView.tsx`
- Create: `src/tui/components/SpecPlanView.tsx`
- Create: `src/tui/components/AuditLogView.tsx`
- Create: `tests/unit/tui-views.test.tsx`

- [ ] **Step 1: Write failing component render tests (`tests/unit/tui-views.test.tsx`)**
  - Using `render` from `ink-testing-library`, write tests asserting:
    - `HeaderBar` renders project branch, formatted elapsed time (`01m 05s`), active mode badge (`NAV` vs `PTY INTERACT`), and `WAITING FOR INPUT` alert when `waitingForInput` is `true`.
    - `FooterBar` renders `[1] Main Status [2] Live PTY [3] Spec & Plan [4] Audit Log` in `NAVIGATION` mode, and `PTY INTERACT LOCKED — Press Ctrl+] to detach` in `PTY_INTERACT` mode.
    - `MainStatusView` (Panel `[1]`) renders Currently Running agent/subagent/PID/timers, Last Action, Last Cmd, Pipeline & Task Progress list, and Clean Activity Feed items.
    - `SpecPlanView` (Panel `[3]`) renders active Spec or Plan markdown lines based on `activeDoc: 'spec' | 'plan'` and `scrollOffset`, or a helpful empty-state message when `specContent`/`planContent` is `null`.
    - `AuditLogView` (Panel `[4]`) renders `SupervisorLedger` (`src/core/types.ts:25`) status, checkpoints, and timestamped `LedgerEvent` entries (`src/core/types.ts:18`).

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../../src/tui/components/HeaderBar.js';
import { FooterBar } from '../../src/tui/components/FooterBar.js';

describe('TUI Sub-Components', () => {
  it('renders HeaderBar with branch, elapsed time, and waiting prompt indicator', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/tui"
        totalElapsedMs={65000}
        status="EXECUTING"
        inputMode="NAVIGATION"
        waitingForInput={true}
      />
    );
    expect(lastFrame()).toContain('feat/tui');
    expect(lastFrame()).toContain('01m 05s');
    expect(lastFrame()).toContain('INPUT');
  });

  it('renders FooterBar context legend for PTY_INTERACT mode', () => {
    const { lastFrame } = render(
      <FooterBar activePanel={2} inputMode="PTY_INTERACT" />
    );
    expect(lastFrame()).toContain('Ctrl+]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (Red)**
  - Run: `npx vitest run tests/unit/tui-views.test.tsx`
  - Expected: FAIL due to missing component files under `src/tui/components/`.

- [ ] **Step 3: Implement `HeaderBar`, `FooterBar`, `MainStatusView`, `SpecPlanView`, and `AuditLogView`**
  - Implement each component in `src/tui/components/` using `Box` and `Text` from `ink`:
    - `HeaderBar.tsx`: Props `{ branch: string; totalElapsedMs: number; status: string; inputMode: InputMode; waitingForInput: boolean }` + helper `formatDuration(ms: number): string`.
    - `FooterBar.tsx`: Props `{ activePanel: TuiPanelId; inputMode: InputMode; activeDoc?: 'spec' | 'plan' }`.
    - `MainStatusView.tsx`: Props `{ snapshot: TelemetrySnapshot }`. Matches the architecture layout (`docs/antigravity_master_supervisor_architecture.md:141-164`).
    - `SpecPlanView.tsx`: Props `{ specPath: string | null; specContent: string | null; planPath: string | null; planContent: string | null; activeDoc: 'spec' | 'plan'; scrollOffset: number; maxRows?: number }`.
    - `AuditLogView.tsx`: Props `{ ledger: SupervisorLedger; scrollOffset: number; maxRows?: number }`.

- [ ] **Step 4: Run tests to verify they pass (Green)**
  - Run: `npx vitest run tests/unit/tui-views.test.tsx`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/tui/components/HeaderBar.tsx src/tui/components/FooterBar.tsx src/tui/components/MainStatusView.tsx src/tui/components/SpecPlanView.tsx src/tui/components/AuditLogView.tsx tests/unit/tui-views.test.tsx`
  - `git commit -m "feat(tui): implement HeaderBar, FooterBar, MainStatusView, SpecPlanView, and AuditLogView"`

---

### Task 6: Live PTY Viewport Component (`LivePtyView.tsx`)

**Wave:** 4  
**Depends on:** Task 2, Task 3, Task 4  
**Files Touched:**
- Create: `src/tui/components/LivePtyView.tsx`
- Create: `tests/unit/live-pty-view.test.tsx`

- [ ] **Step 1: Write failing unit tests for `LivePtyView` (`tests/unit/live-pty-view.test.tsx`)**
  - Test that `LivePtyView` renders:
    - A status banner indicating whether keyboard input is currently unlocked (`NAVIGATION` — "Press [i] or [Enter] to interact with agy terminal") or locked (`PTY_INTERACT` — "INTERACTING WITH AGY — Press [Ctrl+]] to return to Supervisor TUI").
    - The visible viewport lines from `ptyViewportLines: string[]`.
    - An empty-state placeholder if `ptyViewportLines` is empty.

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LivePtyView } from '../../src/tui/components/LivePtyView.js';

describe('LivePtyView', () => {
  it('renders viewport lines and interaction mode banner', () => {
    const { lastFrame } = render(
      <LivePtyView
        lines={['Welcome to Antigravity CLI', '? Select an option:']}
        inputMode="PTY_INTERACT"
        mainAgent="planner"
        pid={4321}
      />
    );
    expect(lastFrame()).toContain('Welcome to Antigravity CLI');
    expect(lastFrame()).toContain('? Select an option:');
    expect(lastFrame()).toContain('Ctrl+]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (Red)**
  - Run: `npx vitest run tests/unit/live-pty-view.test.tsx`
  - Expected: FAIL due to missing `src/tui/components/LivePtyView.js`.

- [ ] **Step 3: Implement `src/tui/components/LivePtyView.tsx`**
  - Props: `{ lines: string[]; inputMode: InputMode; mainAgent: string; pid?: number; maxRows?: number }`.
  - Renders border highlight (`borderColor="green"` when `inputMode === 'PTY_INTERACT'`, `"cyan"` when `'NAVIGATION'`), top banner with PID/agent and mode hint, and the slice of `lines` fitting `maxRows`.

- [ ] **Step 4: Run test to verify it passes (Green)**
  - Run: `npx vitest run tests/unit/live-pty-view.test.tsx`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/tui/components/LivePtyView.tsx tests/unit/live-pty-view.test.tsx`
  - `git commit -m "feat(tui): implement LivePtyView terminal viewport component"`

---

### Task 7: Root Ink `App.tsx`, Modal Input Router (`Ctrl+]`) & `mountSupervisorTui`

**Wave:** 5  
**Depends on:** Task 4, Task 5, Task 6  
**Files Touched:**
- Create: `src/tui/App.tsx`
- Create: `src/tui/index.ts`
- Create: `tests/unit/tui-app.test.tsx`

- [ ] **Step 1: Write failing tests for `App` navigation and modal PTY keyboard routing (`tests/unit/tui-app.test.tsx`)**
  - Using `ink-testing-library` (`render`, `stdin.write`), test:
    1. Default render shows Panel `[1]` (`MainStatusView`).
    2. Pressing `'2'` switches to Panel `[2]` (`LivePtyView`) in `NAVIGATION` mode.
    3. Pressing `'i'` on Panel `[2]` (or `'t'` from any panel) enters `PTY_INTERACT` mode.
    4. While in `PTY_INTERACT` mode, writing `'1'`, `'hello'`, `'\r'`, or `'\x0b'` (`Ctrl+K`) does NOT switch TUI tabs—instead it calls `onWritePty` with those exact characters.
    5. Writing `'\x1d'` (`Ctrl+]`) in `PTY_INTERACT` mode detaches back to `NAVIGATION` mode without forwarding `'\x1d'` to `onWritePty`, allowing `'3'` and `'4'` to switch to `SpecPlanView` and `AuditLogView`.
    6. Pressing `'s'` / `'p'` on Panel `[3]` toggles between Spec and Plan documents.

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/App.js';
import type { TelemetrySnapshot } from '../../src/telemetry/types.js';
import type { SupervisorLedger } from '../../src/core/types.js';

describe('TUI App & Modal Input Router', () => {
  it('switches panels in NAVIGATION mode and locks keystrokes to PTY in PTY_INTERACT mode until Ctrl+]', () => {
    const onWritePty = vi.fn();
    const snapshot = {
      branch: 'main', dirtyFilesCount: 0, totalElapsedMs: 1000, phaseElapsedMs: 1000, subagentElapsedMs: 0,
      mainAgent: 'planner', pid: 1234, activeSubagent: null, lastAction: null, lastCommand: null,
      waitingForInput: false, specPath: 'docs/superpowers/specs/test-design.md', specContent: '# Test Spec Body',
      planPath: null, planContent: null, tasks: [], activityFeed: [], ptyViewportLines: ['agy prompt >'],
    } satisfies TelemetrySnapshot;
    const ledger = {
      version: '1.0.0', sessionId: 's1', projectPath: process.cwd(), createdAt: '', updatedAt: '',
      status: 'EXECUTING', activeAgent: 'planner',
      checkpoints: { spec: { status: 'UNINITIALIZED' }, plan: { status: 'UNINITIALIZED' } }, events: [],
    } satisfies SupervisorLedger;

    const { stdin, lastFrame } = render(
      <App snapshot={snapshot} ledger={ledger} onWritePty={onWritePty} onRequestQuit={() => {}} />
    );

    stdin.write('2');
    stdin.write('i');
    expect(lastFrame()).toContain('Ctrl+]');

    stdin.write('1');
    expect(onWritePty).toHaveBeenCalledWith('1');

    stdin.write('\x1d');
    stdin.write('3');
    expect(lastFrame()).toContain('# Test Spec Body');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (Red)**
  - Run: `npx vitest run tests/unit/tui-app.test.tsx`
  - Expected: FAIL due to missing `src/tui/App.js`.

- [ ] **Step 3: Implement `src/tui/App.tsx` and `src/tui/index.ts`**
  - In `src/tui/App.tsx`:
    - Props: `{ snapshot: TelemetrySnapshot; ledger: SupervisorLedger; onWritePty: (data: string) => void; onRequestQuit: () => void }`.
    - Uses `useStdin()` from `ink` to attach a raw `stdin.on('data', ...)` listener (or `useInput`) that intercepts raw byte sequences before Ink's default key parser when `inputMode === 'PTY_INTERACT'`:
      - When `inputMode === 'PTY_INTERACT'`: if data contains `\x1d` (`Ctrl+]`), splits around `\x1d` (writing any prefix before `\x1d` to `onWritePty`) and transitions `inputMode` to `'NAVIGATION'`. Otherwise passes the raw string directly to `onWritePty(raw)` so arrow keys (`\x1b[A`), `Esc`, `Enter`, `Ctrl+K` (`\x0b`), etc. reach `agy` untouched.
      - When `inputMode === 'NAVIGATION'`:
        - `'1' | '2' | '3' | '4'` sets `activePanel` (`1..4`) and resets `scrollOffset = 0`.
        - `'t'` switches to Panel `2` and sets `inputMode = 'PTY_INTERACT'`.
        - `'i'` or `'\r'` / `'\n'` when `activePanel === 2` sets `inputMode = 'PTY_INTERACT'`.
        - `'s'` / `'p'` when `activePanel === 3` switches `activeDoc` between `'spec'` and `'plan'`.
        - Up/Down arrows or `'j'`/`'k'` on Panels `3` and `4` adjust `scrollOffset`.
        - `'q'` calls `onRequestQuit()`.
  - In `src/tui/index.ts`:
    - Implement `mountSupervisorTui(options: { projectDir: string; ptyRunner: PtyRunner; mainAgent?: string }): { unmount: () => void; waitUntilExit: () => Promise<void> }`:
      - Instantiates `VirtualTerminal` (`src/pty/virtual-terminal.ts`), `TelemetryParser` (`src/telemetry/parser.ts`), and `TelemetryStore` (`src/telemetry/store.ts`).
      - Registers a `process.stdout.on('resize', handleResize)` listener that computes inner viewport dimensions (`cols = process.stdout.columns || 80`, `rows = Math.max(10, (process.stdout.rows || 30) - 6)`) and calls `virtualTerminal.resize(cols, rows)` and `ptyRunner.resize(cols, rows)` (`src/pty/runner.ts:217`).
      - Starts workspace polling (`store.startPolling(2000)`), subscribes a React wrapper component `SupervisorTuiContainer` to `store.subscribe(...)`, loads ledger via `loadLedger(projectDir)` (`src/core/ledger.ts:72`), and mounts Ink `render(<SupervisorTuiContainer ... />)`.
      - When `ptyRunner.onExit` fires, unlocks `PTY_INTERACT` if active, updates store, and unbinds the `resize` listener and unmounts cleanly on quit.

- [ ] **Step 4: Run test to verify it passes (Green)**
  - Run: `npx vitest run tests/unit/tui-app.test.tsx`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add src/tui/App.tsx src/tui/index.ts tests/unit/tui-app.test.tsx`
  - `git commit -m "feat(tui): implement root App modal input router and mountSupervisorTui entrypoint"`

---

### Task 8: CLI `--no-tui` / `--agent` Integration, Root Exports & End-to-End Verification

**Wave:** 6  
**Depends on:** Task 2, Task 7  
**Files Touched:**
- Modify: `src/cli/index.ts:11-55`
- Modify: `src/cli/commands/run.ts:1-137`
- Modify: `src/index.ts:1-32`
- Modify: `tests/unit/cli.test.ts:41-251`
- Create: `tests/integration/tui-run.test.ts`

- [ ] **Step 1: Write failing unit & integration tests for `--no-tui`, `--agent`, and TUI/passthrough dispatch**
  - In `tests/unit/cli.test.ts:41-132`:
    - Assert `--no-tui` and `--agent` are registered on both the root program and the `run` command (`src/cli/index.ts:16-52`).
    - Assert `agy-supervisor --no-tui --agent planner` passes `{ noTui: true, agent: 'planner' }` to `runCommand` (`src/cli/commands/run.ts:18`).
  - Create `tests/integration/tui-run.test.ts`:
    - Test `runCommand` in `--no-tui` mode with a live Node subprocess (`binaryPath: process.execPath`, `args: ['-e', '...']`) verifying bidirectional stdin/stdout passthrough when a mock TTY stream is supplied.
    - Test `VirtualTerminal` + `TelemetryStore` + `PtyRunner` live integration where `PtyRunner` spawns `process.execPath` emitting simulated `agy` tool lines (`invoke_subagent -> researcher`, `view_file -> src/index.ts`), verifying `TelemetryStore.getSnapshot()` captures both the live PTY viewport and parsed activity feed items.

```typescript
import { describe, it, expect } from 'vitest';
import { PtyRunner } from '../../src/pty/runner.js';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryParser } from '../../src/telemetry/parser.js';
import { TelemetryStore } from '../../src/telemetry/store.js';

describe('TUI & Telemetry Live PTY Integration', () => {
  it('streams live node-pty output through VirtualTerminal into TelemetryStore', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    const parser = new TelemetryParser({ mainAgent: 'planner' });
    const store = new TelemetryStore({
      projectDir: process.cwd(),
      virtualTerminal: vt,
      parser,
    });

    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: process.execPath,
      agent: '',
      args: ['-e', 'console.log("invoke_subagent -> researcher"); console.log("view_file -> README.md");'],
      dryRun: false,
    });

    runner.onData((chunk) => {
      void vt.write(chunk);
    });

    const exitCode = await runner.start();
    expect(exitCode).toBe(0);

    const snap = store.getSnapshot();
    expect(snap.activeSubagent).toBe('researcher');
    expect(snap.lastAction).toContain('README.md');
    store.stop();
    vt.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (Red)**
  - Run: `npx vitest run tests/unit/cli.test.ts tests/integration/tui-run.test.ts`
  - Expected: FAIL due to missing `--no-tui` option on `createCliProgram` and missing exports/wiring.

- [ ] **Step 3: Implement CLI option wiring (`src/cli/index.ts`), `runCommand` updates (`src/cli/commands/run.ts`), and barrel exports (`src/index.ts`)**
  - In `src/cli/index.ts:16-52`:
    - Add `.option('--agent <name>', 'Agent role name to run')` and `.option('--no-tui', 'Run in raw interactive terminal passthrough mode without the TUI')` to both root `program` and `run` command.
    - Note Commander's `--no-tui` boolean negation convention (`cmdOptions.tui === false` $\rightarrow$ `noTui: true`); map `noTui: cmdOptions?.tui === false || globalOpts.tui === false || Boolean(cmdOptions?.noTui || globalOpts.noTui)`.
  - In `src/cli/commands/run.ts:6-136`:
    - Extend `RunOptions` with `noTui?: boolean; forceTui?: boolean`.
    - Determine execution mode:
      - `const isInteractiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);`
      - `const useTui = options?.forceTui ?? (isInteractiveTty && !options?.noTui && !options?.dryRun);`
      - If `useTui` is `true`: call `mountSupervisorTui({ projectDir, ptyRunner, mainAgent: options?.agent || 'agy' })` instead of raw `process.stdout.write`, await `ptyRunner.start()`, and unmount cleanly.
      - Else (non-TUI mode): pipe `ptyRunner.onData((data) => process.stdout.write(data))`; and if `isInteractiveTty && !options?.dryRun`, call `attachRawPassthrough(ptyRunner)` (`src/pty/raw-passthrough.ts`) so `--no-tui` provides full bidirectional interactive keyboard control, detaching in `finally`.
      - In both `cleanup()` (`src/cli/commands/run.ts:52-71`) and `finally` (`src/cli/commands/run.ts:132-135`), explicitly guard `if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') { try { process.stdin.setRawMode(false); } catch {} }` alongside `ptyRunner.kill()` (`src/pty/runner.ts:228`) so uncaught errors or signals during `PTY_INTERACT` mode never leave the user's host shell in raw mode.
  - In `src/index.ts:1-32`:
    - Export `VirtualTerminal` from `./pty/virtual-terminal.js`, `attachRawPassthrough` from `./pty/raw-passthrough.js`, all telemetry classes/types from `./telemetry/types.js`, `./telemetry/parser.js`, `./telemetry/poller.js`, `./telemetry/store.js`, and `mountSupervisorTui`, `App` from `./tui/index.js`.

- [ ] **Step 4: Build and run full test suite (Green)**
  - Run: `npm run build && npx tsc --noEmit && npm test`
  - Expected: Build succeeds (`dist/index.js`, `dist/cli/index.js`, `dist/index.d.ts` emitted), `tsc --noEmit` exits 0 with zero errors, and all unit + integration tests pass.

- [ ] **Step 5: Commit**
  - `git add src/cli/index.ts src/cli/commands/run.ts src/index.ts tests/unit/cli.test.ts tests/integration/tui-run.test.ts`
  - `git commit -m "feat(cli): wire Ink TUI and --no-tui interactive passthrough into runCommand"`
