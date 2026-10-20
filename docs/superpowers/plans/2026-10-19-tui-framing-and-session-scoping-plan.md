# TUI Framing, Viewport & Session Scoping Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix TUI viewport collapsing, missing structural dividers, alternate screen buffer entry/exit, stale workspace spec/plan leakage on fresh sessions, premature `EXECUTING` lifecycle state transitions, git branch fallback, and keyboard/card edge cases.

**Architecture:** We extend the core ledger and workspace poller with session-scoped `minMtimeMs` filtering and a `--resume` CLI option so fresh sessions ignore historical specs/plans and start in `PLANNING` rather than `EXECUTING`. In the TUI layer, we add structural rule glyphs (`hr`, `vr`, `teeDown`, `teeUp`), lock the root `<Box>` to `height={rows} overflow="hidden"`, enter the alternate screen buffer on TTY mount, estimate transcript item row heights for viewport slicing, and fix CRLF Enter handling, `FailureCard` deferral/option parity, and `CommandPalette` navigation.

**Tech Stack:** TypeScript (ESM), React 18, Ink 5, Commander, Vitest, `ink-testing-library`

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| Wave 1 | Task 1, Task 2, Task 3, Task 4 | Structural glyphs, git branch fallback & ledger reset, parser `<SYSTEM_MESSAGE>` guard, and HeaderBar/FooterBar/FailureCard/TeamRail component fixes | `src/tui/glyphs.ts`, `tests/unit/tui-theme-glyphs.test.ts`, `src/core/discovery.ts`, `src/core/ledger.ts`, `tests/unit/discovery.test.ts`, `tests/unit/ledger.test.ts`, `src/telemetry/parser.ts`, `tests/unit/telemetry-parser.test.ts`, `src/tui/components/HeaderBar.tsx`, `src/tui/components/FooterBar.tsx`, `tests/unit/tui-header-footer.test.tsx`, `src/tui/components/FailureCard.tsx`, `src/tui/components/TeamRail.tsx`, `tests/unit/tui-rail-zoom-takeover.test.tsx` |
| Wave 2 | Task 5, Task 6 | Session-scoped workspace poller & TelemetryStore `sessionStartedAt` + Narrator/TranscriptStore/Transcript row-height slicing | `src/telemetry/poller.ts`, `src/telemetry/store.ts`, `tests/unit/telemetry-poller.test.ts`, `tests/unit/telemetry-store.test.ts`, `src/tui/narrator.ts`, `src/tui/transcript-store.ts`, `src/tui/components/Transcript.tsx`, `tests/unit/tui-narrator.test.ts`, `tests/unit/tui-transcript-store.test.ts`, `tests/unit/tui-transcript-cards.test.tsx` |
| Wave 3 | Task 7 | Root `App.tsx` viewport height, horizontal/vertical dividers, CRLF Enter fix, CommandPalette navigation, alternate screen buffer in `src/tui/index.ts`, Takeover banner de-dup, and `--resume` CLI flag in `src/cli/` | `src/tui/App.tsx`, `src/tui/index.ts`, `src/cli/index.ts`, `src/cli/commands/run.ts`, `src/tui/components/TakeoverView.tsx`, `tests/unit/tui-app.test.tsx`, `tests/unit/cli.test.ts`, `tests/unit/tui-rail-zoom-takeover.test.tsx` |

---

## Tasks

### Task 1: Structural Divider Glyphs in `src/tui/glyphs.ts`

**Wave:** 1
**Depends on:** None
**Files Touched:**
- Modify: `src/tui/glyphs.ts:1-56`
- Test: `tests/unit/tui-theme-glyphs.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions in `tests/unit/tui-theme-glyphs.test.ts` verifying that `resolveGlyphs` (`src/tui/glyphs.ts:11`) returns structural divider glyphs `hr`, `vr`, `teeDown`, and `teeUp` in both Unicode and ASCII modes:
- Unicode (`{ env: { WT_SESSION: '1' }, platform: 'linux' }`): `hr: '─'`, `vr: '│'`, `teeDown: '┬'`, `teeUp: '┴'`.
- ASCII (`{ env: { AGYSUP_ASCII: '1' } }`): `hr: '-'`, `vr: '|'`, `teeDown: '+'`, `teeUp: '+'`.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-theme-glyphs.test.ts`
Expected: FAIL with missing `hr`, `vr`, `teeDown`, `teeUp` properties on `GlyphSet`.

- [ ] **Step 3: Write minimal implementation (Green)**

Update `GlyphSet` and `resolveGlyphs` in `src/tui/glyphs.ts:1-56`:
```typescript
export interface GlyphSet {
  done: string;
  running: string;
  paused: string;
  prompt: string;
  treeBranch: string;
  treeLast: string;
  hr: string;
  vr: string;
  teeDown: string;
  teeUp: string;
  spinnerFrames: readonly [string, string, string, string];
}
```
Return `hr: '-'`, `vr: '|'`, `teeDown: '+'`, `teeUp: '+'` in the `isAscii` branch (`src/tui/glyphs.ts:34-44`) and `hr: '─'`, `vr: '│'`, `teeDown: '┬'`, `teeUp: '┴'` in the Unicode branch (`src/tui/glyphs.ts:46-55`).

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-theme-glyphs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/glyphs.ts tests/unit/tui-theme-glyphs.test.ts
git commit -m "feat(tui): add structural divider glyphs (hr, vr, teeDown, teeUp)"
```

---

### Task 2: Git Branch Fallback in `discovery.ts` & Session Reset in `ledger.ts`

**Wave:** 1
**Depends on:** None
**Files Touched:**
- Modify: `src/core/discovery.ts:45-80`
- Modify: `src/core/ledger.ts:35-64`
- Test: `tests/unit/discovery.test.ts`
- Test: `tests/unit/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

1. In `tests/unit/discovery.test.ts`, add a test verifying that `checkGitRepo(targetDir)` (`src/core/discovery.ts:45`) still attempts `git rev-parse --abbrev-ref HEAD` when `git branch --show-current` throws or returns empty, and falls back to `'HEAD'` only if both fail.
2. In `tests/unit/ledger.test.ts`, add a test verifying `initLedger(projectDir, { reset: true })` (`src/core/ledger.ts:35`):
   - When an existing `.agy/supervisor_state.json` has `status: 'EXECUTING'`, `checkpoints.spec.status: 'PENDING'`, and old `sessionId`, calling `initLedger(projectDir, { reset: true })` overwrites it with a new `sessionId`, `status: 'IDLE'`, `activeAgent: null`, `checkpoints.spec: { status: 'UNINITIALIZED' }`, `checkpoints.plan: { status: 'UNINITIALIZED' }`, and `events: []`.
   - Calling `initLedger(projectDir)` without `{ reset: true }` preserves backward-compatible behavior (returns the existing ledger).

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/discovery.test.ts tests/unit/ledger.test.ts`
Expected: FAIL because `initLedger` ignores `{ reset: true }`.

- [ ] **Step 3: Write minimal implementation (Green)**

1. In `src/core/discovery.ts:55-78`, restructure branch resolution inside `checkGitRepo`:
```typescript
    let branch: string | undefined;
    try {
      const branchRaw = execSync('git branch --show-current', {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (branchRaw) {
        branch = branchRaw;
      }
    } catch {
      // Fall through to rev-parse fallback
    }
    if (!branch) {
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: targetDir,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim() || undefined;
      } catch {
        branch = undefined;
      }
    }
```
2. In `src/core/ledger.ts:35-64`, update `initLedger` signature:
```typescript
export interface InitLedgerOptions {
  reset?: boolean;
}

export function initLedger(
  projectDir: string,
  options?: InitLedgerOptions
): SupervisorLedger
```
When `!options?.reset && fs.existsSync(ledgerPath)`, return `loadLedger(projectDir)` (`src/core/ledger.ts:72`). Otherwise, create and save `defaultLedger` via `saveLedgerAtomic(projectDir, defaultLedger)` (`src/core/ledger.ts:17`).

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/discovery.test.ts tests/unit/ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery.ts src/core/ledger.ts tests/unit/discovery.test.ts tests/unit/ledger.test.ts
git commit -m "feat(core): add initLedger session reset option and robust git branch fallback"
```

---

### Task 3: TelemetryParser `<SYSTEM_MESSAGE>` Subagent Completion Guard

**Wave:** 1
**Depends on:** None
**Files Touched:**
- Modify: `src/telemetry/parser.ts:314-374`
- Test: `tests/unit/telemetry-parser.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/telemetry-parser.test.ts`, add a test under `Subagent lifecycle detection`:
- Dispatch `invoke_subagent -> researcher`.
- Feed `<SYSTEM_MESSAGE>` and `</SYSTEM_MESSAGE>` wrapper tags without a `[Message]` header or explicit status verdict (`DONE`, `READY`, `BLOCKED`, etc.).
- Expect `parser.getState().activeSubagent` (`src/telemetry/parser.ts:176`) to remain `'researcher'` while inside/after bare `<SYSTEM_MESSAGE>` wrapper tags until `[Message] timestamp=... sender=...` or an explicit verdict line (`**Status:** DONE`) arrives.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/telemetry-parser.test.ts`
Expected: FAIL because `<SYSTEM_MESSAGE>` alone currently triggers `SUBAGENT_COMPLETED` with default `'DONE'` and sets `activeSubagent = null`.

- [ ] **Step 3: Write minimal implementation (Green)**

In `src/telemetry/parser.ts:315-325`, refine the completion check:
- Remove bare `SYSTEM_MSG_REGEX` (`<?SYSTEM_MESSAGE>?`) as a standalone completion trigger unless the line also matches `MESSAGE_REGEX` (`[Message] timestamp=... sender=...`) or `VERDICT_REGEX` / `STANDALONE_VERDICT_REGEX`.
- Specifically, in `src/telemetry/parser.ts:315-323`:
```typescript
    const messageMatch = trimmed.match(MESSAGE_REGEX);
    const isMessage = messageMatch !== null;
    const verdictMatch = trimmed.match(VERDICT_REGEX);
    const standaloneVerdictMatch =
      this.state.activeSubagent !== null ? trimmed.match(STANDALONE_VERDICT_REGEX) : null;
    const isVerdict = verdictMatch !== null || standaloneVerdictMatch !== null;

    if (isMessage || isVerdict) {
```
This preserves completion on `[Message] timestamp=... sender=verifier ...` (tested in `tests/unit/telemetry-parser.test.ts:56-66`) and explicit verdicts while preventing bare `<SYSTEM_MESSAGE>` or `</SYSTEM_MESSAGE>` tags from prematurely terminating active subagent tracking.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/telemetry-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/parser.ts tests/unit/telemetry-parser.test.ts
git commit -m "fix(telemetry): prevent bare SYSTEM_MESSAGE tags from prematurely completing subagents"
```

---

### Task 4: HeaderBar Mutual Exclusion, FooterBar Dynamic Option Count, FailureCard Fallback Quoting & TeamRail Idle Planning

**Wave:** 1
**Depends on:** None
**Files Touched:**
- Modify: `src/tui/components/HeaderBar.tsx:138-186`
- Modify: `src/tui/components/FooterBar.tsx:6-20, 155-163`
- Modify: `src/tui/components/FailureCard.tsx:35-51`
- Modify: `src/tui/components/TeamRail.tsx:45-64, 336-344`
- Test: `tests/unit/tui-header-footer.test.tsx`
- Test: `tests/unit/tui-rail-zoom-takeover.test.tsx`

- [ ] **Step 1: Write the failing test**

1. In `tests/unit/tui-header-footer.test.tsx`:
   - Add test: when `status="PLANNING"`, `specApproved={false}`, `planApproved={false}`, and `totalTasks={0}`, `HeaderBar` (`src/tui/components/HeaderBar.tsx:57`) renders `Spec ▸  Plan  Build  Verify` (with `Spec ▸` active and `Plan` inactive dim).
   - Add test: when `status="EXECUTING"`, `specApproved={false}`, `planApproved={false}`, and `totalTasks={0}`, `HeaderBar` renders `Spec ▸` and does **not** render `Build ▸` at the same time.
   - Add test: `FooterBar` (`src/tui/components/FooterBar.tsx:21`) with `hasFocusedDecision={true}` and `decisionOptionCount={2}` renders `1 2 choose   Enter send   Esc ask me later`; with `decisionOptionCount={4}` renders `1 2 3 4 choose   Enter send   Esc ask me later`; and defaults to `1 2 3 choose` when `decisionOptionCount` is undefined.
2. In `tests/unit/tui-rail-zoom-takeover.test.tsx`:
   - Add test: `deriveTeamMembers(snapshot, 0, false, 'IDLE')` (`src/tui/components/TeamRail.tsx:45`) with `tasks: []` and `activeSubagent: null` returns the 3 planning roles (`planner`, `researcher`, `plan-critic`) rather than execution roles (`orchestrator`, `implementer`, `code-reviewer`, `verifier`).
   - Add test: `FailureCard` (`src/tui/components/FailureCard.tsx:14`) does not wrap the fallback reason (`"The implementer reported it is blocked and did not say why. Open the agent to read its last output."`) in quotation marks, while still quoting actual error lines like `"Failed to connect to redis"`.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-header-footer.test.tsx tests/unit/tui-rail-zoom-takeover.test.tsx`
Expected: FAIL on `Spec ▸  Plan  Build` phase rendering, hardcoded `1 2 3 choose` in `FooterBar`, `IDLE` returning `orchestrator` in `deriveTeamMembers`, and quoted fallback in `FailureCard`.

- [ ] **Step 3: Write minimal implementation (Green)**

1. **`src/tui/components/HeaderBar.tsx:138-156`:**
   Implement strict phase exclusivity per Spec Section 3.3 so `Spec ▸` is active on fresh sessions until `specApproved`:
   ```typescript
   const verifyDone = status === 'COMPLETED';
   const verifyCurrent = status === 'VERIFYING';

   const buildDone = status === 'COMPLETED' || status === 'VERIFYING';
   const buildCurrent =
     !verifyCurrent &&
     !verifyDone &&
     (Boolean(specApproved && planApproved) ||
       (status === 'EXECUTING' && (totalTasks ?? 0) > 0));

   const planDone = Boolean(planApproved) || buildCurrent || buildDone;
   const planCurrent =
     !buildCurrent &&
     !buildDone &&
     !verifyCurrent &&
     !verifyDone &&
     Boolean(specApproved && !planApproved);

   const specDone = Boolean(specApproved) || planDone;
   const specCurrent =
     !specDone &&
     !planCurrent &&
     !buildCurrent &&
     !verifyCurrent &&
     status !== 'COMPLETED';
   ```
2. **`src/tui/components/FooterBar.tsx:6-31, 155-163`:**
   Add `decisionOptionCount?: number` to `FooterBarProps`. When `hasFocusedDecision` is true, compute:
   ```typescript
   const count = decisionOptionCount && decisionOptionCount > 0 ? Math.min(9, decisionOptionCount) : 3;
   const digits = Array.from({ length: count }, (_, i) => i + 1).join(' ');
   ```
   Render `${digits} choose   Enter send   Esc ask me later`.
3. **`src/tui/components/FailureCard.tsx:35-38`:**
   Check if `item.reason` ends with `'Open the agent to read its last output.'` (from `formatBlockedFallbackReason` in `src/tui/narrator-copy.ts:123`):
   ```typescript
   const isFallbackReason = item.reason.endsWith('Open the agent to read its last output.');
   const reason =
     isFallbackReason || (item.reason.startsWith('"') && item.reason.endsWith('"'))
       ? item.reason
       : `"${item.reason}"`;
   ```
4. **`src/tui/components/TeamRail.tsx:52-55, 336-344`:**
   Treat `IDLE` and `INITIALIZING` (or undefined `ledgerStatus`) with `tasks.length === 0` and no execution subagent (`implementer`, `code-reviewer`, `verifier`, `orchestrator`) as planning phase:
   ```typescript
   const isExecutionSubagent =
     activeRole !== null &&
     (activeRole.includes('implementer') ||
       activeRole.includes('reviewer') ||
       activeRole.includes('verifier') ||
       activeRole.includes('orchestrator'));
   const isPlanning =
     tasks.length === 0 &&
     !isExecutionSubagent &&
     (ledgerStatus === 'IDLE' ||
       ledgerStatus === 'INITIALIZING' ||
       ledgerStatus === 'PLANNING' ||
       ledgerStatus === 'CHECKPOINT_SPEC');
   ```
   And in `TeamRail` JSX (`src/tui/components/TeamRail.tsx:336-344`), show `"Tasks appear once the plan is approved."` whenever `tasks.length === 0` and `ledgerStatus !== 'COMPLETED'`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-header-footer.test.tsx tests/unit/tui-rail-zoom-takeover.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/HeaderBar.tsx src/tui/components/FooterBar.tsx src/tui/components/FailureCard.tsx src/tui/components/TeamRail.tsx tests/unit/tui-header-footer.test.tsx tests/unit/tui-rail-zoom-takeover.test.tsx
git commit -m "fix(tui): fix HeaderBar phase exclusivity, FooterBar option digits, FailureCard fallback quotes, and TeamRail idle state"
```

---

### Task 5: Session-Scoped Workspace Poller (`minMtimeMs`), Folder Name Fallback & `TelemetryStore` Execution Auto-Transition

**Wave:** 2
**Depends on:** Task 2
**Files Touched:**
- Modify: `src/telemetry/poller.ts:8-10, 178-228, 234-345`
- Modify: `src/telemetry/store.ts:15-23, 35-115, 119-160`
- Test: `tests/unit/telemetry-poller.test.ts`
- Test: `tests/unit/telemetry-store.test.ts`

- [ ] **Step 1: Write the failing test**

1. In `tests/unit/telemetry-poller.test.ts`:
   - Add test: in a non-git directory (`tmpDir`), `pollWorkspaceOnce(tmpDir).branch` (`src/telemetry/poller.ts:234`) returns `path.basename(tmpDir)` instead of `'unknown'`.
   - Add test: when `pollWorkspaceOnce(tmpDir, { minMtimeMs })` is called with `minMtimeMs` newer than an old spec/plan file's `mtimeMs`, `specPath`, `planPath`, and `tasks` are `null`/`[]` and ledger checkpoints are not populated with stale paths; when a new plan file is written with `mtimeMs >= minMtimeMs`, `pollWorkspaceOnce(tmpDir, { minMtimeMs })` discovers it and parses its tasks.
2. In `tests/unit/telemetry-store.test.ts`:
   - Add test: constructing `new TelemetryStore({ projectDir: tmpDir, sessionStartedAt: Date.now() + 5000 })` (`src/telemetry/store.ts:43`) ignores pre-existing plan files in `docs/superpowers/plans/` whose `mtimeMs < sessionStartedAt`, resulting in `store.getSnapshot().tasks` being `[]`.
   - Add test: when `parser.processLine('invoke_subagent -> implementer')` occurs while ledger is `'PLANNING'` or `'CHECKPOINT_SPEC'`, `TelemetryStore` updates `ledger.status = 'EXECUTING'` per Spec Section 2.3 & 3.1.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts`
Expected: FAIL because `branch` is `'unknown'`, `minMtimeMs` / `sessionStartedAt` filtering does not exist, and subagent dispatch doesn't auto-transition ledger to `EXECUTING`.

- [ ] **Step 3: Write minimal implementation (Green)**

1. **`src/telemetry/poller.ts`:**
   - Add `minMtimeMs?: number` to `PollWorkspaceOptions` (`src/telemetry/poller.ts:8-10`).
   - Update `findLatestFile` (`src/telemetry/poller.ts:178-228`) to accept `minMtimeMs?: number` and skip any file where `minMtimeMs !== undefined && fileStat.mtimeMs < minMtimeMs`.
   - In `pollWorkspaceOnce` (`src/telemetry/poller.ts:241-247`):
     ```typescript
     const fallbackBranch = path.basename(resolvedDir) || 'workspace';
     let branch = fallbackBranch;
     ...
     if (gitResult.isGit) {
       branch = gitResult.branch || fallbackBranch;
     ```
   - Pass `options?.minMtimeMs` to `findLatestFile` for both `specArtifact` and `planArtifact` (`src/telemetry/poller.ts:295, 304`).
   - In the ledger sync block (`src/telemetry/poller.ts:314-333`), if `planArtifact` is found and `tasks.length > 0` while `ledger.status === 'PLANNING'` or `ledger.status === 'IDLE'`, update `ledger.status = 'EXECUTING'`.
2. **`src/telemetry/store.ts`:**
   - Add `sessionStartedAt?: number` to `TelemetryStoreOptions` (`src/telemetry/store.ts:15-22`) and store `private sessionStartedAt?: number` on `TelemetryStore`.
   - Pass `{ minMtimeMs: this.sessionStartedAt }` into `pollWorkspaceOnce(this.projectDir, { minMtimeMs: this.sessionStartedAt })` in both the constructor (`src/telemetry/store.ts:96`) and `pollNow()` (`src/telemetry/store.ts:120`).
   - In `TelemetryStore` constructor (`src/telemetry/store.ts:100`), subscribe to parser events (`this.parser.onEvent(event => { ... })`). If `event.type === 'SUBAGENT_DISPATCHED'` and `['orchestrator', 'implementer', 'code-reviewer', 'verifier'].includes(event.role.toLowerCase())`, update `ledger.status = 'EXECUTING'` if the ledger on disk is currently `'IDLE'`, `'PLANNING'`, or `'CHECKPOINT_SPEC'`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/poller.ts src/telemetry/store.ts tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts
git commit -m "feat(telemetry): scope workspace spec/plan polling by sessionStartedAt and auto-transition to EXECUTING on subagent dispatch"
```

---

### Task 6: Narrator Startup Phase Guard, FailureCard Deferral & Transcript Row-Height Slicing

**Wave:** 2
**Depends on:** Task 4
**Files Touched:**
- Modify: `src/tui/narrator.ts:86-91, 624-655, 731-755`
- Modify: `src/tui/transcript-store.ts:218-228, 395-409`
- Modify: `src/tui/components/Transcript.tsx:50-281`
- Test: `tests/unit/tui-narrator.test.ts`
- Test: `tests/unit/tui-transcript-store.test.ts`
- Test: `tests/unit/tui-transcript-cards.test.tsx`

- [ ] **Step 1: Write the failing test**

1. In `tests/unit/tui-narrator.test.ts`:
   - Add test: `LEDGER_STATUS_CHANGED` from `'IDLE'` to `'PLANNING'` (when `!state.hasStarted` and `state.tasks.length === 0`) updates `state.ledgerStatus` to `'PLANNING'` without appending `'Spec approved. Planning the tasks.'` or `'Plan approved. Starting execution.'` to `state.items`.
   - Add test: `LEDGER_STATUS_CHANGED` from `'IDLE'` to `'EXECUTING'` when `!state.hasStarted` and `state.tasks.length === 0` updates `state.ledgerStatus` without appending `'Plan approved. Starting execution.'`.
   - Add test: `DECISION_DEFERRED` and `DECISION_REFOCUSED` work on `FailureCard` (`status: 'deferred'` -> `status: 'pending'`) just like `DecisionCard`.
2. In `tests/unit/tui-transcript-store.test.ts`:
   - Add test: `store.deferFocusedDecision()` (`src/tui/transcript-store.ts:395`) defers a focused `FailureCard`, setting `getFocusedDecision()` (`src/tui/transcript-store.ts:218`) to `null` until `store.refocusDeferredDecision()` (`src/tui/transcript-store.ts:405`) is called.
3. In `tests/unit/tui-transcript-cards.test.tsx`:
   - Add test: `Transcript` (`src/tui/components/Transcript.tsx:60`) with `maxRows={10}` and 4 multi-line `DelegationCard` / `DecisionCard` items (each ~4–6 rows tall) slices visible items by estimated row height so rendered output fits within `maxRows` rather than rendering all 4 cards (18+ lines).

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-narrator.test.ts tests/unit/tui-transcript-store.test.ts tests/unit/tui-transcript-cards.test.tsx`
Expected: FAIL on startup phase transition note emission, `FailureCard` deferral ignored, and `Transcript` item-count slicing overflowing `maxRows`.

- [ ] **Step 3: Write minimal implementation (Green)**

1. **`src/tui/narrator.ts`:**
   - Widen `FailureCard` status type (`src/tui/narrator.ts:87`) to `'pending' | 'deferred' | 'resolved'`.
   - In `LEDGER_STATUS_CHANGED` (`src/tui/narrator.ts:624-641`):
     If `event.prevStatus === 'IDLE' && (event.status === 'PLANNING' || (event.status === 'EXECUTING' && state.tasks.length === 0 && !state.hasStarted))`, update `ledgerStatus: event.status` and return without pushing a `PhaseChange` item.
   - In `DECISION_DEFERRED` (`src/tui/narrator.ts:731-739`) and `DECISION_REFOCUSED` (`src/tui/narrator.ts:741-755`), handle both `item.kind === 'DecisionCard'` and `item.kind === 'FailureCard'`.
2. **`src/tui/transcript-store.ts:395-403`:**
   - In `deferFocusedDecision()`, allow both `focused.kind === 'DecisionCard'` and `focused.kind === 'FailureCard'`.
3. **`src/tui/components/Transcript.tsx`:**
   - Update `totalPendingDecisions` (`src/tui/components/Transcript.tsx:83-88`) and `FailureCard` rendering (`src/tui/components/Transcript.tsx:205-244`) to include `item.status === 'deferred'` alongside `item.status === 'pending'`.
   - Pair each rendered element with its estimated row height (`estimateElementRows(item, textWidth)`):
     - `UserMessage` / `SupervisorNote` / `PhaseChange`: `Math.max(1, Math.ceil(item.text.length / textWidth))`
     - `CommitLine` / `QuietCounter`: `1`
     - `DelegationCard`: running/paused `4 + (item.testSummaryText ? 1 : 0)`, completed `1`, completed_with_concerns `2`
     - `DecisionCard`: pending/deferred `4 + (item.contextLine ? 1 : 0) + item.options.length`, answered `1`
     - `FailureCard`: pending/deferred `4 + item.options.length`, resolved `1`
     - `CompletionCard`: `6`
   - When `maxRows !== undefined && maxRows > 0`, reserve 1 row if `showPinnedPrompt` is true, apply `scrollOffset` from the end of `renderedEntries`, and walk backwards accumulating row heights until adding the next item would exceed `availableRows` (always including at least 1 item so a single tall card is never blanked).

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-narrator.test.ts tests/unit/tui-transcript-store.test.ts tests/unit/tui-transcript-cards.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/narrator.ts src/tui/transcript-store.ts src/tui/components/Transcript.tsx tests/unit/tui-narrator.test.ts tests/unit/tui-transcript-store.test.ts tests/unit/tui-transcript-cards.test.tsx
git commit -m "fix(tui): guard startup phase notes, support FailureCard deferral, and slice Transcript by row height"
```

---

### Task 7: Root Viewport Framing, Structural Dividers, CRLF & CommandPalette in `App.tsx`, Alternate Screen Buffer in `src/tui/index.ts`, Takeover Banner De-dup, and `--resume` in CLI

**Wave:** 3
**Depends on:** Task 1, Task 2, Task 4, Task 5, Task 6
**Files Touched:**
- Modify: `src/tui/App.tsx:90-105, 250-300, 348-395, 470-622, 670-805`
- Modify: `src/tui/index.ts:108-115, 188-205, 257-288, 320-344`
- Modify: `src/cli/index.ts:20-66`
- Modify: `src/cli/commands/run.ts:9-70, 133-150`
- Modify: `src/tui/components/TakeoverView.tsx:21-28`
- Test: `tests/unit/tui-app.test.tsx`
- Test: `tests/unit/cli.test.ts`
- Test: `tests/unit/tui-rail-zoom-takeover.test.tsx`

- [ ] **Step 1: Write the failing test**

1. In `tests/unit/tui-app.test.tsx`:
   - **Structural dividers test:** Render `<App dimensions={{ columns: 120, rows: 24 }} ... />` in both empty state (rail hidden) and active state (`activeSubagent: 'implementer'`, rail side-by-side). Verify the rendered frame contains horizontal rule lines (`─`) and, when side-by-side, `┬`, `┴`, and vertical `│` divider characters.
   - **Windows CRLF Enter test:** With a focused `DecisionCard` and non-empty composer or normal chat message, write `'hello\r\n'` to `stdin`. Verify `onWritePty` is called exactly once (`'hello\r'`) and the trailing `\n` does not trigger a second empty Enter submission or accidentally answer a subsequent decision card.
   - **Decision option bounds test:** With a 2-option `DecisionCard` focused, pressing `'5'` does not select option 5 (selection remains at 1).
   - **CommandPalette keyboard navigation test:** Typing `'/'` opens `CommandPalette`, pressing Down arrow (`\x1b[B`) moves selection to `/plan`, and pressing `Tab` (`\t`) autocompletes `composerText` to `'/plan'` instead of switching to `TEAM` mode.
2. In `tests/unit/cli.test.ts`:
   - Verify `--resume` option is registered on both root and `run` commands in `createCliProgram()` (`src/cli/index.ts:12`) and routed to `runCommand` (`src/cli/commands/run.ts:24`).
   - Verify `runCommand` resets the ledger by default (`initLedger(projectDir, { reset: true })`) and starts in `'PLANNING'` before completion, whereas `runCommand(projectDir, { resume: true, dryRun: true })` preserves pre-existing ledger checkpoints.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-app.test.tsx tests/unit/cli.test.ts`
Expected: FAIL on missing dividers, CRLF double submission, out-of-bounds option selection, `Tab` switching to `TEAM` when palette is open, and missing `--resume` flag.

- [ ] **Step 3: Write minimal implementation (Green)**

1. **`src/tui/App.tsx`:**
   - Add `[paletteIndex, setPaletteIndex] = useState<number>(0)` (`src/tui/App.tsx:103`) and `paletteIndexRef`. Reset `paletteIndex` to `0` whenever `composerText` changes.
   - **Decision option count & FailureCard parity (`src/tui/App.tsx:284-290`):**
     ```typescript
     const decisionOptionCount =
       focusedDecision &&
       (focusedDecision.kind === 'DecisionCard' || focusedDecision.kind === 'FailureCard') &&
       focusedDecision.status === 'pending'
         ? focusedDecision.options.length
         : undefined;
     ```
     Pass `decisionOptionCount={decisionOptionCount}` to `<FooterBar ... />` (`src/tui/App.tsx:795`).
   - **CommandPalette Up/Down/Tab/Enter (`src/tui/App.tsx:348-391, 505-516, 583-596`):**
     When `modeRef.current === 'CHAT' && composerTextRef.current.startsWith('/')`:
     - Up/Down arrows cycle `paletteIndex` within `filterSlashCommands(composerTextRef.current)` (`src/tui/components/CommandPalette.tsx:22`).
     - `Tab` (`\t`) sets `composerText` to `matches[safePaletteIdx].command` instead of toggling `TEAM` mode.
     - `Enter` executes `matches[safePaletteIdx]?.command ?? currentText`.
     - Pass `selectedIndex={paletteIndex}` to `<CommandPalette query={composerText} selectedIndex={paletteIndex} theme={theme} />`.
   - **CRLF handling (`src/tui/App.tsx:470-472`):**
     ```typescript
     const char = input[i];
     i++;
     if (char === '\r' && i < input.length && input[i] === '\n') {
       i++;
     }
     ```
   - **Digit bounds check (`src/tui/App.tsx:564-569`):**
     ```typescript
     if (char >= '1' && char <= '9') {
       const digit = parseInt(char, 10);
       if ( digit <= focused.options.length ) {
         effectiveStore.selectDecisionOption(digit);
       }
       continue;
     }
     ```
   - **Root Viewport & Structural Dividers (`src/tui/App.tsx:670-804`):**
     - Set `<Box flexDirection="column" width={columns} height={rows} overflow="hidden">`.
     - Compute `showSplitRule = activeOverlay === null && mode !== 'TAKEOVER' && isRailSideBySide`.
     - Left pane width when split: `leftPaneCols = Math.max(1, columns - 33)` (32 cols for `TeamRail` + 1 col for `│` divider).
     - Render top horizontal rule beneath `HeaderBar`:
       `<Text color={theme.colors.line}>{showSplitRule ? glyphs.hr.repeat(leftPaneCols) + glyphs.teeDown + glyphs.hr.repeat(32) : glyphs.hr.repeat(columns)}</Text>`
     - In the split body row (`<Box flexDirection="row" flexGrow={1} height={bodyRows} overflow="hidden">`), when `isRailSideBySide` is true, render the vertical divider between the left pane and `TeamRail`:
       ```tsx
       <Box width={1} height={bodyRows} flexDirection="column" overflow="hidden">
         {Array.from({ length: bodyRows }, (_, idx) => (
           <Text key={idx} color={theme.colors.line}>{glyphs.vr}</Text>
         ))}
       </Box>
       ```
     - Render bottom horizontal rule above the Composer/FooterBar section:
       `<Text color={theme.colors.line}>{showSplitRule ? glyphs.hr.repeat(leftPaneCols) + glyphs.teeUp + glyphs.hr.repeat(32) : glyphs.hr.repeat(columns)}</Text>`
     - Compute `bodyRows = Math.max(6, rows - 4 - (mode !== 'TAKEOVER' && activeOverlay === null ? composerRows + paletteRows : 0))` (where `4` = 1 HeaderBar + 1 top rule + 1 bottom rule + 1 FooterBar).
2. **`src/tui/components/TakeoverView.tsx:21-28`:**
   - Add optional prop `showBanner?: boolean` (default `true` when rendered standalone in unit tests, `false` when rendered inside `App.tsx` where `FooterBar` already displays the return instruction) so the return instruction is never duplicated in `App.tsx` while existing standalone `TakeoverView` unit tests (`tests/unit/tui-rail-zoom-takeover.test.tsx:582-600`) continue to pass.
3. **`src/tui/index.ts`:**
   - Add `sessionStartedAt?: number` to `MountSupervisorTuiOptions` (`src/tui/index.ts:108-114`) and pass `sessionStartedAt: options.sessionStartedAt` to `new TelemetryStore(...)` (`src/tui/index.ts:196-201`).
   - Before `render(...)` (`src/tui/index.ts:321`), if `process.stdout.isTTY`, write `process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H')`.
   - In `cleanup` (`src/tui/index.ts:280-285`), after `inkInstance.unmount()`, if `process.stdout.isTTY`, write `process.stdout.write('\x1b[?1049l')`.
4. **`src/cli/index.ts` & `src/cli/commands/run.ts`:**
   - Add `--resume` (`'Resume previous supervisor session state and plan'`) to root and `run` commands in `src/cli/index.ts:20-63` and `resume?: boolean` to `RunOptions` in `src/cli/commands/run.ts:9-19`.
   - In `runCommand` (`src/cli/commands/run.ts:31`):
     ```typescript
     const ledger = initLedger(projectDir, { reset: !options?.resume });
     const sessionStartedAt = options?.resume ? 0 : Date.parse(ledger.createdAt) || Date.now();
     ```
   - Pass `sessionStartedAt` into `mountSupervisorTui` (`src/tui/index.ts:188`).
   - In `src/cli/commands/run.ts:134-147`, set `ledger.status = options?.resume && ledger.status === 'EXECUTING' ? 'EXECUTING' : 'PLANNING'` instead of unconditionally forcing `'EXECUTING'`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-app.test.tsx tests/unit/cli.test.ts tests/unit/tui-rail-zoom-takeover.test.tsx && npm test && npx tsc --noEmit`
Expected: All 21+ test files PASS and `tsc --noEmit` exits 0 with zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/tui/App.tsx src/tui/index.ts src/tui/components/TakeoverView.tsx src/cli/index.ts src/cli/commands/run.ts tests/unit/tui-app.test.tsx tests/unit/cli.test.ts tests/unit/tui-rail-zoom-takeover.test.tsx
git commit -m "feat(tui,cli): add full-viewport framing dividers, alternate screen buffer, CRLF/palette fixes, and --resume flag"
```
