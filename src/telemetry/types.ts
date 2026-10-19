export type TuiPanelId = 1 | 2 | 3 | 4;

export type InputMode = 'NAVIGATION' | 'PTY_INTERACT';

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  actor: string;
  message: string;
}

export interface TaskChecklistItem {
  text: string;
  checked: boolean;
}

export interface PlanTaskItem {
  id: string;
  index?: number; // 1-based task number in plan
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  commitSha?: string;
  wave?: number;
  totalWaves?: number;
  checklist?: TaskChecklistItem[];
}

export type AgentStepKind = 'read' | 'write' | 'command' | 'mcp' | 'work';

export interface AgentStepItem {
  id: string;
  timestamp: string;
  agent: string;
  kind: AgentStepKind;
  targets?: string[]; // e.g. ['auth.ts', 'config.ts'] for grouped reads or ['src/middleware/limiter.ts'] for write
  addedLines?: number; // (+N lines) if known
  command?: string;
  exitCode?: number;
  testSummary?: { passed: number; failed: number };
  mcpQuery?: string;
  status: 'running' | 'ok' | 'failed_recovered' | 'failed';
}

export type TelemetryEvent =
  | { type: 'SUBAGENT_DISPATCHED'; role: string; timestamp: string; rawLine: string }
  | { type: 'TOOL_CALLED'; agent: string; toolName: string; target?: string; addedLines?: number; mcpQuery?: string; timestamp: string }
  | { type: 'COMMAND_STARTED'; agent: string; command: string; timestamp: string }
  | { type: 'COMMAND_FINISHED'; agent: string; command: string; exitCode: number; testSummary?: { passed: number; failed: number }; timestamp: string }
  | { type: 'TEST_SUMMARY'; agent: string; passed: number; failed: number; timestamp: string }
  | { type: 'ERROR_LINE'; agent: string; message: string; timestamp: string }
  | { type: 'SUBAGENT_COMPLETED'; role: string; verdict: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED' | 'APPROVE' | 'REQUEST_CHANGES' | 'PASS' | 'FAIL'; reason?: string; elapsedMs: number; timestamp: string }
  | { type: 'DECISION_PROMPT'; promptKind: 'ask_question' | 'permission' | 'checkpoint_spec'; headline: string; question: string; contextLine?: string; command?: string; options: Array<{ index: number; label: string; recommended?: boolean }>; timestamp: string };

export interface ParserState {
  mainAgent: string;
  activeSubagent: string | null;
  subagentStartedAt: number | null;
  lastAction: string | null;
  lastCommand: string | null;
  lastErrorLine: string | null;
  agentSteps: Record<string, AgentStepItem[]>;
  waitingForInput: boolean;
  activityFeed: ActivityFeedItem[];
}

export interface WorkspacePollSnapshot {
  branch: string;
  dirtyFilesCount: number;
  lastCommit?: {
    sha: string;
    subject: string;
  };
  specPath: string | null;
  specContent: string | null;
  planPath: string | null;
  planContent: string | null;
  tasks: PlanTaskItem[];
}

export interface TelemetrySnapshot {
  branch: string;
  dirtyFilesCount: number;
  lastCommit?: {
    sha: string;
    subject: string;
  };
  totalElapsedMs: number;
  phaseElapsedMs: number;
  subagentElapsedMs: number;
  mainAgent: string;
  pid: number | undefined;
  activeSubagent: string | null;
  lastAction: string | null;
  lastCommand: string | null;
  lastErrorLine?: string | null;
  agentSteps?: Record<string, AgentStepItem[]>;
  waitingForInput: boolean;
  specPath: string | null;
  specContent: string | null;
  planPath: string | null;
  planContent: string | null;
  tasks: PlanTaskItem[];
  activityFeed: ActivityFeedItem[];
  ptyViewportLines: string[];
}

export interface TelemetryParserOptions {
  mainAgent?: string;
  maxFeedItems?: number;
}
