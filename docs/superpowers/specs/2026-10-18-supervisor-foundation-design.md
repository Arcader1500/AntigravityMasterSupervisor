# Design Spec: Antigravity Master Supervisor Foundation & CLI Packaging

- **Status:** Proposed
- **Date:** 2026-10-18
- **Topic:** Foundation Milestone, Repository Setup, NPM Packaging & PTY Agent Runner

---

## 1. Goal

Build the foundation and packaging layer for the **Antigravity Master Supervisor** (`agy-supervisor`), allowing it to be installed locally or globally as an npm package and invoked from the terminal inside any arbitrary project workspace. 

This foundation provides:
1. Repository setup and housekeeping (Git initialization, TypeScript/Node build tooling, linting, and packaging).
2. Global and project-level CLI binary packaging (`agy-supervisor` and alias `agysup`).
3. Project context discovery and environment validation (`agy-supervisor doctor` and preflight checks).
4. Persistent workspace ledger management (`.agy/supervisor_state.json`).
5. Low-level cross-platform PTY agent runner (`node-pty`) capable of launching `agy` agents in the target project directory.

---

## 2. User Requirements

- **Global & Local Invocation:** The supervisor must be installable via npm (e.g. `npm install -g .`, `npm link`, or consumed as a local dependency/run via `npx`) and executable from anywhere against any project folder.
- **Project Agnostic:** Must not be bound to the supervisor repository itself. Running `agy-supervisor` inside `/path/to/any-project` must execute against that directory, reading its git status and targeting its environment.
- **CLI Commands & Flags:**
  - `agy-supervisor [projectDir]`: Launch the supervisor targeting `projectDir` (defaults to current working directory `process.cwd()`).
  - `agy-supervisor doctor [projectDir]`: Preflight diagnostic tool to check system dependencies (`agy`/`antigravity` executable, Git repo status, and Antigravity plugin/rules availability).
  - Flags: `--agy-bin <path>` (custom binary path), `--dry-run` (simulate without spawning agents), `--verbose` (detailed debug logging), `--version`, `--help`.
- **Runtime Choice:** Pure TypeScript / Node.js native architecture with zero Python runtime dependency, utilizing `node-pty` for pseudo-terminal emulation across Windows (ConPTY) and Unix.

---

## 3. Architecture & Approach

### 3.1 Repository Structure & Housekeeping
```
AntigravityMasterSupervisor/
├── bin/
│   └── agy-supervisor.js            # Executable shebang wrapper (`#!/usr/bin/env node`)
├── docs/
│   ├── antigravity_master_supervisor_architecture.md
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── src/
│   ├── cli/                         # CLI entrypoint, argument parsing (Commander / cac)
│   │   ├── commands/
│   │   │   ├── run.ts
│   │   │   └── doctor.ts
│   │   └── index.ts
│   ├── core/
│   │   ├── discovery.ts             # Binary detection, git discovery, workspace checks
│   │   ├── ledger.ts                # .agy/supervisor_state.json initialization & mutations
│   │   └── types.ts                 # Core state interfaces and schemas
│   ├── pty/
│   │   ├── runner.ts                # node-pty process manager for agy agent sessions
│   │   └── types.ts
│   └── index.ts                     # Programmatic library exports
├── tests/
│   ├── unit/                        # Unit tests for discovery, ledger, CLI parsing
│   └── integration/                 # Integration tests for PTY spawning and doctor checks
├── .gitignore
├── package.json
├── tsconfig.json
└── tsup.config.ts                   # Fast TypeScript bundler emitting clean ESM/CJS
```

### 3.2 CLI Packaging & Executable Entry
- `package.json` declares:
  ```json
  {
    "name": "antigravity-master-supervisor",
    "version": "0.1.0",
    "bin": {
      "agy-supervisor": "./bin/agy-supervisor.js",
      "agysup": "./bin/agy-supervisor.js"
    },
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "files": ["dist", "bin", "README.md"]
  }
  ```
- Build target compiles TypeScript in `src/` to `dist/` using `tsup`.
- `bin/agy-supervisor.js` imports `./dist/cli/index.js` and executes the CLI.

### 3.3 Project Discovery & Preflight Engine (`discovery.ts`)
The discovery module inspects the execution environment before invoking any agent:
1. **Target Directory Resolution:** Resolves user-provided `[projectDir]` or defaults to `process.cwd()`. Ensures the path exists and is an accessible directory.
2. **Git Repository Verification:** Verifies whether `projectDir` contains a valid Git repository (via `git rev-parse --show-toplevel` or inspecting `.git`). Flags dirty worktrees or missing git initialization.
3. **Antigravity CLI Detection:**
   - Checks user-supplied `--agy-bin`.
   - Checks environment variable `AGY_BIN_PATH`.
   - Resolves PATH looking for `agy` or `antigravity` (taking into account Windows executable suffixes: `.cmd`, `.bat`, `.exe`, `.ps1`).
   - Executes `agy --version` to verify usability.
4. **Plugin & Configuration Detection:**
   - Detects existence of `GEMINI.md`, `CLAUDE.md`, or `.gemini/` / `.antigravity/` configurations in target repo.

### 3.4 Persistent Workspace Ledger (`ledger.ts`)
State persistence lives inside the target project directory under `.agy/supervisor_state.json`:
- Schema tracks:
  - `version`: Ledger schema version (`"1.0.0"`).
  - `sessionId`: Unique UUID per supervisor run.
  - `projectPath`: Absolute path to the active project.
  - `createdAt` / `updatedAt`: ISO timestamps.
  - `status`: Current state (`"IDLE" | "INITIALIZING" | "PLANNING" | "CHECKPOINT_SPEC" | "EXECUTING" | "COMPLETED" | "FAILED"`).
  - `activeAgent`: Currently active agent name (`"planner"` | `"orchestrator"` | null).
  - `checkpoints`:
    - `spec`: `{ status: "PENDING" | "APPROVED" | "REJECTED", path?: string, approvedAt?: string }`
    - `plan`: `{ status: "PENDING" | "APPROVED" | "REJECTED", path?: string, approvedAt?: string }`
  - `history`: Log of events, transitions, and permission approvals.
- Writes are performed atomically (writing to `.agy/supervisor_state.json.tmp` and renaming) to prevent corruption during unexpected shutdowns.

### 3.5 Cross-Platform PTY Agent Runner (`pty/runner.ts`)
- Spawns Antigravity via `node-pty` (`pty.spawn(...)`):
  - On Windows: Uses native ConPTY backend.
  - On macOS/Linux: Uses standard POSIX PTY.
- Injects process working directory (`cwd: targetProjectPath`).
- Controls command line arguments: e.g. `agy --agent <agentName> [args]`.
- Exposes event-driven API:
  - `onData(callback)`: Real-time ANSI stream from `agy`.
  - `onExit(callback)`: Exit code and signal handling.
  - `write(data)`: Injects keystrokes (e.g. `ctrl+k`, prompt answers, user override) into the session.
  - `resize(cols, rows)`: Maintains terminal dimensions.
  - `kill(signal)`: Clean process termination.
- Supports `--dry-run` mode which simulates the PTY session without launching actual background processes.

---

## 4. Interfaces & Schemas

### 4.1 CLI Commands & Flags
```
Usage: agy-supervisor [command] [options] [projectDir]

Commands:
  run [projectDir]       Start supervisor in the target project (default command)
  doctor [projectDir]    Check environment, agy binary, and project readiness

Options:
  --agy-bin <path>       Explicit path to the agy/antigravity executable
  --dry-run              Simulate execution without spawning live agents
  -v, --verbose          Enable detailed debugging logs
  -V, --version          Display version number
  -h, --help             Display help
```

### 4.2 Doctor Output Contract
`agy-supervisor doctor` outputs structured, colorized diagnostics:
```text
[✓] Target Directory: D:\Code\SampleProject (Valid)
[✓] Git Repository: Main branch (Clean working tree)
[✓] Antigravity CLI: Located at C:\Users\User\AppData\Roaming\npm\agy.cmd (v0.8.2)
[!] Project Configuration: No local .agy/config.json found (Using global defaults)
[✓] Supervisor Ledger: Ready (.agy/supervisor_state.json)

Status: ALL CHECKS PASSED. Ready to run agy-supervisor.
```

### 4.3 Ledger Schema (`supervisor_state.json`)
```typescript
export interface SupervisorLedger {
  version: "1.0.0";
  sessionId: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  status: "IDLE" | "INITIALIZING" | "PLANNING" | "CHECKPOINT_SPEC" | "EXECUTING" | "COMPLETED" | "FAILED";
  activeAgent: string | null;
  checkpoints: {
    spec: {
      status: "UNINITIALIZED" | "PENDING" | "APPROVED" | "REJECTED";
      path?: string;
      approvedAt?: string;
    };
    plan: {
      status: "UNINITIALIZED" | "PENDING" | "APPROVED" | "REJECTED";
      path?: string;
      approvedAt?: string;
    };
  };
  events: Array<{
    timestamp: string;
    level: "INFO" | "WARN" | "ERROR";
    message: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

---

## 5. Error Handling & Edge Cases

| Scenario | Behavior |
| :--- | :--- |
| **`agy` or `antigravity` not found in PATH** | `doctor` fails with actionable error message explaining how to install `antigravity-cli` or specify `--agy-bin <path>`. |
| **Target directory is not a Git repo** | Warns during `doctor` or `run`. Prompts or errors with message requiring a Git workspace (`git init` needed). |
| **Target directory does not exist** | Immediate exit with code 1: `"Target directory does not exist: <path>"`. |
| **Corrupted `.agy/supervisor_state.json`** | Backs up corrupted file to `.agy/supervisor_state.json.corrupt.<timestamp>` and initializes a clean ledger with warning. |
| **Windows ConPTY spawn failure** | Catches `node-pty` spawn errors and provides descriptive remediation (e.g. Windows version requirements or build tools). |
| **Process Termination (SIGINT / Ctrl+C)** | Flushes current ledger state to disk and safely terminates spawned child PTY process. |

---

## 6. Autonomous Engineering Defaults vs. Mandatory Confirmations

- **Autonomous Engineering Defaults (Applied automatically):**
  - Project directory defaults to `process.cwd()`.
  - State ledger stored in `.agy/` within the target project directory.
  - Bundler configured with `tsup` targeting Node 18+ ES modules.
  - Test framework configured using `vitest` for fast TypeScript unit testing.
  - Safe atomic file operations for all disk ledger updates.
- **Mandatory User Confirmation (Confirmed during Grill-Me interview):**
  - Implementation runtime confirmed as pure TypeScript/Node.js with zero Python dependency.
  - CLI command name confirmed as `agy-supervisor` with alias `agysup`.
  - Binary discovery auto-detects `agy`/`antigravity` in PATH with `--agy-bin` and `AGY_BIN_PATH` override.
  - Subcommands confirmed: default run, `doctor` diagnostic preflight, `--dry-run`, `--verbose`.

---

## 7. Explicit Out-of-Scope Items (Deferred to Later Milestones)

The following components from the high-level architecture are explicitly deferred to subsequent milestones:
1. **Full Interactive Ink TUI Dashboard:** (Main telemetry screen, hotkey switching, Markdown viewer modal).
2. **`jev` Reflex Classifier:** Fast LLM classifier for automatic `ctrl+k` permission grant.
3. **`supervisor.md` Autonomous Q&A Reasoner:** Automated response engine for grilling phase questions.
4. **Two-Checkpoint Gate Automation:** Autonomous handoff loop between `planner` and `orchestrator`.
*(These will be specified and built in subsequent plans once this foundation, packaging, and PTY runner are verified.)*
