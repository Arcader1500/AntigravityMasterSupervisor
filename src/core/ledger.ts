import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupervisorLedger, LedgerEvent } from './types.js';

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
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, ledgerPath);
}

/**
 * Initializes a new supervisor_state.json file if one does not exist,
 * or returns the existing ledger if already present.
 */
export function initLedger(projectDir: string): SupervisorLedger {
  const ledgerPath = getLedgerPath(projectDir);

  if (fs.existsSync(ledgerPath)) {
    return loadLedger(projectDir);
  }

  const now = new Date().toISOString();
  const defaultLedger: SupervisorLedger = {
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

  try {
    return JSON.parse(raw) as SupervisorLedger;
  } catch (_err) {
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
