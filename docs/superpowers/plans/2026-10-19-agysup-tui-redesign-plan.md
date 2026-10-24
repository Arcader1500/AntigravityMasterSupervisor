# `agysup` Conversational TUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-panel module TUI in `src/tui/` with a single conversational supervisor interface backed by a pure narration reducer (`src/tui/narrator.ts`), transcript store (`src/tui/transcript-store.ts`), semantic theme/glyph system, and four interaction modes (`CHAT`, `TEAM`, `ZOOM`, `TAKEOVER`).

**Architecture:** `TelemetryParser` and `WorkspacePoller` are extended to emit structured `TelemetryEvent` items, per-agent grouped steps, wave metadata, and task checklists while preserving existing `ParserState` and `TelemetrySnapshot` contracts. A pure reducer in `src/tui/narrator.ts` transforms telemetry and workspace events into typed `TranscriptItem` records managed by `src/tui/transcript-store.ts` (including soft-pause queueing, ledger/PTY exit synchronization, and standardized PTY keystroke translation). `src/tui/App.tsx` implements the 4-mode keyboard router, responsive 80×24 / 110-column split layout, inline decision/failure/completion cards, and `/spec`, `/plan`, `/audit`, and `/raw` overlays.

**Tech Stack:** TypeScript 5.4 (ESM, NodeNext), React 18, Ink 5, `@xterm/headless` 5.5, `node-pty` 1.0, Vitest 1.5, `ink-testing-library` 4.0.

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| Wave 1 | Task 1, Task 2 | Visual tokens/glyphs (`theme.ts`, `glyphs.ts`) and Telemetry/Poller extensions (`types.ts`, `parser.ts`, `poller.ts`, `store.ts`) | **Task 1:** `src/tui/theme.ts`, `src/tui/glyphs.ts`, `tests/unit/tui-theme-glyphs.test.ts`<br>**Task 2:** `src/telemetry/types.ts`, `src/telemetry/parser.ts`, `src/telemetry/poller.ts`, `src/telemetry/store.ts`, `tests/unit/telemetry-parser.test.ts`, `tests/unit/telemetry-poller.test.ts`, `tests/unit/telemetry-store.test.ts` |
| Wave 2 | Task 3, Task 4 | Pure Narrator reducer & copy templates (`narrator.ts`, `narrator-copy.ts`), and `HeaderBar` / `FooterBar` redesign | **Task 3:** `src/tui/narrator-copy.ts`, `src/tui/narrator.ts`, `tests/unit/tui-narrator.test.ts`<br>**Task 4:** `src/tui/components/HeaderBar.tsx`, `src/tui/components/FooterBar.tsx`, `tests/unit/tui-header-footer.test.tsx` |
| Wave 3 | Task 5, Task 6, Task 7, Task 8 | Transcript store (`transcript-store.ts`), Transcript & cards (`DelegationCard`, `DecisionCard`, `FailureCard`, `Transcript`), Rail/Zoom/Takeover views (`TeamRail`, `ZoomView`, `TakeoverView`), and Composer/CommandPalette (`Composer`, `CommandPalette`) | **Task 5:** `src/tui/transcript-store.ts`, `tests/unit/tui-transcript-store.test.ts`<br>**Task 6:** `src/tui/components/DelegationCard.tsx`, `src/tui/components/DecisionCard.tsx`, `src/tui/components/FailureCard.tsx`, `src/tui/components/Transcript.tsx`, `tests/unit/tui-transcript-cards.test.tsx`<br>**Task 7:** `src/tui/components/TeamRail.tsx`, `src/tui/components/ZoomView.tsx`, `src/tui/components/TakeoverView.tsx`, `tests/unit/tui-rail-zoom-takeover.test.tsx`<br>**Task 8:** `src/tui/components/CommandPalette.tsx`, `src/tui/components/Composer.tsx`, `tests/unit/tui-composer.test.tsx` |
| Wave 4 | Task 9 | `App.tsx` mode router, responsive layout shell, overlay wiring, legacy view removal, and full test/typecheck verification | **Task 9:** `src/tui/App.tsx`, `src/tui/index.ts`, `src/index.ts`, `src/tui/components/MainStatusView.tsx` (delete), `src/tui/components/LivePtyView.tsx` (delete), `tests/unit/live-pty-view.test.tsx` (delete), `tests/unit/tui-views.test.tsx`, `tests/unit/tui-app.test.tsx` |

---

## Tasks

### Task 1: Visual System — Semantic Theme Tokens and Glyph Map

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Create: `src/tui/theme.ts`
- Create: `src/tui/glyphs.ts`
- Test: `tests/unit/tui-theme-glyphs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-theme-glyphs.test.ts` to verify:
1. `resolveTheme({ env: {}, colorLevel: 3 })` returns `mode: 'truecolor'`, `noMotion: false`, and hex palette `{ text: '#D5E2E6', dim: '#84A0AD', active: '#5CC8C0', done: '#8CCB8A', ask: '#FF8FA2', line: '#2C4A5E' }`.
2. `resolveTheme({ env: {}, colorLevel: 2 })` returns `mode: 'ansi16'` with `{ text: 'white', dim: 'gray', active: 'cyan', done: 'green', ask: 'magentaBright', line: 'blue' }`.
3. `resolveTheme({ env: { NO_COLOR: '1' }, colorLevel: 3 })` and `colorLevel: 0` return `mode: 'monochrome'` with all color tokens `undefined`.
4. `resolveTheme({ env: { COLORFGBG: '0;15', NO_MOTION: '1' }, colorLevel: 3 })` returns `mode: 'light'`, `colors.text === undefined`, `colors.dim === 'gray'`, and `noMotion: true`.
5. `resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'win32' })` returns Unicode glyphs (`done: '✓'`, `running: '▸'`, `paused: '❚❚'`, `prompt: '›'`, `treeBranch: '├'`, `treeLast: '└'`, `spinnerFrames: ['▸', '▹', '▸', '▹']`), whereas `AGYSUP_ASCII: '1'` or legacy Windows console (`platform: 'win32', env: {}`) returns ASCII fallbacks (`done: '[x]'`, `running: '>'`, `paused: '||'`, `prompt: '>'`, `treeBranch: '|-'`, `treeLast: '`-'`, `spinnerFrames: ['>', '-', '>', '-']`).

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';

describe('theme and glyphs', () => {
  it('resolves truecolor, ansi16, monochrome, light mode, and unicode/ascii glyphs', () => {
    expect(resolveTheme({ env: {}, colorLevel: 3 }).colors.ask).toBe('#FF8FA2');
    expect(resolveTheme({ env: {}, colorLevel: 2 }).colors.ask).toBe('magentaBright');
    expect(resolveTheme({ env: { NO_COLOR: '1' }, colorLevel: 3 }).mode).toBe('monochrome');
    expect(resolveGlyphs({ env: { AGYSUP_ASCII: '1' } }).done).toBe('[x]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-theme-glyphs.test.ts`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/theme.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

Create `src/tui/theme.ts` and `src/tui/glyphs.ts`:
- In `src/tui/theme.ts`, export:
  - `export type ThemeToken = 'text' | 'dim' | 'active' | 'done' | 'ask' | 'line';`
  - `export interface ThemeConfig { mode: 'truecolor' | 'ansi16' | 'light' | 'monochrome'; noMotion: boolean; colors: Record<ThemeToken, string | undefined>; }`
  - `export interface ResolveThemeOptions { env?: NodeJS.ProcessEnv; colorLevel?: number; }`
  - `export function resolveTheme(options?: ResolveThemeOptions): ThemeConfig`
  - Detect default `colorLevel` when omitted from `process.env.FORCE_COLOR` or `process.stdout?.colorDepth?.() ?? 3` (`>= 24` -> `3`, `>= 4` -> `1`, else `0`).
  - When `env.NO_COLOR !== undefined && env.NO_COLOR !== ''` or `colorLevel === 0`, return `mode: 'monochrome'` with all `colors` set to `undefined`.
  - When `env.COLORFGBG` ends with `;7` or `;15` (light background), return `mode: 'light'` with `text: undefined` and `dim: 'gray'`.
  - When `colorLevel < 3`, return `mode: 'ansi16'` with `{ text: 'white', dim: 'gray', active: 'cyan', done: 'green', ask: 'magentaBright', line: 'blue' }`.
  - Otherwise return `mode: 'truecolor'` with the exact hex values from Section 4 of the spec.
  - Set `noMotion: env.NO_MOTION === '1' || env.NO_MOTION === 'true'`.
- In `src/tui/glyphs.ts`, export:
  - `export interface GlyphSet { done: string; running: string; paused: string; prompt: string; treeBranch: string; treeLast: string; spinnerFrames: readonly [string, string, string, string]; }`
  - `export function resolveGlyphs(options?: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): GlyphSet`
  - Use ASCII fallback when `env.AGYSUP_ASCII === '1'` or (`platform === 'win32'` and none of `env.WT_SESSION`, `env.TERM_PROGRAM`, `env.ConEmuANSI`, or `env.TERM === 'xterm-256color'` are present).
  - Unicode `spinnerFrames`: `['▸', '▹', '▸', '▹']`; ASCII `spinnerFrames`: `['>', '-', '>', '-']`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-theme-glyphs.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/theme.ts src/tui/glyphs.ts tests/unit/tui-theme-glyphs.test.ts
git commit -m "feat(tui): add semantic theme tokens and unicode/ascii glyph resolver"
```

---

### Task 2: Extended Telemetry Types, Parser Structured Events & Step Grouping, and Plan Poller Waves/Checklists

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `src/telemetry/types.ts:1-71`
- Modify: `src/telemetry/parser.ts:1-225`
- Modify: `src/telemetry/poller.ts:15-99`
- Modify: `src/telemetry/store.ts:27-267`
- Modify: `tests/unit/telemetry-parser.test.ts`
- Modify: `tests/unit/telemetry-poller.test.ts`
- Modify: `tests/unit/telemetry-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append new test blocks to `tests/unit/telemetry-parser.test.ts`, `tests/unit/telemetry-poller.test.ts`, and `tests/unit/telemetry-store.test.ts`:
1. In `tests/unit/telemetry-poller.test.ts`:
   - Test `parsePlanTasks` ([`src/telemetry/poller.ts:15`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/poller.ts#L15)) with `## Execution Waves` table (`| Wave 1 | Task 1, Task 2 | ... |` and `| Wave 2 | Task 3 | ... |`) or `**Wave:** 2` metadata inside `### Task N: Title`, asserting `task.index === 1`, `task.wave === 1`, `task.totalWaves === 2`, and `task.checklist` containing `[{ text: 'Write the failing test', checked: true }, { text: 'Implement middleware', checked: false }]`.
2. In `tests/unit/telemetry-parser.test.ts`:
   - Test `parser.onEvent(listener)` on `TelemetryParser` ([`src/telemetry/parser.ts:45`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/parser.ts#L45)) emitting:
     - `SUBAGENT_DISPATCHED` when `invoke_subagent -> implementer` is processed.
     - `TOOL_CALLED` with `addedLines: 84` when `write_to_file -> src/middleware/limiter.ts (+84 lines)` is processed, and `mcpQuery` when `semantic_search_nodes_tool -> rateLimiter` is processed.
     - Consecutive `view_file` calls grouped into a single `AgentStepItem` (`kind: 'read'`, `targets: ['auth.ts', 'config.ts', 'limiter.test.ts']`) in `parser.getState().agentSteps['implementer']`.
     - `COMMAND_FINISHED` and `TEST_SUMMARY` when `run_command: npm test` and `Tests  14 passed, 0 failed (14)` / `(Exit 0)` are processed.
     - `ERROR_LINE` and `lastErrorLine` populated when `Error: connect ECONNREFUSED 127.0.0.1:6379` is processed.
     - `DECISION_PROMPT` (`promptKind: 'ask_question'`) when an `ask_question` block and numbered option lines (`1. (Recommended) 429 with a Retry-After header`, `2. 429 with no header`) are processed, and `promptKind: 'permission'` when `Allow command npm test? (ctrl+k)` is processed.
3. In `tests/unit/telemetry-store.test.ts`:
   - Verify `store.onTelemetryEvent(fn)` on `TelemetryStore` ([`src/telemetry/store.ts:27`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/store.ts#L27)) forwards structured `TelemetryEvent` items when `VirtualTerminal` commits lines, and `store.getSnapshot()` exposes `agentSteps` and `lastErrorLine`.

- [ ] **Step 2: Run tests to verify they fail (Red)**

Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-parser.test.ts tests/unit/telemetry-store.test.ts`  
Expected: FAIL on missing `task.checklist`, `task.wave`, `parser.onEvent`, and `store.onTelemetryEvent`.

- [ ] **Step 3: Write minimal implementation (Green)**

1. Modify [`src/telemetry/types.ts:12-66`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/types.ts#L12-L66):
   - Add `TaskChecklistItem`, `AgentStepKind`, `AgentStepItem`, and `TelemetryEvent` union as specified in Section 4.2 of the design spec.
   - Extend `PlanTaskItem` ([`src/telemetry/types.ts:12-17`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/types.ts#L12-L17)) with `index?: number; wave?: number; totalWaves?: number; checklist?: TaskChecklistItem[];`.
   - Extend `ParserState` ([`src/telemetry/types.ts:19-27`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/types.ts#L19-L27)) and `TelemetrySnapshot` ([`src/telemetry/types.ts:43-66`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/types.ts#L43-L66)) with `lastErrorLine: string | null` and `agentSteps: Record<string, AgentStepItem[]>`.
2. Modify [`src/telemetry/poller.ts:15-99`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/poller.ts#L15-L99) in `parsePlanTasks`:
   - Scan wave table rows (`/^\|\s*Wave\s+(\d+)\s*\|\s*([^|]+)\|/i`) and task-level `**Wave:** (\d+)` lines to map task numbers to wave numbers and compute `totalWaves`.
   - When matching checkboxes (`trimmed.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/)` at [`src/telemetry/poller.ts:84`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/poller.ts#L84)), strip markdown bold markers (`**`) from the captured label and push `{ text, checked }` into the task's `checklist` array. Set 1-based `index` on each `PlanTaskItem`.
3. Modify [`src/telemetry/parser.ts:45-225`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/parser.ts#L45-L225) in `TelemetryParser`:
   - Add `private eventListeners = new Set<(event: TelemetryEvent) => void>();` and `public onEvent(listener: (event: TelemetryEvent) => void): () => void`.
   - Parse test runner summary lines (`/(?:Tests?:?\s*)?(?:(\d+)\s+failed,\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i`), diff line counts (`/\(\+(\d+)\s+lines?\)/i`), MCP code-graph tools (`/(?:semantic_search_nodes_tool|query_graph_tool|get_impact_radius_tool|detect_changes_tool|get_affected_flows_tool|call_mcp_tool)[:\s->]+(.+)/i`), and error lines (`/(?:^Error:|FAIL\b|ECONNREFUSED|connection refused|Command failed)/i`).
   - Maintain `state.agentSteps[actor]` with consecutive read grouping: if the previous step for `actor` has `kind === 'read'` and the new tool is `view_file` / `read_file`, append the basename/path to `prevStep.targets` and set `prevStep.status = 'running'`. Mark the previous `'running'` step as `'ok'` when the next step starts (and if a previous step had `status === 'failed'`, transition it to `'failed_recovered'` when a subsequent step succeeds).
   - Buffer multi-line `ask_question` prompts: when `ask_question` or a question line ending with `?` is detected while `waitingForInput` is active, collect subsequent numbered option lines (`/^\s*(?:\[?\d+\]?[.)]?)\s*(.+)$/`) and emit `DECISION_PROMPT` (updating the prompt options as numbered lines arrive). For `ctrl+k` / `allow command`, emit `DECISION_PROMPT` with `promptKind: 'permission'` and options `[{ index: 1, label: 'Allow', recommended: true }, { index: 2, label: "Don't allow" }]`.
4. Modify [`src/telemetry/store.ts:27-267`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/store.ts#L27-L267) in `TelemetryStore`:
   - Add `public onTelemetryEvent(listener: (event: TelemetryEvent) => void): () => void` delegating to `this.parser.onEvent(listener)`.
   - Include `lastErrorLine: parserState.lastErrorLine` and `agentSteps: parserState.agentSteps` in `getSnapshot()` ([`src/telemetry/store.ts:227-266`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/store.ts#L227-L266)).

- [ ] **Step 4: Run tests to verify they pass (Green)**

Run: `npx vitest run tests/unit/telemetry-poller.test.ts tests/unit/telemetry-parser.test.ts tests/unit/telemetry-store.test.ts`  
Expected: PASS (all existing and new telemetry tests green).

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/types.ts src/telemetry/parser.ts src/telemetry/poller.ts src/telemetry/store.ts tests/unit/telemetry-parser.test.ts tests/unit/telemetry-poller.test.ts tests/unit/telemetry-store.test.ts
git commit -m "feat(telemetry): emit structured events, agent step groups, and plan wave checklists"
```

---

### Task 3: Pure Narrator Reducer & Copy Templates (`narrator-copy.ts` and `narrator.ts`)

**Wave:** 2  
**Depends on:** Task 1, Task 2  
**Files Touched:**
- Create: `src/tui/narrator-copy.ts`
- Create: `src/tui/narrator.ts`
- Test: `tests/unit/tui-narrator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-narrator.test.ts` covering every row of the Section 5 event-to-item mapping table in the UX spec:
- First launch state contains only the initial `SupervisorNote` and `hasStarted === false`.
- `USER_MESSAGE` appends a `UserMessage` item and sets `hasStarted === true`.
- `SUBAGENT_DISPATCHED` creates a running `DelegationCard` (`wave 2 of 3` when wave metadata exists, `task 3 of 5` when waves are absent).
- `TOOL_CALLED`, `COMMAND_STARTED`, and `TEST_SUMMARY` update the live `DelegationCard` in place (`nowSentence: 'The implementer is writing src/middleware/limiter.ts, 1m 12s in.'`, `testSummaryText: '14 of 14 tests pass so far.'`) without appending a new item.
- `SUBAGENT_COMPLETED` with `DONE` collapses the `DelegationCard` (`status: 'completed'`); `DONE_WITH_CONCERNS` collapses with `status: 'completed_with_concerns'` and note `"Finished with concerns. Reviewer will check."`; `BLOCKED` or `NEEDS_CONTEXT` converts the card into a `FailureCard` quoting `lastErrorLine` (or the fallback message when no reason was parsed).
- `NEW_COMMIT` appends a `CommitLine` (`✓ f4e5d6a   Task 2 committed: token bucket`).
- `LEDGER_STATUS_CHANGED` appends a `PhaseChange` note, emits the context-reset `SupervisorNote` when transitioning from `PLANNING` / `CHECKPOINT_SPEC` to `EXECUTING`, and appends a `CompletionCard` when transitioning to `COMPLETED`.
- `DECISION_PROMPT` appends a `DecisionCard`, sets `latestBellDecisionId`, and increments `pendingDecisionCount`; `DECISION_ANSWERED` collapses the card to `"You chose: <answer>."` and decrements `pendingDecisionCount`.
- `QUIET_COUNT_UPDATED` maintains a single `QuietCounter` item immediately above the active `DelegationCard` (and omits it when `promptsApproved === 0`).

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-narrator.test.ts`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/narrator.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

1. Create `src/tui/narrator-copy.ts`:
   - Export `FIRST_LAUNCH_NOTE`, `CONTEXT_RESET_NOTE`, `COMPLETION_NEXT_STEPS_NOTE`, `HELP_TEXT_NOTE`, `TOOL_VERB_MAP: Record<string, string>`, `formatNowSentence(role, toolName, target, elapsedFormatted)`, `formatTestSummarySentence(role, passed, failed)`, `formatPhaseChangeNote(prevStatus, nextStatus, specApprovedAt, taskCount, waveCount)`, and `formatBlockedFallbackReason(role)`.
2. Create `src/tui/narrator.ts`:
   - Export `TranscriptItem` union (Section 4.3 of the design spec), `NarratorState`, `NarratorInputEvent`, `createInitialNarratorState()`, and pure reducer `reduceNarrator(state: NarratorState, event: NarratorInputEvent): NarratorState`.

```typescript
export interface NarratorState {
  hasStarted: boolean;
  items: TranscriptItem[];
  pendingDecisionCount: number;
  latestBellDecisionId: string | null;
  tasks: PlanTaskItem[];
  activeTaskNumber: number;
  ledgerStatus: string;
}

export type NarratorInputEvent =
  | { type: 'USER_MESSAGE'; text: string; timestamp: string }
  | { type: 'TELEMETRY_EVENT'; event: TelemetryEvent; elapsedFormatted: string; lastErrorLine?: string | null }
  | { type: 'TASKS_UPDATED'; tasks: PlanTaskItem[] }
  | { type: 'NEW_COMMIT'; sha: string; subject: string; timestamp: string }
  | { type: 'LEDGER_STATUS_CHANGED'; status: string; prevStatus: string; branchName?: string; totalElapsedFormatted?: string; timestamp: string }
  | { type: 'PTY_EXITED'; exitCode: number; lastErrorLine?: string | null; timestamp: string }
  | { type: 'DECISION_SELECTION_CHANGED'; id: string; selectedOptionIndex: number }
  | { type: 'DECISION_DEFERRED'; id: string }
  | { type: 'DECISION_REFOCUSED' }
  | { type: 'DECISION_ANSWERED'; id: string; answerText: string }
  | { type: 'QUIET_COUNT_UPDATED'; promptsApproved: number; questionsAnswered?: number; planFixes?: number }
  | { type: 'APPEND_SUPERVISOR_NOTE'; text: string; timestamp: string }
  | { type: 'TICK_ELAPSED'; elapsedFormatted: string };
```

- Ensure `QuietCounter` is always repositioned directly above the first active `DelegationCard` (or at the end of `items` if no card is active) and omitted when `promptsApproved === 0`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-narrator.test.ts`  
Expected: PASS (all Section 5 event-to-item mapping rows verified).

- [ ] **Step 5: Commit**

```bash
git add src/tui/narrator-copy.ts src/tui/narrator.ts tests/unit/tui-narrator.test.ts
git commit -m "feat(tui): implement pure narrator reducer and copy templates"
```

---

### Task 4: Rework `HeaderBar.tsx` and `FooterBar.tsx`

**Wave:** 2  
**Depends on:** Task 1, Task 2  
**Files Touched:**
- Modify: `src/tui/components/HeaderBar.tsx:1-75`
- Modify: `src/tui/components/FooterBar.tsx:1-78`
- Test: `tests/unit/tui-header-footer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-header-footer.test.tsx` testing:
- `HeaderBar` renders bold `agysup` wordmark, branch name, phase strip (`Spec ✓  Plan ✓  Build ▸ wave 2 of 3  Verify`), and single right-aligned elapsed timer (`06:42`).
- `HeaderBar` in `ZOOM` mode renders breadcrumb `Team / implementer, Task 3` instead of the phase strip.
- `HeaderBar` renders `1 needs you` badge when `pendingDecisionCount === 1` (with `inverse` in monochrome mode) and `Paused` in `ask` when `isPaused === true`.
- `FooterBar` renders context-sensitive hints for each mode (`CHAT`, `CHAT` when paused, `CHAT` with focused decision card, `TEAM`, `ZOOM`, `TAKEOVER`, overlay open, and double `Ctrl+C` quit confirmation `"Stop the team and quit? Press Ctrl+C again."`) with zero `[1]`–`[4]` tab pills.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-header-footer.test.tsx`  
Expected: FAIL because `HeaderBar` and `FooterBar` only render the legacy `[NAV]`/`[1] Main Status` chrome.

- [ ] **Step 3: Write minimal implementation (Green)**

1. Modify [`src/tui/components/HeaderBar.tsx:1-75`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/HeaderBar.tsx#L1-L75):
   - Keep `export function formatDuration(ms: number): string` ([`src/tui/components/HeaderBar.tsx:5-15`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/HeaderBar.tsx#L5-L15)) intact. Add `export function formatCompactTimer(ms: number): string` returning `MM:SS` under 60 minutes and `HH:MM:SS` at 60+ minutes.
   - Update `HeaderBarProps` to accept the conversational props (`specApproved`, `planApproved`, `currentWave`, `totalWaves`, `currentTask`, `totalTasks`, `pendingDecisionCount`, `isPaused`, `zoomTarget`, `theme`, `glyphs`) while keeping legacy `inputMode?: InputMode; waitingForInput?: boolean` optional.
   - **Backward-Compatibility Guard for Waves 2–3:** When `inputMode !== undefined` is passed without the conversational props (`specApproved === undefined && pendingDecisionCount === undefined && zoomTarget === undefined && !isPaused`), render the legacy `[NAV]` / `[PTY INTERACT]` and `[WAITING FOR INPUT]` output so [`tests/unit/tui-views.test.tsx:16-86`](file:///D:/Code/AntigravityMasterSupervisor/tests/unit/tui-views.test.tsx#L16-L86) and [`src/tui/App.tsx:252-258`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx#L252-L258) continue passing without regression until Task 9 in Wave 4.
2. Modify [`src/tui/components/FooterBar.tsx:1-78`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/components/FooterBar.tsx#L1-L78):
   - Update `FooterBarProps` to support `mode?: 'CHAT' | 'TEAM' | 'ZOOM' | 'TAKEOVER'`, `hasFocusedDecision?: boolean`, `isPaused?: boolean`, `confirmingQuit?: boolean`, `activeOverlay?: null | 'spec' | 'plan' | 'audit' | 'raw'`, `theme?: ThemeConfig`, plus optional legacy `activePanel?: TuiPanelId; inputMode?: InputMode; activeDoc?: 'spec' | 'plan'`.
   - When `mode === undefined && activePanel !== undefined`, render the legacy footer so `tests/unit/tui-views.test.tsx` continues passing during Waves 2–3; when `mode !== undefined` (or `confirmingQuit` / `activeOverlay` is set), render the single-line context-sensitive hints matching Sections 2, 3, 6, 7, and 8 of the UX spec.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-header-footer.test.tsx tests/unit/tui-views.test.tsx`  
Expected: PASS (both new conversational tests and legacy view tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/HeaderBar.tsx src/tui/components/FooterBar.tsx tests/unit/tui-header-footer.test.tsx
git commit -m "feat(tui): redesign HeaderBar and FooterBar for conversational modes"
```

---

### Task 5: Transcript Store, Soft-Pause Controller & Keystroke Protocol (`transcript-store.ts`)

**Wave:** 3  
**Depends on:** Task 2, Task 3  
**Files Touched:**
- Create: `src/tui/transcript-store.ts`
- Test: `tests/unit/tui-transcript-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-transcript-store.test.ts` verifying:
- Subscribing to `TelemetryStore` ([`src/telemetry/store.ts:27`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/store.ts#L27)) and `TelemetryParser` ([`src/telemetry/parser.ts:45`](file:///D:/Code/AntigravityMasterSupervisor/src/telemetry/parser.ts#L45)) feeds events into `NarratorState`.
- PTY startup noise lines before user submission do not create transcript items, whereas `submitUserMessage('Build rate limiter')` writes `'Build rate limiter\r'` via `onWritePty` and appends `UserMessage`.
- Calling `updateLedger(nextLedger)` when `nextLedger.status` changes from `'PLANNING'` to `'EXECUTING'` dispatches `LEDGER_STATUS_CHANGED` into the narrator (emitting the context-reset `SupervisorNote`), and transitioning to `'COMPLETED'` dispatches `LEDGER_STATUS_CHANGED` (emitting `CompletionCard`).
- Calling `handlePtyExit(1)` dispatches `PTY_EXITED` into the narrator, producing a `FailureCard` (`failureKind: 'pty_exit'`).
- Answering a `DecisionCard`:
  - Option 1 on `ask_question` menu sends `'\r'`; Option 2 sends `'\x1b[B\r'`; Option 3 sends `'\x1b[B\x1b[B\r'`.
  - Free-form text `'Custom 429 body'` on a 3-option `ask_question` menu sends `'\x1b[B\x1b[B\x1b[B\rCustom 429 body\r'`.
  - Permission prompt Option 1 (`Allow`) sends `'\x0b'`; Option 2 (`Don't allow`) sends `'\x1b'`.
  - `FailureCard` Option 1 (`Retry`) sends retry instruction + `'\r'`; Option 2 (`Skip`) sends skip instruction + `'\r'`; Option 3 (`Take over`) invokes `onEnterTakeover()`.
- Terminal bell callback `onRingBell` fires exactly once per unique `DecisionCard` ID.
- Soft-pause (`pause()` / `resume()`): when paused, `submitUserMessage` and `answerFocusedDecision` enqueue PTY writes instead of calling `onWritePty` immediately; calling `resume()` flushes queued PTY writes in FIFO order.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-transcript-store.test.ts`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/transcript-store.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

Create `src/tui/transcript-store.ts`:
- Export `TranscriptStoreOptions`, `TranscriptStoreSnapshot`, and `class TranscriptStore`:
  ```typescript
  export interface TranscriptStoreOptions {
    telemetryStore: TelemetryStore;
    parser?: TelemetryParser;
    initialLedger?: SupervisorLedger;
    onWritePty: (data: string) => void;
    onRingBell?: () => void;
    onEnterTakeover?: () => void;
    onOpenOverlay?: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => void;
    onRequestQuit?: () => void;
    getPtyPid?: () => number | undefined;
    platform?: NodeJS.Platform;
  }
  ```
- Implement:
  - `subscribe(listener: () => void): () => void`
  - `getSnapshot(): TranscriptStoreSnapshot`
  - `submitUserMessage(text: string): void`
  - `selectDecisionOption(index: number): void`
  - `answerFocusedDecision(freeformText?: string): void`
  - `deferFocusedDecision(): void`
  - `refocusDeferredDecision(): void`
  - `updateLedger(ledger: SupervisorLedger): void` — compares `ledger.status` against `this.lastLedgerStatus`; on change, dispatches `{ type: 'LEDGER_STATUS_CHANGED', status: ledger.status, prevStatus: this.lastLedgerStatus, branchName, totalElapsedFormatted, timestamp }` and when `ledger.status === 'CHECKPOINT_SPEC'` dispatches a spec-review `DecisionCard` (`promptKind: 'checkpoint_spec'`).
  - `handlePtyExit(exitCode: number): void` — when `exitCode !== 0`, dispatches `{ type: 'PTY_EXITED', exitCode, lastErrorLine, timestamp }`.
  - `pause(): void` and `resume(): void` — on POSIX (`(options.platform ?? process.platform) !== 'win32'`) with valid `getPtyPid()`, sends `process.kill(pid, 'SIGSTOP')` on pause and `process.kill(pid, 'SIGCONT')` on resume (in try/catch), then flushes `this.pendingPtyWrites`.
  - `runSlashCommand(cmd: string): void` and `dispose(): void`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-transcript-store.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/transcript-store.ts tests/unit/tui-transcript-store.test.ts
git commit -m "feat(tui): add TranscriptStore with soft-pause queue and PTY keystroke protocol"
```

---

### Task 6: Transcript View & Inline Cards (`DelegationCard.tsx`, `DecisionCard.tsx`, `FailureCard.tsx`, `Transcript.tsx`)

**Wave:** 3  
**Depends on:** Task 1, Task 3  
**Files Touched:**
- Create: `src/tui/components/DelegationCard.tsx`
- Create: `src/tui/components/DecisionCard.tsx`
- Create: `src/tui/components/FailureCard.tsx`
- Create: `src/tui/components/Transcript.tsx`
- Test: `tests/unit/tui-transcript-cards.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-transcript-cards.test.tsx` using `render` from `'ink-testing-library'` to verify:
- `DelegationCard`: renders round border in `line` token while `status === 'running'`, bold task title, right-aligned `wave 2 of 3` (or `task 3 of 5`), `nowSentence`, optional `testSummaryText` and `nextStepText`, and collapses to a plain `✓ Task 3: Route middleware` line when `status === 'completed'` (or adds `"Finished with concerns. Reviewer will check."` when `completed_with_concerns`).
- `DecisionCard`: renders round border in `ask` token (or `[!] ` title prefix in monochrome mode), bold headline, question, optional `"I checked first: ..."` context line, numbered options with `(recommended)` on option 1, highlights `selectedOptionIndex`, and collapses to `"You chose: ..."` when `status === 'answered'`.
- `FailureCard`: renders round border in `ask` token, headline (`"Task 4 is blocked"`), quoted error reason (or fallback sentence), and numbered options `1 Retry the task`, `2 Skip it and continue the wave`, `3 Take over the terminal`.
- `Transcript`:
  - Renders 12-column hanging-indent labels for `you` (dim) and `supervisor` (active) with text column capped at 76 columns.
  - Renders `QuietCounter` as a single `dim` line (`"14 permission prompts approved for you. None needed you."`) directly above the active `DelegationCard` when present in `items`.
  - Renders `CompletionCard` in `done` token showing branch name, task count, commit count, verifier result, total elapsed time, and plain next-steps line `"Review the branch, then merge when you are ready."`.
  - Shows at most 3 live `DelegationCard` boxes and collapses extra running cards into `"+N more running"`.
  - Shows only the oldest pending `DecisionCard` expanded and collapses newer queued decisions into `"+N more waiting"`.
  - When `scrollOffset > 0` and `pendingDecisionCount > 0`, displays the pinned prompt `"1 needs you. Press End to jump to it."` at the bottom of the transcript viewport.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-transcript-cards.test.tsx`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/components/Transcript.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

Create `src/tui/components/DelegationCard.tsx`, `src/tui/components/DecisionCard.tsx`, `src/tui/components/FailureCard.tsx`, and `src/tui/components/Transcript.tsx`:
- In `DelegationCard.tsx`: use a `250ms` `setInterval` when `status === 'running' && !theme.noMotion` to cycle `glyphs.spinnerFrames`; clear interval on unmount or completion.
- In `DecisionCard.tsx` and `FailureCard.tsx`: apply `borderStyle="round"` and `borderColor={theme.colors.ask}`; prefix headline with `theme.mode === 'monochrome' ? '[!] ' : ''`.
- In `Transcript.tsx`:
  - Accept `items: TranscriptItem[]`, `scrollOffset: number`, `maxRows: number`, `maxWidth: number`, `pendingDecisionCount: number`, `focusedDecisionId: string | null`, `theme: ThemeConfig`, and `glyphs: GlyphSet`.
  - Enforce the 12-column label box + `Math.min(76, maxWidth - 12)` text box hanging indent for `UserMessage`, `SupervisorNote`, and `PhaseChange`.
  - Render `QuietCounter` as a single `dim` line (`color={theme.colors.dim}`) immediately above the active `DelegationCard`.
  - Render `CompletionCard` with a round border in `theme.colors.done` summarizing `branchName`, `taskCount`, `commitCount`, `verifierResult`, and `totalElapsedFormatted`, followed by the plain line `"Review the branch, then merge when you are ready."`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-transcript-cards.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/DelegationCard.tsx src/tui/components/DecisionCard.tsx src/tui/components/FailureCard.tsx src/tui/components/Transcript.tsx tests/unit/tui-transcript-cards.test.tsx
git commit -m "feat(tui): add Transcript, DelegationCard, DecisionCard, FailureCard, and CompletionCard"
```

---

### Task 7: Team Rail, Zoom View & Takeover View (`TeamRail.tsx`, `ZoomView.tsx`, `TakeoverView.tsx`)

**Wave:** 3  
**Depends on:** Task 1, Task 2, Task 3  
**Files Touched:**
- Create: `src/tui/components/TeamRail.tsx`
- Create: `src/tui/components/ZoomView.tsx`
- Create: `src/tui/components/TakeoverView.tsx`
- Test: `tests/unit/tui-rail-zoom-takeover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-rail-zoom-takeover.test.tsx` verifying:
- `TeamRail`:
  - Renders 32-column rail with `Team` tree (`orchestrator`, `├ implementer`, `├ code-reviewer`, `└ verifier`), highlighting the selected row with `inverse` when `isFocused === true`, and coloring `paused, needs you` in `ask`.
  - In Planning phase (`ledgerStatus === 'PLANNING'` with no plan tasks), renders `planner`, `researcher`, `plan-critic` in `Team` and `"Tasks appear once the plan is approved."` under `Tasks`.
  - In Build phase, renders `Tasks` list with `✓`, `▸`, and space prefixes, truncating titles with `…` (or `...` in ASCII mode) at 32 columns.
  - In `ZOOM` mode, renders `"Task N checklist from the plan"` using `task.checklist` items.
  - Omits `"Handled for you"` block when counts are zero; renders it when `handledCounts.promptsApproved > 0`.
- `ZoomView`:
  - Renders summary card (`Started 1m 12s ago. Four steps so far, nothing failed.`), grouped step lines (`Read auth.ts, config.ts and limiter.test.ts`, `Wrote src/middleware/limiter.ts (+84 lines)`, `Ran npm test: 14 passed, 0 failed`, active present-tense step in `active`), and the 3-line settled raw tail inside a round border titled `Raw output, last lines`.
- `TakeoverView`:
  - Renders the one-line `ask` banner `"You are typing into the agent's terminal. Press Ctrl+] to return."` and the `VirtualTerminal` viewport lines without the legacy `[NAVIGATION MODE]` banner.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-rail-zoom-takeover.test.tsx`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/components/TeamRail.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

1. Create `src/tui/components/TeamRail.tsx`:
   - Export `TeamMemberRow`, `TeamRailProps`, `deriveTeamMembers(snapshot: TelemetrySnapshot, pendingDecisionCount: number, isPaused: boolean): TeamMemberRow[]`, and `export const TeamRail: React.FC<TeamRailProps>`.
2. Create `src/tui/components/ZoomView.tsx`:
   - Export `ZoomViewProps`, `formatAgentStep(step: AgentStepItem, isLast: boolean): { text: string; tone: ThemeToken }`, and `export const ZoomView: React.FC<ZoomViewProps>`.
   - Collapse read step targets to at most 3 filenames (`"Read a, b and c"` or `"Read a, b, c and N more"`).
   - Slice the last 3 non-empty settled lines from `ptyLines` for the `Raw output, last lines` box.
3. Create `src/tui/components/TakeoverView.tsx`:
   - Export `TakeoverViewProps` (`{ lines: string[]; maxRows?: number; theme: ThemeConfig }`) and `export const TakeoverView: React.FC<TakeoverViewProps>`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-rail-zoom-takeover.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/TeamRail.tsx src/tui/components/ZoomView.tsx src/tui/components/TakeoverView.tsx tests/unit/tui-rail-zoom-takeover.test.tsx
git commit -m "feat(tui): add TeamRail, ZoomView with step grouping, and TakeoverView"
```

---

### Task 8: Composer & Slash Command Palette (`CommandPalette.tsx`, `Composer.tsx`)

**Wave:** 3  
**Depends on:** Task 1, Task 3  
**Files Touched:**
- Create: `src/tui/components/CommandPalette.tsx`
- Create: `src/tui/components/Composer.tsx`
- Test: `tests/unit/tui-composer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tui-composer.test.tsx` verifying:
- `Composer` renders the `›` prompt in `active` and the appropriate placeholder (`"Describe what you want built"` on first launch, `"Message the supervisor, or type / for commands"` in Chat, `"Press 1, 2 or 3, or answer in your own words"` when a 3-option `DecisionCard` is focused, `"Message the supervisor about this agent"` in Zoom).
- Soft-wrapping and literal `\` + `Enter` newline insertion grow the `Composer` up to at most 4 visible lines, then scroll internally.
- `CommandPalette` renders above the `Composer` when input starts with `/` (e.g. `/s` filters to `/spec`, `/` lists `/spec`, `/plan`, `/audit`, `/raw`, `/pause`, `/resume`, `/help`, `/quit`).

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `npx vitest run tests/unit/tui-composer.test.tsx`  
Expected: FAIL with module resolution error (`Cannot find module '../../src/tui/components/Composer.js'`).

- [ ] **Step 3: Write minimal implementation (Green)**

1. Create `src/tui/components/CommandPalette.tsx`:
   - Export `SlashCommandItem` (`{ command: string; description: string }`), `SLASH_COMMANDS`, `filterSlashCommands(query: string): SlashCommandItem[]`, and `export const CommandPalette: React.FC<CommandPaletteProps>`.
2. Create `src/tui/components/Composer.tsx`:
   - Export `ComposerProps` (`{ value: string; placeholder: string; maxWidth: number; isFocused: boolean; theme: ThemeConfig; glyphs: GlyphSet }`), helper `wrapComposerLines(value: string, width: number, maxVisibleLines?: number): string[]`, and `export const Composer: React.FC<ComposerProps>`.

- [ ] **Step 4: Run test to verify it passes (Green)**

Run: `npx vitest run tests/unit/tui-composer.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/CommandPalette.tsx src/tui/components/Composer.tsx tests/unit/tui-composer.test.tsx
git commit -m "feat(tui): add Composer with 4-line auto-grow and slash CommandPalette"
```

---

### Task 9: `App.tsx` Mode Router, Responsive Layout Shell, Overlay Wiring & Legacy View Cleanup

**Wave:** 4  
**Depends on:** Task 4, Task 5, Task 6, Task 7, Task 8  
**Files Touched:**
- Modify: `src/tui/App.tsx:1-290`
- Modify: `src/tui/index.ts:1-240`
- Modify: `src/index.ts:39-58`
- Delete: `src/tui/components/MainStatusView.tsx`
- Delete: `src/tui/components/LivePtyView.tsx`
- Delete: `tests/unit/live-pty-view.test.tsx`
- Modify: `tests/unit/tui-views.test.tsx`
- Modify: `tests/unit/tui-app.test.tsx`

- [ ] **Step 1: Write the failing tests**

Update `tests/unit/tui-app.test.tsx` and `tests/unit/tui-views.test.tsx` (removing the retired `MainStatusView` and legacy `HeaderBar`/`FooterBar` blocks from `tests/unit/tui-views.test.tsx` while keeping `SpecPlanView` and `AuditLogView` tests) to test all acceptance criteria from Section 13 of the UX spec:
- Launching `<App />` with no prior messages shows the empty chat (`"What do you want built? Describe it in your own words..."`), focused composer (`"Describe what you want built"`), and hides `TeamRail` until the first message or subagent dispatch.
- Typing a message containing `q`, `p`, `t`, `r`, and digits `1`–`4` in `CHAT` mode appends those characters to the Composer and submits them on `Enter` to `onWritePty` without triggering quit, pause, or mode switches.
- Decision card interaction:
  - When a `DecisionCard` is focused and the composer is empty, pressing `2` then `Enter` sends `'\x1b[B\r'` to `onWritePty`, collapses the card to `"You chose: ..."`, and removes the `1 needs you` header badge.
  - Typing non-digit characters into the composer while a `DecisionCard` is focused switches to free-form typing; backspacing to empty restores option 1 selection.
  - Pressing `Esc` defers the decision (`1 needs you` badge stays); pressing `End` (or submitting `/decide`) re-focuses the decision card.
- Mode transitions:
  - `Tab` enters `TEAM` mode, `↑`/`↓` selects an agent row, `Enter` enters `ZOOM` mode (`Team / <role>, Task N`), `Ctrl+R` opens the full raw output overlay, `Esc` returns to `CHAT` mode.
  - `Ctrl+T` (or `/raw`) enters `TAKEOVER` mode forwarding 100% of keystrokes to `onWritePty` until `Ctrl+]` (`\x1d`) returns to `CHAT` mode.
  - `/spec`, `/plan`, `/audit` open full-screen `SpecPlanView` and `AuditLogView` overlays (forwarding `ledger` to `AuditLogView`); `Esc` closes them without mutating narrator state.
  - `/pause` and `/resume` toggle the paused state.
  - Pressing `Ctrl+C` once shows `"Stop the team and quit? Press Ctrl+C again."` in `FooterBar`; pressing `Ctrl+C` a second time calls `onRequestQuit`.
- Responsive sizing:
  - At `120×36`, `TeamRail` is rendered side-by-side (`width={32}`).
  - At `80×24`, `TeamRail` is hidden in `CHAT` mode and opens as an overlay when `Tab` enters `TEAM` mode; pressing `Enter` on an agent closes the rail overlay so `ZoomView` gets full width.
  - Below `80×24` (e.g., `70×20`), `<App />` renders `"Make this window at least 80 columns by 24 rows."`

- [ ] **Step 2: Run tests to verify they fail (Red)**

Run: `npx vitest run tests/unit/tui-app.test.tsx tests/unit/tui-views.test.tsx`  
Expected: FAIL because `App.tsx` still uses the old 4-panel `NAVIGATION` / `PTY_INTERACT` implementation.

- [ ] **Step 3: Write minimal implementation (Green)**

1. Rewrite [`src/tui/App.tsx:1-290`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/App.tsx#L1-L290):
   - Accept `AppProps` including `ledger: SupervisorLedger` ([`src/core/types.ts:25-38`](file:///D:/Code/AntigravityMasterSupervisor/src/core/types.ts#L25-L38)):
     ```typescript
     export interface AppProps {
       snapshot: TelemetrySnapshot;
       ledger: SupervisorLedger;
       transcriptStore?: TranscriptStore;
       onWritePty: (data: string) => void;
       onRequestQuit: () => void;
       forceNavigationSignal?: number;
       dimensions?: { columns: number; rows: number };
       env?: NodeJS.ProcessEnv;
       colorLevel?: number;
     }
     ```
   - Read terminal dimensions from `dimensions ?? { columns: stdout?.columns ?? 120, rows: stdout?.rows ?? 36 }` and subscribe to `stdout.on('resize')`.
   - Pass `ledger` to `<AuditLogView ledger={ledger} scrollOffset={overlayScrollOffset} maxRows={bodyRows} />` when `activeOverlay === 'audit'`, and derive `status={ledger.status}`, `specApproved={ledger.checkpoints.spec.status === 'APPROVED'}`, and `planApproved={ledger.checkpoints.plan.status === 'APPROVED'}` for `HeaderBar`.
   - Implement the 4-mode keyboard state machine (`CHAT`, `TEAM`, `ZOOM`, `TAKEOVER`), `\` + `Enter` newline continuation in Composer, `PgUp`/`PgDn`/`End` transcript viewport scrolling, `DecisionCard` digit selection vs free-form typing rules (Section 6), and double `Ctrl+C` quit confirmation.
   - Render minimum-size guard when `columns < 80 || rows < 24`.
2. Update [`src/tui/index.ts:1-240`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts#L1-L240) and [`src/index.ts:39-58`](file:///D:/Code/AntigravityMasterSupervisor/src/index.ts#L39-L58):
   - Instantiate `TranscriptStore` inside `SupervisorTuiContainer` ([`src/tui/index.ts:66-111`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts#L66-L111)) wired to `options.store`, `options.parser`, `initialLedger: ledger`, `onWritePty`, `getPtyPid: () => options.ptyRunner.pid`, and `onRingBell: () => process.stdout.write('\x07')`.
   - Inside `SupervisorTuiContainer`'s ledger polling effect ([`src/tui/index.ts:82-96`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts#L82-L96)), invoke `transcriptStore.updateLedger(latestLedger)` whenever `loadLedger` returns an updated ledger.
   - Inside `mountSupervisorTui`'s `options.ptyRunner.onExit` handler ([`src/tui/index.ts:207-218`](file:///D:/Code/AntigravityMasterSupervisor/src/tui/index.ts#L207-L218)), invoke `transcriptStore.handlePtyExit(event.exitCode)` when `event.exitCode !== 0`.
   - Export `Transcript`, `TeamRail`, `Composer`, `CommandPalette`, `DelegationCard`, `DecisionCard`, `FailureCard`, `ZoomView`, `TakeoverView`, `TranscriptStore`, `reduceNarrator`, `resolveTheme`, and `resolveGlyphs` from `src/tui/index.ts` and `src/index.ts`.
   - Delete `src/tui/components/MainStatusView.tsx`, `src/tui/components/LivePtyView.tsx`, and `tests/unit/live-pty-view.test.tsx`.

- [ ] **Step 4: Run full test suite and typecheck to verify everything passes (Green)**

Run: `npx tsc --noEmit && npx vitest run`  
Expected: PASS with 0 TypeScript errors and all unit + integration test suites passing.

- [ ] **Step 5: Commit**

```bash
git rm src/tui/components/MainStatusView.tsx src/tui/components/LivePtyView.tsx tests/unit/live-pty-view.test.tsx
git add src/tui/App.tsx src/tui/index.ts src/index.ts tests/unit/tui-views.test.tsx tests/unit/tui-app.test.tsx
git commit -m "feat(tui): wire conversational App mode router, responsive layout, and overlays"
```
