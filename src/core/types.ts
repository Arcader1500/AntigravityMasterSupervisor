export type LedgerStatus =
  | 'IDLE'
  | 'INITIALIZING'
  | 'PLANNING'
  | 'CHECKPOINT_SPEC'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

export type CheckpointStatus = 'UNINITIALIZED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type ProcessOutcome = {
  runId: string;
  sessionId: string;
  observedAt: string;
} & (
  | { kind: 'exit'; exitCode?: number; signal?: number }
  | { kind: 'interrupted'; supervisorSignal?: string; supervisorExitCode?: number }
  | { kind: 'startup_error'; message: string }
);

export interface ProcessRunContext {
  runId: string;
  sessionId: string;
  outcome?: ProcessOutcome;
}

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

export type ArtifactKind = 'spec' | 'plan';

export interface ArtifactRef {
  kind: ArtifactKind;
  path: string;
  revision: string;
  selectedAt: string;
}

export interface ApprovalRecord {
  actor: string;
  artifactKind: ArtifactKind;
  revision: string;
  decision: 'approved' | 'rejected';
  recordedAt: string;
}

export type HandoffStatus =
  | 'prepared'
  | 'starting'
  | 'started'
  | 'failed'
  | 'unknown'
  | 'cancelPending'
  | 'cancelled';

export interface HandoffRecord {
  status: HandoffStatus;
  idempotencyKey: string;
  approvedRevisions: Partial<Record<ArtifactKind, string>>;
  decisionsSnapshotHash: string;
  cancellationIntent?: { requestedAt: string; reason?: string };
  cancellationResult?: { cancelledAt: string; result: string };
  process?: { pid?: number; sessionId?: string; runId?: string; outcome?: ProcessOutcome };
}

export interface WorkflowState {
  schemaVersion: 1;
  runId: string;
  workspaceRoot: string;
  phase: string;
  originalRequest: { path: string; revision: string };
  spec?: ArtifactRef;
  plan?: ArtifactRef;
  handoff?: HandoffRecord;
  decisionsPath: string;
  journalPath: string;
  approvals?: ApprovalRecord[];
}

export interface DecisionRecord {
  id: string;
  prompt: string;
  answer?: string;
  status: 'answered' | 'unresolved';
  evidenceRefs: string[];
  assumptions: string[];
  timestamp: string;
  supersedes?: string;
}

export interface SupervisorLedger {
  /** Added in schema v2; optional in the type so existing in-memory fixtures remain source compatible. */
  schemaVersion?: 2;
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
  workflow?: WorkflowState;
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
