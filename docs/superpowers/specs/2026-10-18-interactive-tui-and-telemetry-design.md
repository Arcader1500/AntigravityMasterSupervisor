# Design Spec: Antigravity Master Supervisor — Phase 2: Interactive TUI Dashboard, Live PTY Control & Stream Telemetry

- **Status:** Proposed
- **Date:** 2026-10-18
- **Topic:** Phase 2 — Interactive Multi-Panel Ink TUI, Modal PTY Passthrough, Virtual Terminal Emulation & Passive Stream Telemetry Parser

---

## 1. Goal

Upgrade `agy-supervisor` from its Phase 1 one-way stdout runner into an **interactive, multi-panel Terminal User Interface (TUI)** with full keyboard control over the underlying `agy` ConPTY session and automated passive telemetry extraction.

Specifically, Phase 2 delivers:
1. **Architecture Documentation Alignment:** Update `docs/antigravity_master_supervisor_architecture.md` to reflect the completed Phase 1 TypeScript/`node-pty` foundation, current milestone roadmap, and resolved design decisions (`OD-1`, `OD-5`).
2. **Headless Virtual Terminal Buffer (`@xterm/headless`):** Maintain an accurate in-memory terminal screen matrix (supporting cursor movement, ANSI colors, line wraps, and screen clears) fed by `PtyRunner`, so switching between TUI panels never corrupts or loses the `agy` terminal view.
3. **Passive Regex Stream Telemetry Parser:** Extract active agent (`planner` / `orchestrator`), active subagent (`researcher`, `plan-critic`, `implementer`, `code-reviewer`, `verifier`), tool actions (`view_file`, `write_to_file`, `run_command`, `ask_question`, `invoke_subagent`), execution timers, and clean activity feed entries purely by matching `agy`'s native terminal output—without requiring custom sentinel tags.
4. **Workspace & Git Telemetry Poller:** Periodically inspect the target project's Git state (branch, dirty file count, latest commit SHA/subject) and discover active Spec (`docs/superpowers/specs/*-design.md`, `docs/plans/*-spec.md`) and Plan (`docs/superpowers/plans/*-plan.md`, `docs/plans/*-plan.md`) documents to track task progress.
5. **Multi-Panel Ink TUI Dashboard:**
   - `[1] Main Status`: Real-time telemetry header, currently running agent/subagent/tool card, pipeline & task progress pane, and clean parsed activity stream.
   - `[2] Live PTY Terminal`: Full-panel live rendering of the `agy` virtual terminal with **Modal Keyboard Control** (`i` or `Enter` to lock all keyboard input directly into `agy`; `Ctrl+]` to detach back to TUI navigation).
   - `[3] Spec & Plan Viewer`: Scrollable reader for discovered Spec and Plan markdown artifacts with `[s]`/`[p]` toggle.
   - `[4] Audit Log`: Live table of `.agy/supervisor_state.json` lifecycle transitions and telemetry milestones.
6. **Raw Interactive Passthrough (`--no-tui`) & Agent Selection (`--agent`):** Support `--agent <name>` and `--no-tui` (which binds raw `process.stdin` and terminal resize events directly to `PtyRunner` for lightweight non-TUI interactive sessions).

---

## 2. User Requirements

- **Controllable `agy` Session:** Users must be able to interact with the spawned `agy` process (answering `ask_question` prompts with arrow keys/Enter, pressing `Ctrl+K` for permissions, typing prompts, or sending `Esc`/`Ctrl+C`).
- **Modal PTY Input Lock (Vim/Tmux Style):**
  - In **TUI Navigation Mode** (default), single-key hotkeys `1`–`4` switch panels, `q` cleanly quits the supervisor, and on panel `[2]`, pressing `i` or `Enter` enters **PTY Interact Mode**.
  - In **PTY Interact Mode**, 100% of keystrokes (including `1`–`4`, `Esc`, arrow keys, `Enter`, `Ctrl+K`, `Ctrl+C`, backspace) are forwarded directly to `ptyRunner.write(...)`.
  - Pressing **`Ctrl+]`** (`\x1d`) detaches from **PTY Interact Mode** and returns to **TUI Navigation Mode** without killing `agy`.
- **Pure Passive Regex Parsing (`OD-1`):** Telemetry extraction must rely strictly on passive regex/pattern matching against the virtual terminal lines and workspace artifacts, requiring zero prompt modifications or `[AGY:...]` sentinel tags from `agy` agents.
- **CLI Ergonomics:**
  - `agy-supervisor [targetDir] [--agent <name>] [--no-tui]`
  - Default launches the multi-panel Ink TUI.
  - `--agent <name>` passes `--agent <name>` to `agy` when specified (defaults to standard `agy` session if omitted).
  - `--no-tui` bypasses Ink and pipes `process.stdin` (in raw mode) and `process.stdout` directly to/from `PtyRunner`.

---

## 3. Architecture & Approach

### 3.1 Repository Additions
```text
AntigravityMasterSupervisor/
├── docs/
│   ├── antigravity_master_supervisor_architecture.md   # Updated with TS stack & Phase 1/2 status
│   └── superpowers/
│       ├── specs/
│       │   ├── 2026-10-18-supervisor-foundation-design.md
│       │   └── 2026-10-18-interactive-tui-and-telemetry-design.md
│       └── plans/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── doctor.ts
│   │   │   └── run.ts                 # Updated for TUI mount, --no-tui raw stdio, --agent flag
│   │   └── index.ts                   # Updated CLI options (--agent, --no-tui)
│   ├── pty/
│   │   ├── runner.ts
│   │   ├── raw-passthrough.ts         # Raw process.stdin <-> PtyRunner bridge for --no-tui
│   │   ├── virtual-terminal.ts        # @xterm/headless wrapper + ANSI snapshot renderer
│   │   └── types.ts
│   ├── telemetry/
│   │   ├── parser.ts                  # Pure passive regex stream parser for agy output
│   │   ├── poller.ts                  # Git branch/commit & Spec/Plan markdown file poller
│   │   ├── store.ts                   # Observable state store combining parser + poller + timers
│   │   └── types.ts
│   └── tui/
│       ├── App.tsx                    # Root Ink component, hotkey router & mode controller
│       ├── components/
│       │   ├── HeaderBar.tsx          # Branch, elapsed timer, active mode, status badge
│       │   ├── FooterBar.tsx          # Context-aware hotkey legend (Nav Mode vs PTY Interact Mode)
│       │   ├── MainStatusView.tsx     # Panel [1]: Currently Running + Pipeline + Activity Feed
│       │   ├── LivePtyView.tsx        # Panel [2]: Live virtual terminal viewport + input bridge
│       │   ├── SpecPlanView.tsx       # Panel [3]: Scrollable Spec & Plan markdown viewer
│       │   └── AuditLogView.tsx       # Panel [4]: Ledger events & transition history
│       └── index.ts                   # mountSupervisorTui() entrypoint
```

### 3.2 Headless Virtual Terminal (`src/pty/virtual-terminal.ts`)
Because `agy` uses full-screen cursor positioning, spinners, and interactive menus (`ask_question`), simply concatenating raw `onData` chunks produces garbled text in a TUI box.
- `VirtualTerminal` wraps `@xterm/headless` (`Terminal` with `allowProposedApi: true`).
- Every chunk from `ptyRunner.onData` is written into the headless terminal buffer.
- Exposes:
  - `getViewportLines(maxRows?: number): string[]`: Returns ANSI-styled or plain-text lines representing the current visible screen buffer for `[2] Live PTY Terminal`.
  - `onLineCommit(callback)`: Emits newly settled/updated non-empty plain-text lines to the `TelemetryParser` (deduplicating spinner frames).
  - `resize(cols, rows)`: Synchronizes dimensions between the TUI panel viewport, `@xterm/headless`, and `ptyRunner.resize(cols, rows)`.

### 3.3 Passive Regex Stream Telemetry Parser (`src/telemetry/parser.ts`)
Matches patterns observed in `agy` CLI output against plain-text lines extracted from the virtual terminal:
1. **Subagent Lifecycle Detection:**
   - Detects `invoke_subagent` dispatches and role/type headers (matching `researcher`, `plan-critic`, `implementer`, `code-reviewer`, `verifier`) to set `activeSubagent` and start the subagent timer.
   - Detects subagent completion markers (`[Message] ... sender=`, `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`, `READY`) to record activity events and clear or transition `activeSubagent`.
2. **Tool Call & Action Extraction:**
   - Matches `agy` tool execution lines and action descriptions (e.g., `view_file`, `write_to_file`, `edit_file`, `grep_search`, `run_command`, `ask_question`, `call_mcp_tool`, and capitalized `-ing` toolAction phrases alongside file paths or commands).
   - Updates `lastAction` (e.g., `write_to_file -> docs/superpowers/specs/...`) and `lastCommand` (e.g., `npm test (Exit 0)`).
3. **Interactive Prompt Detection:**
   - Detects when `agy` is waiting on an interactive prompt (`ask_question` option list or `ctrl+k` command permission prompt) and sets `waitingForInput: true` with a visual indicator in the TUI header so the user knows they can switch to `[2]` to respond (prior to Phase 3's automated `jev`/`supervisor` brain).
4. **Clean Activity Feed:**
   - Deduplicates noisy spinner frames and appends timestamped `[AGENT] Action summary` entries to a bounded ring buffer (last 100 events).

### 3.4 Workspace & Artifact Poller (`src/telemetry/poller.ts`)
Runs on a non-blocking interval (default every 2000ms) against `targetDir`:
- **Git Snapshot:** Reads current branch, working tree dirty file count, and latest commit (`git log -1 --format="%h %s"`). When a new commit SHA appears during execution, logs a commit event to the Activity Feed and Ledger.
- **Spec & Plan Discovery:**
  - Scans `docs/superpowers/specs/` and `docs/plans/` for the most recently modified `*-design.md` or `*-spec.md`.
  - Scans `docs/superpowers/plans/` and `docs/plans/` for the most recently modified `*-plan.md`.
  - Parses markdown task headings/checkboxes (`### Task N:` or `- [x]` / `- [ ]`) from the active plan to populate the **Pipeline & Task Progress** list on Panel `[1]`.
  - Syncs discovered artifact paths into `.agy/supervisor_state.json` (`checkpoints.spec.path`, `checkpoints.plan.path`).

### 3.5 Multi-Panel Ink TUI & Modal Input Router (`src/tui/`)
Built with `ink` and `react`:
- **Input Routing (`App.tsx`):**
  - Listens to raw `process.stdin` buffers when in **PTY Interact Mode** on Panel `[2]`:
    - If chunk contains `\x1d` (`Ctrl+]`), exits **PTY Interact Mode** back to **TUI Navigation Mode**.
    - Otherwise forwards raw buffer directly to `ptyRunner.write(data.toString('utf8'))` so all ANSI sequences, arrow keys, `Enter`, `Esc`, and `Ctrl+K` work natively inside `agy`.
  - In **TUI Navigation Mode**:
    - `1`, `2`, `3`, `4`: Switch active panel.
    - `i` or `Enter` (when on Panel `[2]`) or `t` (from any panel): Switch to Panel `[2]` and activate **PTY Interact Mode**.
    - `s` / `p` (when on Panel `[3]`): Toggle between Spec and Plan markdown files.
    - `Up` / `Down` / `PageUp` / `PageDown` (on Panels `[3]` and `[4]`): Scroll content.
    - `q` or `Ctrl+C`: Gracefully terminate `ptyRunner`, flush ledger to `IDLE`, unmount Ink, and exit.

---

## 4. Interfaces & Schemas

### 4.1 Updated CLI Options (`src/cli/index.ts`)
```text
Usage: agy-supervisor [command] [options] [targetDir]

Commands:
  run [targetDir]        Start supervisor in the target project (default command)
  doctor [targetDir]     Check environment, agy binary, and project readiness

Options:
  --agy-bin <path>       Explicit path to the agy/antigravity executable
  --agent <name>         Initial agy agent to launch (e.g. planner, orchestrator)
  --no-tui               Run in raw interactive terminal passthrough mode without the TUI
  --dry-run              Simulate execution without spawning live agents
  -v, --verbose          Enable detailed debugging logs
  -V, --version          Display version number
  -h, --help             Display help
```

### 4.2 Telemetry State Schema (`src/telemetry/types.ts`)
```typescript
export type TuiPanelId = 1 | 2 | 3 | 4;
export type InputMode = 'NAVIGATION' | 'PTY_INTERACT';

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  actor: string; // e.g. 'PLANNER', 'ORCH', 'IMPL', 'RES', 'GIT', 'SYS'
  message: string;
}

export interface PlanTaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  commitSha?: string;
}

export interface TelemetrySnapshot {
  branch: string;
  dirtyFilesCount: number;
  lastCommit?: { sha: string; subject: string };
  totalElapsedMs: number;
  phaseElapsedMs: number;
  subagentElapsedMs: number;
  mainAgent: string;
  pid: number | undefined;
  activeSubagent: string | null;
  lastAction: string | null;
  lastCommand: string | null;
  waitingForInput: boolean;
  specPath: string | null;
  specContent: string | null;
  planPath: string | null;
  planContent: string | null;
  tasks: PlanTaskItem[];
  activityFeed: ActivityFeedItem[];
  ptyViewportLines: string[];
}
```

---

## 5. Error Handling & Edge Cases

| Scenario | Behavior |
| :--- | :--- |
| **Non-TTY Environment (CI / Piped stdin)** | If `!process.stdin.isTTY` or `!process.stdout.isTTY`, automatically falls back to non-TUI stream mode with a warning instead of crashing on `setRawMode(true)`. |
| **Terminal Resize (`SIGWINCH` / `stdout.on('resize')`)** | Dynamically recalculates inner viewport rows/cols, resizes `@xterm/headless`, and calls `ptyRunner.resize(cols, rows)`. |
| **Missing Spec or Plan Files on Panel `[3]`** | Displays a clean empty-state card explaining which paths (`docs/superpowers/specs/` and `docs/superpowers/plans/`) are being watched. |
| **Child `agy` Process Exits While in PTY Interact Mode** | Automatically unlocks `PTY_INTERACT` back to `NAVIGATION`, updates status badge to `COMPLETED` or `FAILED (Exit <code>)`, and restores `process.stdin` state on exit. |
| **Uncaught TUI Error / Shutdown** | Always restores `process.stdin.setRawMode(false)`, kills child PTY if still running, and atomically saves `.agy/supervisor_state.json`. |

---

## 6. Autonomous Engineering Defaults vs. Mandatory Confirmations

- **Autonomous Engineering Defaults (Applied automatically):**
  - Use `ink` (React for CLI) for declarative multi-panel terminal layout and `@xterm/headless` for virtual terminal screen emulation.
  - Poll Git status and Spec/Plan markdown artifacts every 2000ms with safe debouncing and empty-state guards.
  - Discover specs/plans in both `docs/superpowers/{specs,plans}/` (plugin standard) and `docs/plans/` (legacy architecture doc path).
  - Cap in-memory activity feed buffer to 100 items to bound memory usage during long runs.
  - Automatically fall back if `process.stdin.isTTY` is false.
- **Mandatory User Confirmations (Confirmed during Grill-Me interview):**
  - **Phase 2 Scope:** Focused on the Interactive TUI Dashboard + Live Controllable PTY Panel + Passive Stream Telemetry Parser + Architecture Doc update (deferring `jev` and `supervisor.md` LLM brains to Phase 3).
  - **Live PTY Keyboard Control:** Modal Vim/Tmux-style interaction (`i` or `Enter` on Tab `[2]` locks keyboard into `agy`; `Ctrl+]` detaches back to TUI tab navigation).
  - **Telemetry Parsing (`OD-1`):** Pure passive regex parsing of `agy`'s existing terminal output without requiring sentinel tags.
  - **CLI Flags:** Optional `--agent <name>` flag and `--no-tui` flag for raw interactive stdio passthrough.

---

## 7. Explicit Out-of-Scope Items (Deferred to Phase 3)

The following items are deferred to **Phase 3 (Autonomous Supervisor Intelligence & Two-Checkpoint Gate)**:
1. **`jev` Fast Reflex Classifier:** Automatic sub-200ms LLM evaluation of `ASK` prompts and automatic `ctrl+k` injection.
2. **`supervisor.md` Deep Reasoning Agent:** Automated Q&A generation for `grill-me` questions and automated Spec/Plan audit.
3. **Automated Two-Checkpoint PTY Handoff:** Automatically terminating the `planner` PTY upon plan approval and spawning the `orchestrator` PTY without user intervention.
4. **Auto-Popup Escalation Modal (`[E]`):** Triggered by `jev` / `supervisor.md` escalations in Phase 3.
