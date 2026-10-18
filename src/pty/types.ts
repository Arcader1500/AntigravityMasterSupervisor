/**
 * Options for configuring a PtyRunner session.
 */
export interface PtyRunnerOptions {
  /** Target working directory where the process executes. */
  projectDir: string;
  /** Path or command name of the executable (e.g. 'agy', 'node'). */
  binaryPath: string;
  /** Name of the agent to invoke (e.g. 'planner', 'orchestrator'). */
  agent: string;
  /** Additional command-line arguments. */
  args?: string[];
  /** Terminal column width (default: 80). */
  cols?: number;
  /** Terminal row height (default: 30). */
  rows?: number;
  /** If true, simulates terminal session without spawning background process. */
  dryRun?: boolean;
}

/**
 * Result returned upon PTY process termination.
 */
export interface PtyExitResult {
  code: number;
  signal?: number;
}

/**
 * Listener function for receiving ANSI / text data chunks from PTY.
 */
export type DataListener = (data: string) => void;

/**
 * Listener function for process termination events.
 */
export type ExitListener = (code: number, signal?: number) => void;

/**
 * Resolved spawn configuration for node-pty.
 */
export interface SpawnConfig {
  file: string;
  args: string[];
  options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
    useConpty?: boolean;
  };
}
