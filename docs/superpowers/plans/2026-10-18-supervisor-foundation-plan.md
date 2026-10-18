# Antigravity Master Supervisor Foundation & Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repository scaffold, npm packaging, project discovery, persistent ledger, and PTY runner for the `agy-supervisor` CLI tool.

**Architecture:** A native TypeScript/Node.js package with zero Python dependencies, exposing the `agy-supervisor` and `agysup` binary. Employs `node-pty` for cross-platform PTY orchestration against any target project directory, reading and persisting lifecycle state to `.agy/supervisor_state.json`.

**Tech Stack:** Node.js (>=18), TypeScript, `node-pty`, `commander`, `colorette`, `tsup`, `vitest`.

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| Wave 1 | Task 1 | Git initialization, repository scaffold, tooling, and build configs | `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `vitest.config.ts`, `README.md` |
| Wave 2 | Task 2, Task 4 | Core types, workspace ledger, and cross-platform PTY runner | Task 2: `src/core/types.ts`, `src/core/ledger.ts`, `tests/unit/ledger.test.ts`<br/>Task 4: `src/pty/types.ts`, `src/pty/runner.ts`, `tests/unit/runner.test.ts` |
| Wave 3 | Task 3 | Environment discovery & preflight validator | `src/core/discovery.ts`, `tests/unit/discovery.test.ts` |
| Wave 4 | Task 5 | CLI command dispatch, signal handlers, and entrypoint binary | `src/cli/commands/doctor.ts`, `src/cli/commands/run.ts`, `src/cli/index.ts`, `bin/agy-supervisor.js`, `tests/unit/cli.test.ts` |
| Wave 5 | Task 6 | Root exports, native PTY integration test, and packaging verification | `src/index.ts`, `tests/integration/doctor.test.ts`, `tests/integration/pty.test.ts` |

---

## Tasks

### Task 1: Git Initialization, Repository Scaffold, and Tooling

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `README.md`

- [ ] **Step 1: Initialize Git and configure repository manifest**
Run `git init` in the root workspace `D:\Code\AntigravityMasterSupervisor`.
Create `.gitignore` ignoring `node_modules/`, `dist/`, `.agy/`, and `*.log`.
Create `package.json` with:
- Package name: `"antigravity-master-supervisor"`
- Version: `"0.1.0"`
- Type: `"module"`
- Binaries: `"agy-supervisor": "./bin/agy-supervisor.js"`, `"agysup": "./bin/agy-supervisor.js"`
- Files whitelist: `["dist", "bin", "README.md"]`
- Exports and main: `"./dist/index.js"`, types: `"./dist/index.d.ts"`
- Dependencies: `commander` (>=12.0.0), `node-pty` (>=1.0.0), `colorette` (>=2.0.20)
- DevDependencies: `typescript` (>=5.4.0), `tsup` (>=8.0.0), `vitest` (>=1.5.0), `@types/node` (>=20.0.0)
- Scripts: `"build": "tsup"`, `"test": "vitest run"`, `"dev": "tsup --watch"`

Create `tsconfig.json` targeting `ES2022`, `moduleResolution: "NodeNext"`, `declaration: true`, `strict: true`.
Create `tsup.config.ts` configured with entry mapping `{ index: 'src/index.ts', 'cli/index': 'src/cli/index.ts' }`, format `["esm"]`, dts generation, and clean output.
Create `vitest.config.ts` configuring test globals and test environment `node`.
Create basic `README.md` describing project installation and CLI usage.

- [ ] **Step 2: Install dependencies**
Run: `npm install`
Expected: `node_modules` generated and all packages installed without error.

- [ ] **Step 3: Verify build tooling**
Run: `npx tsup --help`
Expected: tsup CLI prints usage information with exit code 0.

- [ ] **Step 4: Verify test runner**
Run: `npx vitest --version`
Expected: Vitest version printed with exit code 0.

---

### Task 2: Core Types and Persistent Workspace Ledger

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Create: `src/core/types.ts`
- Create: `src/core/ledger.ts`
- Create: `tests/unit/ledger.test.ts`

- [ ] **Step 1: Write failing tests for workspace ledger**
In `tests/unit/ledger.test.ts`, write test cases covering:
- `initLedger(projectDir)` creates `.agy/supervisor_state.json` if it does not exist with default schema.
- `loadLedger(projectDir)` reads and parses existing ledger.
- `updateLedger(projectDir, updater)` performs atomic update (writes to `.tmp` and renames) and updates `updatedAt`.
- Corrupt JSON recovery: when JSON is malformed, renames corrupt file to `.agy/supervisor_state.json.corrupt.<timestamp>` and initializes a clean ledger.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initLedger, loadLedger, updateLedger } from '../../src/core/ledger.js';

describe('Workspace Ledger', () => {
  const testDir = path.join(process.cwd(), 'tests/fixtures/test-ledger');

  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('initializes a new supervisor_state.json with default structure', () => {
    const ledger = initLedger(testDir);
    expect(ledger.version).toBe('1.0.0');
    expect(ledger.status).toBe('IDLE');
    expect(fs.existsSync(path.join(testDir, '.agy', 'supervisor_state.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify test fails (Red)**
Run: `npx vitest run tests/unit/ledger.test.ts`
Expected: FAIL due to missing `../../src/core/ledger.js`.

- [ ] **Step 3: Implement core types and ledger manager**
In `src/core/types.ts`, define:
- `SupervisorLedger`, `LedgerStatus`, `CheckpointStatus`, `LedgerEvent`.
- `GitCheckResult`: `{ isGit: boolean; rootDir?: string; branch?: string; isClean?: boolean; error?: string }`.
- `AgyBinaryResult`: `{ path: string | null; source: 'override' | 'env' | 'path' | 'none'; version?: string }`.
- `PreflightReport`: `{ targetDir: string; git: GitCheckResult; agyBin: AgyBinaryResult; config: { hasGeminiMd: boolean; hasClaudeMd: boolean; hasAgyConfig: boolean }; allPassed: boolean }`.

In `src/core/ledger.ts`, implement:
- `getLedgerPath(projectDir: string): string`
- `initLedger(projectDir: string): SupervisorLedger`
- `loadLedger(projectDir: string): SupervisorLedger`
- `saveLedgerAtomic(projectDir: string, data: SupervisorLedger): void`
- `updateLedger(projectDir: string, updater: (ledger: SupervisorLedger) => void): SupervisorLedger`
- `appendLedgerEvent(projectDir: string, level: "INFO" | "WARN" | "ERROR", message: string, meta?: Record<string, unknown>): void`

- [ ] **Step 4: Verify test passes (Green)**
Run: `npx vitest run tests/unit/ledger.test.ts`
Expected: PASS (all tests pass).

---

### Task 4: Cross-Platform PTY Agent Runner

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Create: `src/pty/types.ts`
- Create: `src/pty/runner.ts`
- Create: `tests/unit/runner.test.ts`

- [ ] **Step 1: Write failing tests for PTY runner**
In `tests/unit/runner.test.ts`, write test cases covering:
- `PtyRunner` interface instantiation with target directory, binary path, and agent name.
- Event listener attachment: `onData`, `onExit`.
- Dry-run mode: executes simulated stream without spawning child process.
- Windows ConPTY vs POSIX shell resolution (using `process.platform === 'win32'`).

```typescript
import { describe, it, expect } from 'vitest';
import { PtyRunner } from '../../src/pty/runner.js';

describe('PtyRunner', () => {
  it('supports dry-run mode without spawning child process', async () => {
    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: 'agy',
      agent: 'planner',
      dryRun: true,
    });

    let output = '';
    runner.onData((data) => { output += data; });

    const exitCode = await runner.start();
    expect(exitCode).toBe(0);
    expect(output).toContain('[DRY-RUN]');
  });
});
```

- [ ] **Step 2: Verify test fails (Red)**
Run: `npx vitest run tests/unit/runner.test.ts`
Expected: FAIL due to missing `../../src/pty/runner.js`.

- [ ] **Step 3: Implement PtyRunner**
In `src/pty/types.ts`, define `PtyRunnerOptions` (`projectDir`, `binaryPath`, `agent`, `args?: string[]`, `cols?: number`, `rows?: number`, `dryRun?: boolean`) and `PtyExitResult`.
In `src/pty/runner.ts`, implement `PtyRunner`:
- Method `onData(callback: (data: string) => void): void`
- Method `onExit(callback: (code: number, signal?: number) => void): void`
- Method `start(): Promise<number>`: spawns child process via `node-pty.spawn` with ConPTY on Windows or POSIX PTY on Unix. Wraps spawn in try/catch to format actionable error messages if ConPTY native bindings fail. In `dryRun` mode, emits synthetic markers and resolves 0.
- Method `write(input: string): void`: sends keystrokes/data to PTY process stdin.
- Method `resize(cols: number, rows: number): void`: resizes terminal window.
- Method `kill(signal?: string): void`: cleanly sends signal to terminate process.

- [ ] **Step 4: Verify test passes (Green)**
Run: `npx vitest run tests/unit/runner.test.ts`
Expected: PASS.

---

### Task 3: Environment Discovery and Preflight Validator

**Wave:** 3  
**Depends on:** Task 2  
**Files Touched:**
- Create: `src/core/discovery.ts`
- Create: `tests/unit/discovery.test.ts`

- [ ] **Step 1: Write failing tests for discovery module**
In `tests/unit/discovery.test.ts`, write test cases covering:
- `resolveTargetDir(inputPath?: string)`: resolves relative path or defaults to `process.cwd()`. Throws if path does not exist.
- `checkGitRepo(targetDir: string)`: returns `{ isGit: boolean, rootDir?: string, branch?: string, isClean?: boolean }`. Verifies clean vs dirty status by inspecting `git status --porcelain`.
- `findAgyBinary(overridePath?: string)`: checks override path first, then `AGY_BIN_PATH`, then searches PATH with platform-specific executable extensions (`.cmd`, `.exe`, `.bat`).
- `runPreflightDoctor(options)`: returns diagnostic checklist `{ targetDir, git, agyBin, config, allPassed: boolean }`.

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTargetDir, checkGitRepo, findAgyBinary } from '../../src/core/discovery.js';

describe('Discovery Preflight', () => {
  it('resolves valid target directory and throws for non-existent path', () => {
    expect(resolveTargetDir(process.cwd())).toBe(process.cwd());
    expect(() => resolveTargetDir('non-existent-directory-xyz')).toThrow();
  });

  it('detects git repo in current directory with branch and clean status', () => {
    const res = checkGitRepo(process.cwd());
    expect(res.isGit).toBe(true);
    expect(typeof res.branch).toBe('string');
    expect(typeof res.isClean).toBe('boolean');
  });

  it('prefers explicit binary override when provided', () => {
    const bin = findAgyBinary('mock-bin-path');
    expect(bin.path).toBe('mock-bin-path');
  });
});
```

- [ ] **Step 2: Verify test fails (Red)**
Run: `npx vitest run tests/unit/discovery.test.ts`
Expected: FAIL due to missing `../../src/core/discovery.js`.

- [ ] **Step 3: Implement discovery module**
In `src/core/discovery.ts`, implement:
- `resolveTargetDir(inputDir?: string): string`
- `checkGitRepo(targetDir: string): GitCheckResult`: runs `git rev-parse --show-toplevel`, `git branch --show-current`, and `git status --porcelain` to evaluate `isGit`, `branch`, and `isClean`.
- `findAgyBinary(overridePath?: string): AgyBinaryResult`
- `inspectProjectConfig(targetDir: string): { hasGeminiMd: boolean; hasClaudeMd: boolean; hasAgyConfig: boolean }`
- `runPreflightDoctor(targetDir: string, options?: { agyBin?: string }): Promise<PreflightReport>`

- [ ] **Step 4: Verify test passes (Green)**
Run: `npx vitest run tests/unit/discovery.test.ts`
Expected: PASS (all tests pass).

---

### Task 5: CLI Command Dispatch, Signal Handlers, and Entrypoint Binary

**Wave:** 4  
**Depends on:** Task 3, Task 4  
**Files Touched:**
- Create: `src/cli/commands/doctor.ts`
- Create: `src/cli/commands/run.ts`
- Create: `src/cli/index.ts`
- Create: `bin/agy-supervisor.js`
- Create: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write failing tests for CLI parser**
In `tests/unit/cli.test.ts`, write test cases covering:
- CLI program configuration: command names (`agy-supervisor`), version, description.
- Option parsing: `--agy-bin`, `--dry-run`, `--verbose`.
- Command routing: invoking `doctor` invokes the doctor action; invoking without subcommand defaults to `run`.

```typescript
import { describe, it, expect } from 'vitest';
import { createCliProgram } from '../../src/cli/index.js';

describe('CLI Parser', () => {
  it('creates program with doctor and run commands', () => {
    const program = createCliProgram();
    expect(program.name()).toBe('agy-supervisor');
    const commandNames = program.commands.map(cmd => cmd.name());
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('run');
  });
});
```

- [ ] **Step 2: Verify test fails (Red)**
Run: `npx vitest run tests/unit/cli.test.ts`
Expected: FAIL due to missing `../../src/cli/index.js`.

- [ ] **Step 3: Implement CLI commands and entrypoint**
In `src/cli/commands/doctor.ts`:
- Implement `doctorCommand(targetDir?: string, options?: DoctorOptions): Promise<void>`
- Calls `runPreflightDoctor` from `src/core/discovery.ts`.
- Prints colorized report with symbols: `[✓]`, `[!]`, `[✗]`.
- Exits with code 1 if critical checks fail, or 0 if passing.

In `src/cli/commands/run.ts`:
- Implement `runCommand(targetDir?: string, options?: RunOptions): Promise<void>`
- Resolves target directory and initializes `.agy/supervisor_state.json`.
- Locates `agy` binary; instantiates `PtyRunner`.
- Attaches signal handlers (`process.on('SIGINT')`, `process.on('SIGTERM')`): calls `ptyRunner.kill()`, updates ledger status to `"IDLE"`, flushes state, and exits.
- Streams PTY output to `process.stdout`.

In `src/cli/index.ts`:
- Export `createCliProgram(): Command` using `commander`.
- Set default command to `run`.

In `bin/agy-supervisor.js`:
```javascript
#!/usr/bin/env node
import { createCliProgram } from '../dist/cli/index.js';
const program = createCliProgram();
program.parse(process.argv);
```

- [ ] **Step 4: Verify test passes (Green)**
Run: `npx vitest run tests/unit/cli.test.ts`
Expected: PASS.

---

### Task 6: Root Exports, Native PTY Integration Test, and Packaging Verification

**Wave:** 5  
**Depends on:** Task 5  
**Files Touched:**
- Create: `src/index.ts`
- Create: `tests/integration/pty.test.ts`
- Create: `tests/integration/doctor.test.ts`

- [ ] **Step 1: Write integration tests for doctor and native live PTY execution**
In `tests/integration/pty.test.ts`:
- Launch a live PTY subprocess using `PtyRunner` executing `node -e "console.log('PTY_NATIVE_READY')"` (with `dryRun: false`) to verify native C++ ConPTY/POSIX bindings load and stream bytes properly.

In `tests/integration/doctor.test.ts`:
- Spawns compiled binary or runs `createCliProgram().parseAsync(['node', 'agy-supervisor', 'doctor', '--dry-run', '.'])`.
- Verifies output includes diagnostic headers and returns exit code 0.

- [ ] **Step 2: Verify integration tests fail before implementation (Red)**
Run: `npx vitest run tests/integration/`
Expected: FAIL due to missing `src/index.ts` and uncompiled `dist/`.

- [ ] **Step 3: Implement library root exports**
In `src/index.ts`, re-export core modules and types:
- Export all from `./core/types.js`
- Export `{ initLedger, loadLedger, updateLedger }` from `./core/ledger.js`
- Export `{ runPreflightDoctor, findAgyBinary, resolveTargetDir, checkGitRepo }` from `./core/discovery.js`
- Export `{ PtyRunner }` from `./pty/runner.js`
- Export `{ createCliProgram }` from `./cli/index.js`

- [ ] **Step 4: Run full build**
Run: `npm run build`
Expected: `dist/index.js`, `dist/cli/index.js`, and `.d.ts` declaration files built with exit code 0.

- [ ] **Step 5: Run integration tests and packaging verification (Green)**
Run: `npx vitest run tests/integration/`
Expected: PASS (all integration tests pass).

Run: `node ./bin/agy-supervisor.js --help`
Expected: Displays `agy-supervisor` help text with `doctor` and `run` commands.

Run: `npm pack --dry-run`
Expected: Verifies package tarball contents include `bin/`, `dist/`, `package.json`, and `README.md`.
