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
  type TuiInteractionMode,
  type TuiOverlayId,
  HeaderBar,
  type HeaderBarProps,
  formatDuration,
  formatCompactTimer,
  FooterBar,
  type FooterBarProps,
  Transcript,
  type TranscriptProps,
  CompletionCard,
  type CompletionCardProps,
  TeamRail,
  type TeamRailProps,
  type TeamMemberRow,
  deriveTeamMembers,
  formatElapsed,
  ZoomView,
  type ZoomViewProps,
  formatAgentStep,
  toCapitalizedWord,
  TakeoverView,
  type TakeoverViewProps,
  Composer,
  type ComposerProps,
  getComposerPlaceholder,
  wrapComposerLines,
  CommandPalette,
  type CommandPaletteProps,
  type SlashCommandItem,
  SLASH_COMMANDS,
  filterSlashCommands,
  DelegationCard,
  type DelegationCardProps,
  DecisionCard,
  type DecisionCardProps,
  FailureCard,
  type FailureCardProps,
  SpecPlanView,
  type SpecPlanViewProps,
  AuditLogView,
  type AuditLogViewProps,
  TranscriptStore,
  type TranscriptStoreOptions,
  type TranscriptStoreSnapshot,
  reduceNarrator,
  createInitialNarratorState,
  type NarratorState,
  type NarratorInputEvent,
  type TranscriptItem,
  resolveTheme,
  type ThemeConfig,
  type ThemeToken,
  resolveGlyphs,
  type GlyphSet,
  type TuiPanelId,
  type InputMode,
} from './tui/index.js';

export {
  createCliProgram,
  doctorCommand,
  runCommand,
  type DoctorOptions,
  type RunOptions,
} from './cli/index.js';
