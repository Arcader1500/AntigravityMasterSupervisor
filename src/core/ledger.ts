import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SupervisorLedger, LedgerEvent, WorkflowState } from './types.js';

const CURRENT_SCHEMA_VERSION = 2 as const;

export class UnsupportedLedgerSchemaError extends Error {
  constructor(schemaVersion: unknown) {
    super(`Unsupported supervisor ledger schema version: ${String(schemaVersion)}`);
    this.name = 'UnsupportedLedgerSchemaError';
  }
}

/**
 * Returns the path to the workspace supervisor ledger.
 */
export function getLedgerPath(projectDir: string): string {
  return path.join(projectDir, '.agy', 'supervisor_state.json');
}

/**
 * Atomically saves the ledger to disk by writing to a temporary file
 * and renaming it to replace the target file.
 */
export function saveLedgerAtomic(projectDir: string, data: SupervisorLedger): void {
  const ledgerPath = getLedgerPath(projectDir);
  const dir = path.dirname(ledgerPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${ledgerPath}.tmp`;
  const content = JSON.stringify({ ...data, schemaVersion: CURRENT_SCHEMA_VERSION }, null, 2) + '\n';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, ledgerPath);
}

/**
 * Options controlling ledger initialization.
 */
export interface InitLedgerOptions {
  reset?: boolean;
}

/**
 * Initializes a new supervisor_state.json file if one does not exist,
 * or returns the existing ledger if already present.
 * When `reset` is true, an existing ledger is overwritten with a fresh one.
 */
export function initLedger(
  projectDir: string,
  options?: InitLedgerOptions
): SupervisorLedger {
  const ledgerPath = getLedgerPath(projectDir);

  if (!options?.reset && fs.existsSync(ledgerPath)) {
    return loadLedger(projectDir);
  }

  const now = new Date().toISOString();
  const defaultLedger: SupervisorLedger = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    version: '1.0.0',
    sessionId: randomUUID(),
    projectPath: path.resolve(projectDir),
    createdAt: now,
    updatedAt: now,
    status: 'IDLE',
    activeAgent: null,
    checkpoints: {
      spec: {
        status: 'UNINITIALIZED',
      },
      plan: {
        status: 'UNINITIALIZED',
      },
    },
    events: [],
  };

  saveLedgerAtomic(projectDir, defaultLedger);
  return defaultLedger;
}

/**
 * Loads and parses the supervisor ledger from disk.
 * If the file is missing, it initializes a clean ledger.
 * If the file contains malformed/corrupt JSON, it renames the corrupt file
 * to .agy/supervisor_state.json.corrupt.<timestamp> and re-initializes a clean ledger.
 */
export function loadLedger(projectDir: string): SupervisorLedger {
  const ledgerPath = getLedgerPath(projectDir);

  if (!fs.existsSync(ledgerPath)) {
    return initLedger(projectDir);
  }

  const raw = fs.readFileSync(ledgerPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const timestamp = Date.now();
    const corruptPath = path.join(
      path.dirname(ledgerPath),
      `supervisor_state.json.corrupt.${timestamp}`
    );

    fs.renameSync(ledgerPath, corruptPath);

    const cleanLedger = initLedger(projectDir);
    cleanLedger.events.push({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message: `Recovered from corrupt ledger. Corrupt file backed up to ${path.basename(corruptPath)}`,
    });
    saveLedgerAtomic(projectDir, cleanLedger);

    return cleanLedger;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Supervisor ledger must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const schemaVersion = Object.prototype.hasOwnProperty.call(record, 'schemaVersion')
    ? record.schemaVersion
    : 1;
  if (schemaVersion === 1 && record.version !== '1.0.0') {
    throw new UnsupportedLedgerSchemaError(record.version ?? schemaVersion);
  }
  if (schemaVersion !== 1 && schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedLedgerSchemaError(schemaVersion);
  }
  const migrated = { ...record, schemaVersion: CURRENT_SCHEMA_VERSION } as unknown as SupervisorLedger;
  if (schemaVersion === 1) saveLedgerAtomic(projectDir, migrated);
  return migrated;
}

export interface CreateWorkflowStateOptions {
  runId?: string;
  workspaceRoot?: string;
}

/** Persist a run's original request once and bind the workflow to its SHA-256. */
export function createWorkflowState(
  projectDir: string,
  requestText: string,
  options: CreateWorkflowStateOptions = {}
): WorkflowState {
  const runId = options.runId ?? randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new Error('Invalid workflow run ID');
  }

  const projectRoot = path.resolve(projectDir);
  const relativeRunDir = path.join('.agy', 'runs', runId);
  const runDir = path.resolve(projectRoot, relativeRunDir);
  if (!runDir.startsWith(`${projectRoot}${path.sep}`)) throw new Error('Workflow run path escapes workspace');
  for (const candidate of [path.join(projectRoot, '.agy'), path.join(projectRoot, '.agy', 'runs'), runDir]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error('Workflow state cannot be written through a symbolic link');
    }
  }
  fs.mkdirSync(runDir, { recursive: true });

  const requestPath = path.join(runDir, 'request.txt');
  const revision = createHash('sha256').update(requestText, 'utf8').digest('hex');
  if (fs.existsSync(requestPath)) {
    if (fs.lstatSync(requestPath).isSymbolicLink()) {
      throw new Error('Workflow request snapshot cannot be a symbolic link');
    }
    const existing = fs.readFileSync(requestPath);
    if (createHash('sha256').update(existing).digest('hex') !== revision) {
      throw new Error('Original request snapshot is immutable for this run ID');
    }
  } else {
    const fd = fs.openSync(requestPath, 'wx');
    try {
      fs.writeFileSync(fd, requestText, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  const now = new Date().toISOString();
  const workflow: WorkflowState = {
    schemaVersion: 1,
    runId,
    workspaceRoot: path.resolve(options.workspaceRoot ?? projectRoot),
    phase: 'request',
    originalRequest: { path: path.relative(projectRoot, requestPath), revision },
    decisionsPath: path.join(relativeRunDir, 'decisions.jsonl'),
    journalPath: path.join(relativeRunDir, 'events.jsonl'),
    approvals: [],
  };

  const ledger = loadLedger(projectRoot);
  if (ledger.workflow?.runId === runId) {
    if (ledger.workflow.originalRequest.revision !== revision) {
      throw new Error('Original request snapshot is immutable for this run ID');
    }
    return ledger.workflow;
  }
  ledger.workflow = workflow;
  ledger.updatedAt = now;
  saveLedgerAtomic(projectRoot, ledger);
  return workflow;
}

/**
 * Updates the ledger by applying a mutating updater function,
 * automatically refreshing the updatedAt timestamp and persisting atomically.
 */
export function updateLedger(
  projectDir: string,
  updater: (ledger: SupervisorLedger) => void
): SupervisorLedger {
  const ledger = loadLedger(projectDir);
  updater(ledger);
  ledger.updatedAt = new Date().toISOString();
  saveLedgerAtomic(projectDir, ledger);
  return ledger;
}

/**
 * Appends an event to the ledger's event log.
 */
export function appendLedgerEvent(
  projectDir: string,
  level: LedgerEvent['level'],
  message: string,
  meta?: Record<string, unknown>
): void {
  updateLedger(projectDir, (ledger) => {
    ledger.events.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta ? { metadata: meta } : {}),
    });
  });
}
