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
export { VirtualTerminal } from './pty/virtual-terminal.js';
export { attachRawPassthrough } from './pty/raw-passthrough.js';
export * from './pty/types.js';

export * from './telemetry/types.js';
export { TelemetryParser } from './telemetry/parser.js';
export {
  pollWorkspaceOnce,
  parsePlanTasks,
  type PollWorkspaceOptions,
} from './telemetry/poller.js';
export {
  TelemetryStore,
  type TelemetryStoreOptions,
} from './telemetry/store.js';

export {
  mountSupervisorTui,
  type MountSupervisorTuiOptions,
  type SupervisorTuiInstance,
  App,
  type AppProps,
  HeaderBar,
  type HeaderBarProps,
  formatDuration,
  FooterBar,
  type FooterBarProps,
  MainStatusView,
  type MainStatusViewProps,
  LivePtyView,
  type LivePtyViewProps,
  SpecPlanView,
  type SpecPlanViewProps,
  AuditLogView,
  type AuditLogViewProps,
} from './tui/index.js';

export {
  createCliProgram,
  doctorCommand,
  runCommand,
  type DoctorOptions,
  type RunOptions,
} from './cli/index.js';

