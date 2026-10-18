export * from './core/types.js';

export {
  initLedger,
  loadLedger,
  updateLedger,
  saveLedgerAtomic,
  getLedgerPath,
  appendLedgerEvent,
} from './core/ledger.js';

export {
  runPreflightDoctor,
  findAgyBinary,
  resolveTargetDir,
  checkGitRepo,
  inspectProjectConfig,
  type PreflightOptions,
  type PreflightDoctorOptions,
} from './core/discovery.js';

export { PtyRunner } from './pty/runner.js';
export * from './pty/types.js';

export {
  createCliProgram,
  doctorCommand,
  runCommand,
  type DoctorOptions,
  type RunOptions,
} from './cli/index.js';
