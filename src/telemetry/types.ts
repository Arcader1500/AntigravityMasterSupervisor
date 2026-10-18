export type TuiPanelId = 1 | 2 | 3 | 4;

export type InputMode = 'NAVIGATION' | 'PTY_INTERACT';

export interface ActivityFeedItem {
  id: string;
  timestamp: string;
  actor: string;
  message: string;
}

export interface PlanTaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  commitSha?: string;
}

export interface ParserState {
  mainAgent: string;
  activeSubagent: string | null;
  subagentStartedAt: number | null;
  lastAction: string | null;
  lastCommand: string | null;
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
