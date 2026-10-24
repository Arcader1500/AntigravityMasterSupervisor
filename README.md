# antigravity-master-supervisor

`agy-supervisor` (`agysup`) is a local terminal supervisor for Antigravity CLI sessions. It presents a conversational TUI with inline decisions, a team rail, agent zoom, transcript scrolling, and terminal takeover. It observes PTY output, workspace artifacts, and the local ledger; those observations do not form an authoritative Antigravity lifecycle or permission protocol.

## What the supervisor does

- Stores supervisor session state in `.agy/supervisor_state.json`.
- Uses `doctor` for environment preflight checks and `run` to launch one Antigravity CLI process through a PTY.
- Shows parsed agent output and workspace artifact observations with source attribution. Artifact timestamp filtering helps discover files; it does not prove which process owns them.
- Records the child process outcome when reported. Exit code 0 means the process exited successfully; it does not mean the work was reviewed or verified. Legacy ledger `COMPLETED` values remain readable but are not treated as proof of review or verification.
- Leaves permission decisions to the person operating Antigravity. No automatic permission decision or native permission enforcement is added by the supervisor.

The current evidence and open acceptance checks are in the [Stage A interactive baseline review](docs/roadmap-updates/stage-a-interactive-baseline-review.md). The [roadmap](docs/roadmap-updates/ROADMAP.md) describes future stages; its proposed milestones are not release commitments.

## Installation

### From npm Registry

```bash
# Global CLI installation
npm install -g @arcader1500/antigravity-master-supervisor

# Local project installation
npm install @arcader1500/antigravity-master-supervisor
```

### From GitHub Packages

```bash
# Configure npm to use GitHub Packages for the @arcader1500 scope:
# npm config set @arcader1500:registry https://npm.pkg.github.com
npm install -g @arcader1500/antigravity-master-supervisor
```

## CLI usage

The CLI is available as `agy-supervisor` or `agysup`.

```bash
# Run environment preflight checks and diagnostics
agy-supervisor doctor [projectDir]

# Run supervisor PTY orchestration (also the default command)
agy-supervisor run [projectDir]

# Short executable alias
agysup [projectDir]

# Resume the saved supervisor ledger and artifact history
agy-supervisor run [projectDir] --resume
```

### `run` options

- `--agy-bin <path>` selects the Antigravity executable. If omitted, the CLI discovers it.
- `--agent <name>` passes an agent role name to the child CLI.
- `--no-tui` uses raw terminal passthrough instead of the supervisor TUI. Non-interactive terminals also run without the TUI.
- `--dry-run` runs the simulated PTY path without launching Antigravity.
- `--resume` preserves the supervisor ledger/session and scans historical artifacts; it starts a new child process with a new process-run identity. It does not reconnect to or resume an existing Antigravity conversation.
- `-v, --verbose` enables verbose logging.
- `-h, --help` displays help. `-V, --version` displays the CLI version.

The same run options are available on the default root command and the explicit `run` command. `doctor [projectDir]` supports `--agy-bin <path>`, `--dry-run`, and `-v, --verbose`; its dry-run only changes how missing external tools affect diagnostics.

### TUI controls

- `Tab` toggles the team rail; `Enter` opens the selected agent; `Esc` returns to chat or defers a decision.
- `PageUp` / `PageDown` scroll the transcript; `End` returns to the latest content.
- `/spec`, `/plan`, and `/audit` open local views; `/decide` jumps to the next decision.
- `/help` displays controls; `/quit` exits the supervisor.
- `/raw` or `Ctrl+T` takes over the PTY. `Ctrl+C` twice requests supervisor exit.
- `/pause` and `/resume` control input handling. On Windows, pause queues supervisor input while the child can continue. On POSIX, the supervisor attempts `SIGSTOP`/`SIGCONT` on the PTY process ID; an attempted signal is not confirmation that the child or its descendants stopped or resumed. The UI reports failed or unavailable attempts. Queued input is local to the current process run and is not carried into a later run.

Permission prompts and questions remain human-operated. A displayed decision or a successful input write does not prove that Antigravity accepted the decision. If a prompt is missing or unclear, keep control with the person and use `/raw` to inspect or operate the underlying terminal.

## Process outcomes and recovery

The ledger records the process run identity and reported terminal outcome. A reported exit code 0 is displayed as a process exit, not a delivery result. A nonzero exit and startup failure are recorded as failures; supervisor interruption records its signal and wrapper exit code. Missing exit details remain unknown rather than being converted to success. Progress, `READY`, `PASS`, and historical `COMPLETED` text are reports or legacy state; review and verification remain unconfirmed unless separately evidenced.

`--resume` is a ledger/artifact-history option, not process recovery. The supervisor does not restart, retry, or reattach to a child after process loss or host failure. If a terminal is left in an unusable state after an unexpected crash, open a fresh terminal session. On POSIX, `stty sane; printf '\033[?1049l\033[0m\033[?25h'` can restore common terminal modes; this cannot recover a killed child or reconstruct its outcome. On Windows, close and reopen the terminal tab if normal input/display does not return. Remove a disposable workspace only after confirming its child process has stopped.

## Development

```bash
# Install dependencies
npm install

# Build distribution bundles (ESM + types)
npm run build

# Run unit and integration tests
npm test

# Run the strict TypeScript check
npx tsc --noEmit

# Run build watcher during development
npm run dev
```
