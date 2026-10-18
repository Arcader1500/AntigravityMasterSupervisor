# Antigravity (`agy`) Master Supervisor — High-Level Architecture

## 1. Project Brief & Objective

### The Goal
Build a **Master Supervisor TUI (Terminal User Interface)** that acts as an autonomous proxy for the human developer on top of an existing, Git-tracked Antigravity (`agy`) CLI multi-agent plugin.

The system must take a software development request from initial requirements to a verified, committed development branch with minimal human intervention—autonomously answering routine technical questions, enforcing a strict **Spec $\rightarrow$ Plan** gate, brokering CLI permission prompts (`ctrl+k`), and escalating only genuine product decisions, architectural trade-offs, or high-risk operations to the user.

### The Existing Setup (Baseline Plugin)
The underlying `agy` environment is already packaged as a tracked plugin with a strict two-level hierarchy:
* **Main Agents (`mainAgent: true`):**
  * **`planner`:** Uses `grilling` and `writing-plans` skills. Delegates discovery to `researcher` (read-only) and adversarial review to `plan-critic`. *(Planned upgrade: Split output into a hard **Spec Checkpoint** before running `writing-plans` and `plan-critic`.)*
  * **`orchestrator`:** Uses `subagent-driven-development` and `finishing-a-development-branch`. Delegates implementation waves to `implementer`, review to `code-reviewer`, and test validation to `verifier`. Holds a monopoly on `git commit`.
* **Global Context & Permissions:**
  * Every agent inherits `GEMINI.md`, workspace rules (`config/rules/*.md`), and MCP servers (`code-review-graph`, `context7`, `daas-cd`, `sequential-thinking`, `undermind`).
  * `git commit`, `pytest`, `python`, `uv`, `npm` are allowed for autonomous execution; destructive commands (`rm`, `Remove-Item`) trigger interactive `ASK` (`ctrl+k`) prompts; `.env*` access is hard-blocked (`DENY`). Pull Request creation / merging remains gated.

---

## 2. High-Level System Architecture Diagram

```mermaid
flowchart TB
    %% ─────────────────────────────────────────────────────────────
    %% LAYER 1: HUMAN & TUI PRESENTATION LAYER
    %% ─────────────────────────────────────────────────────────────
    subgraph TUI_APP["🖥️ Python Master Supervisor TUI (Textual App — Long-Running Process)"]
        direction TB
        
        subgraph UI_VIEWS["Clean Multi-View / Panel TUI Layout"]
            MAIN_VIEW["📊 Main Telemetry & Activity Screen (Default View)<br/>• Active Phase, Subagent & Current Tool/Action<br/>• Elapsed Time (Total, Phase, Current Subagent)<br/>• Task Wave Progress & Git Commit Feed<br/>• Clean Activity Stream (Parsed Updates, not raw ANSI)"]
            
            SUB_PANELS["🗂️ Switchable Panels / Modals (Hotkey-Driven)<br/>• [T] Full-Screen Live PTY Terminal (Inspect / Manual Override)<br/>• [S] Spec & Plan Markdown Viewer<br/>• [A] Supervisor & JEV Decision Audit Log<br/>• [E] Escalation Modal (Pops up only when Human needed)"]
        end

        PARSER["🔍 Stream Parser & Telemetry Extractor<br/>(Extracts active subagent, tool calls, file edits, & timers from PTY)"]
        STATE_MGR["⚙️ Lifecycle State Machine & Watchdog<br/>(Tracks stalls, retries, phase handoffs)"]
        PTY_CTRL["🔌 PTY Process Controller (`pywinpty` / `pexpect`)<br/>(Runs `agy` in background virtual terminal)"]
        
        MAIN_VIEW <--> STATE_MGR
        SUB_PANELS <--> STATE_MGR
        STATE_MGR <--> PARSER
        PARSER <--> PTY_CTRL
    end

    %% ─────────────────────────────────────────────────────────────
    %% LAYER 2: PERSISTENT WORKSPACE LEDGER
    %% ─────────────────────────────────────────────────────────────
    subgraph DISK["💾 Workspace Persistence (`.agy/` & `docs/plans/`)"]
        LEDGER[("📄 .agy/supervisor_state.json<br/>• Original Requirements<br/>• Grilling Q&A / Assumptions<br/>• Task Progress, Timings & Retries<br/>• Permission Audit Trail")]
        SPEC_DOC[("📐 docs/plans/*-spec.md<br/>(Checkpoint 1 Artifact)")]
        PLAN_DOC[("📝 docs/plans/*-plan.md<br/>(Checkpoint 2 Artifact)")]
    end

    STATE_MGR <--> LEDGER

    %% ─────────────────────────────────────────────────────────────
    %% LAYER 3: DECISION & INTELLIGENCE ENGINES
    %% ─────────────────────────────────────────────────────────────
    subgraph BRAINS["🧠 Two-Tier Supervisor Intelligence"]
        direction LR
        JEV["⚡ Fast Reflex Classifier (`jev` model)<br/>• Sub-200ms latency<br/>• Detects PTY state (Idle / Question / ASK prompt)<br/>• Evaluates `ASK` commands -> APPROVE (`ctrl+k`) or ESCALATE"]
        
        SUP_AGENT["🎓 Deep Reasoning Brain (`agy --agent supervisor`)<br/>• Uses existing `agy` quota & MCP (`code-review-graph`)<br/>• Invoked on-demand (Event-Driven)<br/>• Answers routine Grilling Qs from repo context<br/>• Audits Spec & Plan against requirements"]
    end

    PTY_CTRL -- "Terminal tail on pause" --> JEV
    JEV -- "Keystroke (`ctrl+k` / `n`) or State Trigger" --> PTY_CTRL
    STATE_MGR -- "On-demand CLI/Headless call" --> SUP_AGENT
    SUP_AGENT -. "Reads repo + ledger" .-> LEDGER

    %% ─────────────────────────────────────────────────────────────
    %% LAYER 4: EXISTING ANTIGRAVITY PLUGIN HIERARCHY
    %% ─────────────────────────────────────────────────────────────
    subgraph AGY_RUNTIME["🤖 Existing Antigravity (`agy`) Plugin Agents (Unchanged Core)"]
        direction TB
        
        subgraph PHASE_1["PTY Session 1: Planning (`agy --agent planner`)"]
            PLAN["planner (mainAgent)<br/>1. Grilling -> Writes Spec<br/>🛑 PAUSE (Checkpoint 1)<br/>2. writing-plans -> Writes Plan<br/>3. Loops with plan-critic"]
            RES["researcher (subagent)"]
            CRIT["plan-critic (subagent)"]
            PLAN --> RES
            PLAN --> CRIT
        end

        subgraph PHASE_2["PTY Session 2: Execution (`agy --agent orchestrator`)"]
            ORCH["orchestrator (mainAgent)<br/>• Wave dispatch<br/>• Runs `git commit` per wave<br/>• Halts before PR/Merge"]
            IMPL["implementer (subagent)"]
            CREV["code-reviewer (subagent)"]
            VER["verifier (subagent)"]
            ORCH --> IMPL
            ORCH --> CREV
            ORCH --> VER
        end
    end

    PTY_CTRL == "1. Spawns & pipes Q&A" ==> PLAN
    PLAN -. "Writes" .-> SPEC_DOC
    PLAN -. "Writes" .-> PLAN_DOC
    PTY_CTRL == "2. Terminates Planner & Spawns Orchestrator" ==> ORCH
    PLAN_DOC -. "Fed into" .-> ORCH

    %% ─────────────────────────────────────────────────────────────
    %% OPEN DESIGN DECISIONS (ANNOTATED IN ARCHITECTURE)
    %% ─────────────────────────────────────────────────────────────
    subgraph OPEN_DECISIONS["❓ Open Design Decisions (To Be Finalized)"]
        OD1["[OD-1] PTY Stream Detection:<br/>Pure `jev` classification vs. Regex/Sentinel tokens<br/>for detecting when `planner` finishes speaking?"]
        OD2["[OD-2] Spec Checkpoint Authority:<br/>Always pause for Human sign-off on `spec.md`,<br/>or allow `supervisor.md` to auto-approve routine specs?"]
        OD3["[OD-3] `supervisor.md` Context Strategy:<br/>Stateless single-turn calls (fed `supervisor_state.json`)<br/>vs. `--resume` persistent session?"]
        OD4["[OD-4] Blocked Task Recovery:<br/>When `implementer` returns `BLOCKED` or fails 3x,<br/>can Supervisor amend `plan.md` or must it re-invoke `planner`?"]
    end

    JEV --- OD1
    SPEC_DOC --- OD2
    SUP_AGENT --- OD3
    ORCH --- OD4

    classDef tui fill:#1a365d,stroke:#63b3ed,color:#fff
    classDef brain fill:#22543d,stroke:#68d391,color:#fff
    classDef agy fill:#322659,stroke:#b794f4,color:#fff
    classDef disk fill:#2d3748,stroke:#cbd5e0,color:#fff
    classDef open fill:#742a2a,stroke:#fc8181,color:#fff,stroke-dasharray: 5 5

    class MAIN_VIEW,SUB_PANELS,PARSER,STATE_MGR,PTY_CTRL tui
    class JEV,SUP_AGENT brain
    class PLAN,RES,CRIT,ORCH,IMPL,CREV,VER agy
    class LEDGER,SPEC_DOC,PLAN_DOC disk
    class OD1,OD2,OD3,OD4 open
```

---

## 3. TUI Layout & Telemetry Architecture

Instead of cramming raw terminal output and multiple small panes onto one screen, the TUI uses a **Clean Main Telemetry Screen** with **Hotkey-Switched Panels / Modals**.

### Main Screen (Default View)
Focuses purely on **what is running right now, how long it has been running, and high-level progress** extracted from the background PTY session and Git workspace:

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ 🚀 AGY SUPERVISOR │ Branch: feat/rate-limit │ Total Elapsed: 06m 42s │ Status: 🟢 RUN │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ⚡ CURRENTLY RUNNING                                                                 │
│   Main Agent : orchestrator (PID 18492)             Phase Elapsed : 04m 15s          │
│   Subagent   : implementer (Wave 2 — Task 3/5)      Task Elapsed  : 01m 12s          │
│   Last Action: edit_file -> src/middleware/limiter.py                                │
│   Last Cmd   : pytest tests/unit/test_limiter.py (Exit 0 — 4 passed)                 │
├──────────────────────────────────────────┬───────────────────────────────────────────┤
│ 📋 PIPELINE & TASK PROGRESS              │ 📡 CLEAN ACTIVITY FEED (Parsed from PTY)  │
│                                          │                                           │
│ [✓] Phase 1A: Spec Approved   (01m 10s)  │ 14:28:10 [ORCH] Dispatched implementer    │
│ [✓] Phase 1B: Plan & Critic   (01m 17s)  │ 14:28:24 [IMPL] Read src/auth/routes.py   │
│ [▶] Phase 2 : Orchestrator    (04m 15s)  │ 14:28:51 [IMPL] Edited limiter.py (+42/-5)│
│     [✓] Task 1: Redis schema  (a1b2c3d)  │ 14:29:05 [IMPL] Ran pytest (4 passed)     │
│     [✓] Task 2: Token bucket  (f4e5d6a)  │ 14:29:18 [JEV]  Auto-approved `rm tmp.db` │
│     [▶] Task 3: Route middleware         │ 14:29:22 [IMPL] Running ruff check...     │
│     [ ] Task 4: Integration tests        │                                           │
│     [ ] Task 5: Code Review & Verify     │                                           │
├──────────────────────────────────────────┴───────────────────────────────────────────┤
│ [1] Main Status  [2] Live PTY Terminal  [3] Spec & Plan  [4] Audit Log  [P] Pause    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### What the Python PTY Stream Parser Extracts Automatically
By reading the virtual terminal buffer (`pyte`) and polling lightweight workspace state, the Python controller extracts structured telemetry without needing extra LLM calls:
1. **Active Agent & Subagent Detection:** Matches `invoke_subagent` calls and `SYSTEM_MESSAGE: DONE / BLOCKED` markers in the PTY stream to know exactly which subagent (`researcher`, `plan-critic`, `implementer`, `code-reviewer`, `verifier`) is active.
2. **Execution Timers:** Tracks wall-clock time for the overall run, current lifecycle phase, and active subagent turn (resetting the stall watchdog whenever new bytes arrive from the PTY).
3. **Current Tool / File Touch Tracking:** Parses tool call headers (`edit_file`, `write_to_file`, `run_command`, MCP calls) from the `agy` output stream to show the exact file or command currently being processed.
4. **Git & Workspace Polling:** Watches `git status --short` and `git log -1` after each wave to link completed tasks to actual commit SHAs and changed file counts.

### Switchable Panels & On-Demand Modals
* **`[1]` Main Status Screen:** The clean telemetry view above.
* **`[2]` Live PTY Terminal Panel:** Full-screen interactive view of the underlying `agy` session. You can watch the raw output or press `i` to type directly into `agy` if you want to intervene manually.
* **`[3]` Spec & Plan Reader:** Renders the current `docs/plans/*-spec.md` and `*-plan.md` in a scrollable Markdown viewer.
* **`[4]` Supervisor & `jev` Audit Log:** Detailed table of every grilling question answered by `supervisor.md`, assumptions logged, and `ctrl+k` permissions approved by `jev`.
* **🚨 Auto-Popup Escalation Modal:** Whenever human input is required (a product question during Grilling, Spec sign-off at Checkpoint 1, or a dangerous command), a modal dialog pops up over the screen and rings the terminal bell so you never have to hunt for prompts.

---

## 4. End-to-End Lifecycle & Two-Checkpoint State Machine

This sequence illustrates how the **TUI**, **`jev`**, **`supervisor.md`**, and the **native `agy` agents** interact across the new **Spec Checkpoint** and **Plan Checkpoint**:

```mermaid
stateDiagram-v2
    [*] --> Idle: User enters Requirements in TUI

    state "Phase 1A: Discovery & Spec (PTY #1: planner)" as P1A {
        Idle --> Grilling: Spawn `agy --agent planner`
        Grilling --> ClassifyQuestions: `jev` detects Planner waiting for input
        ClassifyQuestions --> AutoAnswer: Routine / Repo-convention Qs (`supervisor.md`)
        ClassifyQuestions --> HumanEscalate: Product / Security / Ambiguous Qs (TUI Modal Popup)
        AutoAnswer --> Grilling: Inject answers into PTY #1
        HumanEscalate --> Grilling: Inject user answers into PTY #1
        Grilling --> SpecWritten: Planner writes `docs/plans/*-spec.md`
    }

    state "🛑 CHECKPOINT 1: Spec Review" as CP1 {
        SpecWritten --> SpecEvaluation: Supervisor &/or Human reviews `spec.md` [OD-2]
        SpecEvaluation --> Grilling: Revisions requested (injected into PTY #1)
        SpecEvaluation --> SpecApproved: Spec locked in `.agy/supervisor_state.json`
    }

    state "Phase 1B: Task Planning (PTY #1: planner)" as P1B {
        SpecApproved --> WritingPlans: Instruct PTY #1 to run `writing-plans` + `plan-critic`
        WritingPlans --> CriticLoop: Planner <-> `plan-critic` delta checks
        CriticLoop --> PlanReady: `plan-critic` outputs READY (`*-plan.md` written)
    }

    state "🛑 CHECKPOINT 2: Autonomous Plan Audit" as CP2 {
        PlanReady --> PlanAudit: `supervisor.md` verifies `plan.md` matches `spec.md`
        PlanAudit --> WritingPlans: Scope creep or missing requirement detected
        PlanAudit --> PlanApproved: Kill PTY #1 (frees 100% planning context)
    }

    state "Phase 2: Execution & Verification (PTY #2: orchestrator)" as P2 {
        PlanApproved --> WaveDispatch: Spawn `agy --agent orchestrator` with `plan.md`
        WaveDispatch --> PermissionBroker: `jev` monitors PTY #2 stream
        PermissionBroker --> WaveDispatch: Safe `ASK` -> `jev` sends `ctrl+k`
        PermissionBroker --> HumanEscalate2: Risky `ASK` or 3x Task Failure -> Pause & Popup Modal
        HumanEscalate2 --> WaveDispatch: User resolves or overrides in PTY Panel
        WaveDispatch --> BranchVerified: `code-reviewer` + `verifier` pass; final `git commit` done
    }

    BranchVerified --> DeliveryGate: TUI presents Final Report + PR/Merge options
    DeliveryGate --> [*]
```

---

## 5. Open Design Decisions (To Resolve During Build)

| ID | Decision Area | Option A | Option B | Trade-off to Weigh |
| :--- | :--- | :--- | :--- | :--- |
| **OD-1** | **Turn-Completion & Telemetry Parsing in PTY** | **Structured Status Markers:** Instruct `planner` and `orchestrator` (via prompt/skill) to print lightweight lines like `[AGY:PHASE=SPEC_READY]` or `[AGY:TASK=2/5]`. | **Pure Regex + `jev` Parsing:** Parse `agy`'s existing tool-call UI box headers via regex and let `jev` classify pauses. | Adding 2–3 sentinel tags to agent prompts makes the TUI's progress bar and phase detection 100% rock-solid. |
| **OD-2** | **Checkpoint 1 (`spec.md`) Approval Policy** | **Always Human-Gated:** The TUI always pops up the Spec Review modal at Checkpoint 1 and asks the user to click `[Approve Spec]` before `writing-plans` starts. | **Confidence-Based:** `supervisor.md` auto-approves small/unambiguous specs and only pauses for human review if escalated questions occurred. | Always gating the Spec costs 30 seconds of human reading but guarantees `orchestrator` never builds the wrong design. |
| **OD-3** | **`supervisor.md` Invocation Mode** | **Stateless + Ledger Injection:** Every call to `agy --agent supervisor -p "..."` is a fresh one-shot call that reads `.agy/supervisor_state.json`. | **Resumed Session:** Use `agy`'s session resume flag so `supervisor.md` keeps conversational memory across the run. | Stateless + Ledger is immune to context compaction and crashes; Resumed Session avoids re-reading files. |
| **OD-4** | **Handling Mid-Implementation Blockers** | **Escalate Immediately:** If `orchestrator` reports `BLOCKED` or fails verification 3 times on a task, pause PTY #2 and alert the human in TUI. | **Supervisor Triage First:** Wake up `supervisor.md` to inspect the failure diff and give `orchestrator` one tactical hint before bothering the human. | Triage first can resolve simple environment/import hiccups autonomously without waking the user. |
| **OD-5** | **Windows vs. Cross-Platform PTY Backend** | **`pywinpty` (Windows ConPTY native):** Best compatibility with Windows PowerShell/`Get-ChildItem` environments. | **`wexpect` / `pexpect` abstraction:** Unified API if running across WSL/Linux and native Windows. | Depends on whether you run `agy` natively in Windows PowerShell/Terminal or inside WSL2. |