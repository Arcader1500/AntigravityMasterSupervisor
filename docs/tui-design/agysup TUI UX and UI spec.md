# **agysup TUI: UX and UI spec**

For the coding agent implementing the redesign in D:/Code/AntigravityMasterSupervisor. Written 2026-10-19.

## **1\. Read this first**

**The problem.** The current TUI has four screens that mirror four internal modules (status, PTY, spec and plan, audit). The user's job is to state intent, answer the few questions that are really product decisions, and trust the team. The current design makes them assemble the story from a feed, a ledger and a terminal.

**The model.** One chat window. The user talks to one voice, the supervisor. When delegation starts, the team's work appears as a readable story inside that chat, with a narrow rail beside it showing who is doing what. Everything else is either one keystroke away or removed from the default view.

**Three rules that settle most questions:**

1. **Show outcomes, not mechanics.** "Ran npm test: 14 passed" beats run\_command npm test (Exit 0\). Tool calls, PIDs and ANSI never appear in the default view.  
2. **Interrupt only for decisions.** Anything that needs the user appears as a card in the chat, in the same place every time. No modals, no screen switching.  
3. **Never claim what the data cannot back.** If a number or sentence needs data we do not have yet (see section 10), omit the line. Do not invent it.

Keep TelemetryStore, TelemetryParser, WorkspacePoller, StateLedger and PtyRunner. This spec replaces the presentation layer in src/tui/ and adds a narration layer between the store and the UI.

## **2\. Layout**

The app is a column: header, body, composer, footer. The body is a row: transcript on the left, team rail on the right.

 agysup  feat/rate-limit   Spec ✓  Plan ✓  Build ▸ wave 2 of 3  Verify          06:42  
─────────────────────────────────────────────────────────────┬──────────────────────────  
 you         Add rate limiting to the public API: 100/min    │ Team  
             per key, Redis-backed.                          │ orchestrator    running  
 supervisor  You approved the spec at 06:12. The plan has   │ ├ implementer   Task 3  1m 12s  
             5 tasks in 3 waves, and the build is under way. │ ├ code-reviewer Task 2  approved  
 ✓ f4e5d6a   Task 2 committed: token bucket                  │ └ verifier      after Task 5  
 ╭─────────────────────────────────────────────────────────╮ │  
 │ ▸ Task 3: Route middleware                  wave 2 of 3 │ │ Tasks  
 │ The implementer is writing src/middleware/limiter.ts,   │ │ ✓ 1 Redis schema  
 │ 1m 12s in. 14 of 14 tests pass so far.                  │ │ ✓ 2 Token bucket  
 ╰─────────────────────────────────────────────────────────╯ │ ▸ 3 Route middleware  
 14 permission prompts approved for you. None needed you.    │   4 Integration tests  
─────────────────────────────────────────────────────────────┴──   5 Review and verify  
 › Message the supervisor, or type / for commands  
 Tab team   Enter open agent   / commands   Ctrl+T take over the terminal  
**Sizing rules**

* Minimum supported size is 80×24. Read size with Ink's useStdout and re-layout on resize.  
* Rail width is a fixed 32 columns at 110 columns or wider. Below 110 the rail is hidden and Tab toggles it as an overlay on the right. Pressing Enter on an agent in the overlay enters Zoom mode and closes the overlay so the Zoom view gets the full width; pressing Tab inside Zoom below 110 columns toggles the rail overlay back on.  
* Header, composer and footer are one line each (the composer grows to at most 4 lines, then scrolls). Enter always submits. The composer grows beyond one line either by soft-wrapping long input at the transcript width, or when the user types \\ followed by Enter to insert a literal newline.  
* All content is left-aligned. No centered or justified text.  
* Keep line length under 80 characters in the transcript. Cap the transcript text column at 76 and let extra width go to the rail gutter.  
* Speaker labels use a hanging indent: a fixed 12-column label box, then a text box with flexGrow. Wrapped lines align under the text, never under the label.

## **3\. Interaction modes**

Replace NAVIGATION and PTY\_INTERACT with four modes. The mode decides where keystrokes go, and the footer always shows the keys that work right now.

| Mode | How you enter | Keys go to | Leave with |
| :---- | :---- | :---- | :---- |
| Chat (default) | Launch, or Esc from anywhere | The composer | n/a |
| Team | Tab from Chat | The rail (↑ ↓ select, Enter zoom) | Tab or Esc |
| Zoom | Enter on an agent in Team mode | Zoom view scrolling, composer still works | Esc |
|  Takeover Ctrl+T from anywhere The PTY, 100% of keystrokes Ctrl+\]  | Ctrl+T, or T in Zoom | The PTY, 100% of keystrokes | Ctrl+\] |

Rules:

* In Chat mode printable keys always go to the composer. Do not bind bare letters (q, p, 1 to 4) in Chat mode. The old single-letter shortcuts are removed, because typing a message must never trigger an action. Exception: when a decision card is focused (section 6), 1 to 9 choose an option.  
* Ctrl+C once asks "Stop the team and quit? Press Ctrl+C again." in the footer. Twice shuts down as today (kill PTY, flush ledger to IDLE, unmount).  
* Ctrl+\] in Takeover mode keeps today's behavior: release the keyboard lock, never kill the child.  
* PgUp and PgDn scroll the transcript. The transcript auto-follows while it is at the bottom. If the user has scrolled up and something new needs them, show a pinned line above the composer: "1 needs you. Press End to jump to it."

**Slash commands** (typed in the composer, with a small autocomplete list above it):

| Command | Does |
| :---- | :---- |
| /spec | Full-screen spec viewer (reuse SpecPlanView). Esc closes. |
| /plan | Full-screen plan viewer (same component). |
| /audit | Full-screen audit ledger (reuse AuditLogView). |
| /raw | Same as Ctrl+T. |
| /pause and /resume | Pause or resume the team (today's \[P\]). |
| /help | Lists keys and commands in the transcript. |
| /quit | Same as double Ctrl+C. |

## **4\. Visual system**

This is a terminal. Typography is the user's terminal font, so the design lives in color, weight, spacing and a few glyphs.

**Palette.** Use truecolor hex through Ink's color prop. When chalk.level \< 3, map to the nearest ANSI 16-color value shown in the last column.

| Token | Hex | Used for | 16-color fallback |
| :---- | :---- | :---- | :---- |
| text | \#D5E2E6 | Body text | white |
| dim | \#84A0AD | Labels, timestamps, hints, pending items | gray |
| active | \#5CC8C0 | Running agents, current task, the supervisor's name, prompt glyph | cyan |
| done | \#8CCB8A | Completed tasks, commits, passing results | green |
| ask | \#FF8FA2 | **Only** things that need the user | magenta (bright) |
| line | \#2C4A5E | Card borders and dividers | blue (dim) |

Do not set a background color. Respect the user's terminal background. These colors are chosen to pass roughly 4.5:1 on dark backgrounds. On a light terminal background (detect with COLORFGBG if present) swap text and dim for the terminal default and dim attribute.

**Monochrome fallback (NO\_COLOR or chalk.level \=== 0):** Strip all hex and ANSI colors. To preserve the ask distinction without color, render the header badge with inverse video (inverse prop in Ink) and prefix the top border title of DecisionCard and FailureCard with \[\!\] .

**The one loud color.** ask is the only attention color. If anything uses it that is not waiting on the user, that is a bug. Blocked tasks, crashes and decisions all need the user, so they all use ask.

**Weight.** Bold is used for exactly three things: the agysup wordmark, the active task title on a delegation card, and the headline of a decision card. Nothing else is bold. No all-caps labels, no underline, no italics.

**Borders.** Use Ink's round border style. A bordered box means "this is a live thing you can act on or that is changing". Plain text lines mean "this happened". So: the current delegation card and decision cards are bordered, and everything finished collapses to a plain line. Dividers between regions use a single-line rule in line.

**Glyphs.** ✓ done, ▸ running, ❚❚ paused, › composer prompt, ├ └ tree. No emoji anywhere. When AGYSUP\_ASCII=1, or on a legacy Windows console without Unicode support, fall back to \[x\], \>, ||, \> and |- \`-. Put the glyph map in one module (src/tui/glyphs.ts) and never inline glyphs in components.

**Motion.** One moving thing only: the ▸ of the active delegation card cycles through a 4-frame spinner at 250ms. Nothing else animates. The \[WAITING FOR INPUT\] flashing badge is removed. Respect NO\_MOTION=1 by showing a static ▸.

**Copy rules.** Sentence case. Plain verbs. Say what is happening in the user's terms ("The implementer is writing..."), not the system's ("Subagent dispatched"). Errors say what happened and what to do next, and never apologize. Keep one name per action everywhere: if the footer says "take over the terminal", the command is /raw, the doc says "take over".

## **5\. The transcript**

The transcript is a list of typed items. The UI renders items. A new module, the **narrator** (src/tui/narrator.ts), turns telemetry into items. The narrator is a pure function from (previous items, telemetry event) to next items, so it can be unit tested with recorded streams.

**Viewport scrolling:** Because the body is a side-by-side split with the Team rail, do not rely on native terminal scrollback. Transcript.tsx maintains a scroll offset (in lines or items from the bottom) within a fixed-height Ink \<Box overflow="hidden"\> sized to rows \- header \- composer \- footer. PgUp and PgDn adjust this offset by half a screen height; End resets offset to 0 and re-engages auto-follow.

| Item | Rendered as | Updates in place? |
| :---- | :---- | :---- |
| UserMessage | you label (dim), text | No |
| SupervisorNote | supervisor label (active), text | No |
| PhaseChange | One SupervisorNote line, e.g. "Spec approved. Planning the tasks." | No |
| DelegationCard | Bordered card (section 5.1) | Yes while running, then collapses to a line |
| CommitLine | ✓ f4e5d6a   Task 2 committed: token bucket in done | No |
| DecisionCard | Bordered ask card (section 6\) | Yes until answered, then collapses to a line recording the answer |
| QuietCounter | One dim line, e.g. "14 permission prompts approved for you. None needed you." | Yes, always the last line above the active card |
| Failure | Bordered ask card with what failed and the options (section 5.3) | No |

**Event-to-item mapping**

| Telemetry event | Narrator does |
| :---- | :---- |
| First user line sent to the PTY | Append UserMessage |
| Subagent dispatch parsed | Create or update a DelegationCard for the current task |
| Tool call or command parsed | Update the live card's "now" line. Do **not** append an item |
| Subagent completion marker DONE | Collapse card to "✓ Task N: title" and record elapsed time |
| DONE\_WITH\_CONCERNS | Collapse with a dim second line: "Finished with concerns. Reviewer will check." |
| NEEDS\_CONTEXT or BLOCKED | Turn the card into a Failure card (section 5.3) |
| New commit SHA from poller | Append CommitLine |
| Checkpoint state change in the ledger | Append PhaseChange |
| Interactive prompt parsed (ask\_question or ctrl+k) | Append DecisionCard (section 6\) and ring the bell once |
| Everything else (spinner frames, duplicate lines, ConPTY warnings) | Drop. These stay available in /audit and /raw |

### **5.1 Delegation card**

One card per running task. Content:

╭──────────────────────────────────────────────────────────╮  
│ ▸ Task 3: Route middleware                   wave 2 of 3 │  
│ The implementer is writing src/middleware/limiter.ts,    │  
│ 1m 12s in.                                               │  
│ 14 of 14 tests pass so far. Review and verification     │  
│ come after this.                                         │  
╰──────────────────────────────────────────────────────────╯

* Line 1: spinner glyph, task number and title (bold), and wave N of M in dim, right-aligned. If the plan has no wave headings, show task N of M instead.  
* Line 2: the **now** sentence, built from the latest event: "The \<role\> is \<verb\> \<object\>, \<elapsed\> in." Verbs: reading, writing, running tests, running the typecheck, reviewing, verifying. Elapsed is the existing subagent task stopwatch.  
* Line 3 (optional): the latest test result, only when a test command with an exit code was parsed: "14 of 14 tests pass so far." or "2 tests failing, the implementer is fixing them." Omit the line if counts are not parsed.  
* Line 4 (optional): what comes next, derived from the plan order.  
* Parallel tasks in one wave: one card each, at most 3 shown. The rest collapse into "+2 more running" which opens the Team rail.  
* When the task finishes, the card is replaced by a plain done line with the commit SHA if known. Only active work is bordered.

### **5.2 Team rail**

Two blocks, both plain text.

Team  
orchestrator    running  
├ implementer   Task 3  1m 12s  
├ code-reviewer Task 2  approved  
└ verifier      after Task 5

Tasks  
✓ 1 Redis schema  
✓ 2 Token bucket  
▸ 3 Route middleware  
  4 Integration tests  
  5 Review and verify

* **Team** lists the main agent, then the subagents that have been dispatched or are queued. Status words: running, waiting, idle, approved, after Task N, paused, needs you (in ask). Task numbers here are a real sequence from the plan.  
* **Tasks** comes from the plan parser (task headings and checklist progress). Truncate titles with an ellipsis at the rail width.  
* In the Planning phase the rail shows planner, researcher and plan-critic in Team and the Tasks block says "Tasks appear once the plan is approved."  
* In Team mode the selected row gets an inverse active highlight and Enter zooms it.  
* Add a third block when there is something to say, and only then: **Handled for you** with counts such as "22 permission prompts approved" (section 10 says when this is real).

### **5.3 Failure card**

Used for BLOCKED, NEEDS\_CONTEXT, repeated verification failures, and a PTY that exits non-zero. It says what happened and offers actions, in the same card shape as a decision:

╭──────────────────────────────────────────────────────────╮  
│ Task 4 is blocked                                        │  
│ The implementer cannot reach Redis for the integration   │  
│ tests: connection refused on localhost:6379.             │  
│                                                          │  
│ 1  Retry the task                                        │  
│ 2  Skip it and continue the wave                         │  
│ 3  Take over the terminal                                │  
╰──────────────────────────────────────────────────────────╯  
The reason line is the last meaningful error line the parser saw, quoted from the stream. If no reason was parsed, say "The implementer reported it is blocked and did not say why. Open the agent to read its last output." Options 1 and 2 send the corresponding instruction to the orchestrator PTY. Option 3 enters Takeover mode.

## **6\. Decision cards: the interrupt model**

This is the most important UX piece. When the team needs the user, the supervisor asks in the transcript.

╭──────────────────────────────────────────────────────────╮  
│ The supervisor needs a product decision                  │  
│ When a key goes over its limit, what should the API      │  
│ return? Your spec does not say, and 3 of the Task 4      │  
│ tests depend on it.                                      │  
│ I checked first: docs/api.md has no rule, and the other  │  
│ endpoints return a 4xx with a JSON error body.           │  
│                                                          │  
│ 1  429 with a Retry-After header (recommended)           │  
│ 2  429 with no header                                    │  
│ 3  Something else, I will explain below                  │  
╰──────────────────────────────────────────────────────────╯  
**Behavior**

* The card is bordered in ask. Headline is bold. Options are numbered, since the choice is a list, and the recommended option, if any, is marked "(recommended)" and listed first.  
* The footer changes to 1 2 3 choose   Enter send   Esc ask me later, the team stays paused.  
* 1 to 9 choose an option when the card is focused. The composer placeholder becomes "Press 1, 2 or 3, or answer in your own words". Typing text and pressing Enter sends a free-form answer.  
* **Selection vs. free-form typing.** When a decision card is focused and the composer is empty, pressing 1 to 9 (or ↑ and ↓) selects that numbered option on the card without submitting, and Enter sends the selected option. Option 1 is selected by default. If the user types any non-digit character, or types a digit after the composer already contains text, the card selection clears and keystrokes go into the composer as a free-form answer; Enter then sends the composer text. Backspace to an empty composer restores option 1 selection.  
* The header shows a badge, 1 needs you, with ask as background and dark text. With several pending, it shows the count. The badge is the only header element that changes color.  
* Ring the terminal bell (\\x07) once per new decision, never repeating.  
* Pending decisions queue. Only the oldest is focused. Others show as a one-line stub, "+1 more waiting".  
* Esc defers the decision: card focus clears and keystrokes go purely to the composer as normal Chat mode. The 1 needs you header badge stays. While a decision is deferred, pressing End (or typing /decide) from Chat mode jumps to the card and re-focuses it.  
* After an answer, the card collapses to a plain line: "You chose: 429 with a Retry-After header." The team rail goes back to running.

**What produces a decision card**

1. A parsed ask\_question menu from the planner or orchestrator. The question text and options come from the parsed menu. The "I checked first" line appears only when the Milestone 3 reasoner supplies it.  
2. A ctrl+k permission prompt. Card headline: "The implementer wants to run a command." Show the exact command in text. Options: 1 Allow, 2 Don't allow. Until the jev classifier exists, every permission prompt reaches the user. When it exists, only prompts it classifies as risky do.  
3. Checkpoint 1 (spec review), when Milestone 3 gates it: headline "The spec is ready for your review", options 1 Approve, 2 Open the spec (runs /spec), 3 Ask for changes.  
4. Failure cards (section 5.3).

Answering writes keystrokes to the PTY. For menus, send ↓ N times then Enter. For permission prompts, Allow sends \\x0b (the existing ctrl+k). See section 10 for the assumption this relies on.

## **7\. Zoom view**

Tab, select an agent, Enter. The transcript area is replaced by a detail view of one agent. The rail, composer and footer stay.

 agysup  feat/rate-limit   Team / implementer, Task 3                       06:42  
─────────────────────────────────────────────────────────────┬──────────────────────────  
 ╭────────────────────────────────────────────────────────╮  │ (rail, agent highlighted)  
 │ ▸ Route middleware                                     │  │  
 │ Started 1m 12s ago. Four steps so far, nothing failed. │  │ Task 3 checklist from the plan  
 ╰────────────────────────────────────────────────────────╯  │ ✓ Write the failing test  
 18:42:10  Read auth.ts, config.ts and limiter.test.ts       │ ✓ Implement the middleware  
 18:42:51  Wrote src/middleware/limiter.ts (+84 lines)       │ ▸ Pass the typecheck  
 18:43:05  Ran npm test: 14 passed, 0 failed                 │   Report to the orchestrator  
 18:43:22  Running the typecheck                             │  
 ╭ Raw output, last lines ────────────────────────────────╮  │  
 │ \$ tsc \--noEmit \-p tsconfig.json                        │  │  
 ╰────────────────────────────────────────────────────────╯  │  
 Esc back to the conversation   Ctrl+R full raw output   Ctrl+T take over this terminal  
**Step grouping rules**

* Collapse consecutive reads into one line: "Read a, b and c" (show at most 3 names, then "and N more").  
* A write or edit is one line: "Wrote \<path\>" with "(+N lines)" only if the diff size is known. Do not guess.  
* A command is one line: "Ran \<command\>: \<outcome\>". Outcome comes from the exit code: 0 is "ok" unless a test summary was parsed, in which case use it ("14 passed, 0 failed"). Non-zero is "failed (exit N)" in ask only if the agent did not recover by the next step, otherwise dim.  
* MCP tool calls show as "Looked up \<symbol or query\> in the code graph".  
* The last step is in active with a present-tense verb and no outcome.  
* Show the last 4 to 8 steps that fit. ↑ and ↓ scroll further back.  
* The raw tail is the last 3 settled lines from the virtual terminal for that agent, in dim, inside a titled round border. Ctrl+R (or /raw) expands it to the full-screen raw view; Esc returns. Printable keys in Zoom mode always go to the composer.  
* The checklist block in the rail is that task's checkbox items from the plan file.

The composer in Zoom mode still sends to the supervisor, and the placeholder says "Message the supervisor about this agent".

## **8\. Overlays and the raw terminal**

* /spec, /plan and /audit open the existing viewer components full-screen over the body. The header and footer remain. Esc closes.  
* Takeover mode renders the existing LivePtyView body with a one-line banner in ask: "You are typing into the agent's terminal. Press Ctrl+\] to return." The footer shows only that. Because the user is in the raw terminal, the transcript is not visible and the team is not paused.  
* Both overlays and Takeover must not change the narrator's state. The narrator keeps consuming events while hidden.

## **9\. States**

**First launch (empty).** The transcript shows one supervisor note and nothing else:

*What do you want built? Describe it in your own words. I will ask you only about decisions the repo cannot answer.*

The rail is hidden until the first agent starts. The composer is focused with the placeholder "Describe what you want built". The first message is written to the planner PTY as the request.

**Planning.** Phase strip shows Spec ▸. Delegation cards describe the planner and researcher ("The researcher is looking through the codebase for the auth setup"). Decision cards come from the planner's interview.

**Context reset between phases.** When the planner PTY is torn down and the orchestrator starts, append one note: "The plan is approved. I started a fresh orchestrator so it has the full context window. The planning conversation is not carried over." This explains the visual break and is the project's key design choice, so say it plainly.

**Waiting on the user.** Header badge, bell, decision card, rail row paused, needs you. Nothing else changes.

**Paused by the user.** Header shows Paused in ask. The footer shows /resume as the first hint.

**Complete.** Replace the active card with a summary card in done: branch name, number of tasks and commits, verifier result, total elapsed. Next steps are one plain line: "Review the branch, then merge when you are ready." Header status becomes Done.

**Agent crashed or the PTY exited non-zero.** A Failure card with the last error line and the options retry, take over, quit.

**Terminal too small.** Below 80×24 show a single line: "Make this window at least 80 columns by 24 rows." Do not render a broken layout.

## **10\. Assumptions to verify before relying on them**

The design assumes some things the current code may not provide. Verify each, and where it fails, apply the fallback. Do not fake the data.

1. **The composer writes to the active main agent's PTY.** Until the Milestone 3 supervisor reasoner exists, "message the supervisor" really means "type to the planner or orchestrator." That is fine, but the supervisor voice in the transcript is generated by the narrator from templates, not by an LLM. Keep the templates in one file (src/tui/narrator-copy.ts) so Milestone 3 can swap in model-written notes.  
2. **Answering ask\_question menus by keystrokes.** Confirm how agy menus respond to ↓ and Enter through ConPTY. If it is unreliable, the decision card still shows the question and options, but option selection opens Takeover mode with a note on which option to pick.  
3. **Subagent output is interleaved in the main agent's stream.** There is one PTY per phase, so zooming into a subagent means filtering the stream between its dispatch marker and completion marker. If a segment cannot be isolated, Zoom shows the main agent's recent steps and says so in its first line.  
4. **Wave numbers.** Only show wave N of M if the plan parser finds wave headings. Otherwise task N of M.  
5. **Counts like "9 of 11 questions answered" and "14 permission prompts approved"** need the Milestone 3 reasoner and jev. Until those exist, hide the QuietCounter and the Handled for you block entirely.  
6. **Test counts and diff sizes** require parsing test-runner output. Support vitest and jest summary lines first. If no summary is parsed, omit the line.  
7. **Narration of intent** ("is writing", "is running the typecheck") derives from tool call names and file paths. Keep a small lookup table of tool name to verb, and fall back to "is working" for unknown tools.

## **11\. Where things go in the codebase**

| Action | File |
| :---- | :---- |
| Rewrite | src/tui/App.tsx: new mode router (Chat, Team, Zoom, Takeover), layout shell, resize handling |
| Rework | HeaderBar.tsx (wordmark, branch, phase strip, badge, one timer), FooterBar.tsx (context-sensitive hints only, no tab pills) |
| Replace | MainStatusView.tsx becomes Transcript.tsx plus TeamRail.tsx |
| New components | Composer.tsx, DelegationCard.tsx, DecisionCard.tsx, FailureCard.tsx, ZoomView.tsx, CommandPalette.tsx |
| Rename and trim | LivePtyView.tsx to TakeoverView.tsx: keep terminal rendering, drop the old status banner |
| Keep as overlays | SpecPlanView.tsx, AuditLogView.tsx, opened by /spec, /plan, /audit |
| New | src/tui/narrator.ts, narrator-copy.ts, transcript-store.ts, glyphs.ts, theme.ts |
| Extend | TelemetryParser: emit test summaries, last error line, and per-agent step lists. WorkspacePoller: parse wave headings and per-task checklists |
| Untouched | StateLedger, PtyRunner, VirtualTerminal, discovery.ts, raw passthrough (\--no-tui) |

**Removed from the default view:** the four-tab navigation, PID, session UUID, last command and exit code as a standalone field, the raw activity feed with \[IMPL\]\-style tags, total wall-clock as a separate stat, the flashing waiting badge, and the 1 to 4 number shortcuts.

## **12\. Build order**

1. **Narrator and transcript model, no UI.** Types for every item, the event mapping in section 5, and unit tests that replay recorded PTY streams and assert the item list.  
2. **Layout shell.** Header, body split, composer, footer, resize behavior, theme and glyph modules, with ink-testing-library snapshots at 80×24 and 120×36.  
3. **Transcript and delegation card**, including collapse-on-finish and the spinner.  
4. **Composer and mode router**, including Esc and Tab behavior and Ctrl+C confirmation.  
5. **Decision and failure cards**, keystroke injection, bell, header badge, deferral, queueing.  
6. **Team rail** with real plan data.  
7. **Zoom view** with step grouping.  
8. **Slash commands and overlays**, then Takeover.  
9. **Empty, paused, complete and too-small states**, then the ASCII fallback.

## **13\. Acceptance checks**

* Launch with no arguments: the user sees an empty chat and a focused composer, and can type a request without learning any shortcut.  
* During a run, the user can answer "what is the team doing right now, and what is left?" from the first screen without pressing any key.  
* No default view ever shows a PID, UUID, raw tool call or ANSI sequence.  
* A permission prompt or ask\_question produces exactly one decision card, one bell, and one header badge, and answering it removes the badge.  
* Typing a message containing the letters q, p, t and the digits 1 to 4 in Chat mode sends them as text and triggers nothing.  
* ask color appears only on items that are waiting on the user.  
* Resizing from 120 to 80 columns hides the rail without losing transcript content.  
* NO\_COLOR, AGYSUP\_ASCII=1 and NO\_MOTION=1 each produce a usable screen.  
* The narrator's unit tests cover every row of the section 5 mapping table.