export type LedgerStatus =
  | 'IDLE'
  | 'INITIALIZING'
  | 'PLANNING'
  | 'CHECKPOINT_SPEC'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

export type CheckpointStatus = 'UNINITIALIZED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface CheckpointInfo {
  status: CheckpointStatus;
  path?: string;
  approvedAt?: string;
}

export interface LedgerEvent {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SupervisorLedger {
  version: '1.0.0' | string;
  sessionId: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  status: LedgerStatus;
  activeAgent: string | null;
  checkpoints: {
    spec: CheckpointInfo;
    plan: CheckpointInfo;
  };
  events: LedgerEvent[];
}

export interface GitCheckResult {
  isGit: boolean;
  rootDir?: string;
  branch?: string;
  isClean?: boolean;
  error?: string;
}

export interface AgyBinaryResult {
  path: string | null;
  source: 'override' | 'env' | 'path' | 'none';
  version?: string;
}

export interface ProjectConfigCheckResult {
  hasGeminiMd: boolean;
  hasClaudeMd: boolean;
  hasAgyConfig: boolean;
}

export interface PreflightReport {
  targetDir: string;
  git: GitCheckResult;
  agyBin: AgyBinaryResult;
  config: ProjectConfigCheckResult;
  allPassed: boolean;
}
