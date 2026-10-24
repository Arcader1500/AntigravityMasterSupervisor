import * as fs from 'node:fs';
import * as path from 'node:path';
import { VirtualTerminal } from '../pty/virtual-terminal.js';
import { PtyRunner } from '../pty/runner.js';
import { TelemetryParser } from './parser.js';
import { canPromoteLedgerStatus, pollWorkspaceOnce } from './poller.js';
import { appendLedgerEvent, getLedgerPath, loadLedger, updateLedger } from '../core/ledger.js';
import type { ProcessOutcome, ProcessRunContext } from '../core/types.js';
import type {
  ActivityFeedItem,
  ObservationSource,
  TelemetryEvent,
  TelemetrySnapshot,
  WorkspacePollSnapshot,
} from './types.js';

export interface TelemetryStoreOptions {
  projectDir: string;
  virtualTerminal?: VirtualTerminal;
  parser?: TelemetryParser;
  ptyRunner?: Pick<PtyRunner, 'getPid'>;
  pid?: number;
  pollIntervalMs?: number;
  sessionStartedAt?: number;
  processRun?: ProcessRunContext;
}

const EXECUTION_SUBAGENT_ROLES = ['orchestrator', 'implementer', 'code-reviewer', 'verifier'];

/**
 * TelemetryStore provides real-time state aggregation combining headless PTY output,
 * parsed agent lifecycle telemetry, workspace Git commits, and spec/plan artifacts.
 */
export class TelemetryStore {
  private projectDir: string;
  private virtualTerminal: VirtualTerminal;
  private parser: TelemetryParser;
  private ptyRunner?: Pick<PtyRunner, 'getPid'>;
  private explicitPid?: number;
  private sessionStartedAt?: number;
  private processRun?: ProcessRunContext;
  private endedOutcome?: ProcessOutcome;
  private phaseSource?: ObservationSource;
  private startedAt: number;
  private phaseStartedAt: number;
  private lastPollSnapshot: WorkspacePollSnapshot;
  private lastSeenCommitSha: string | null = null;
  private extraFeedItems: ActivityFeedItem[] = [];
  private listeners: Set<() => void> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;
  private unsubscribeLineCommit: (() => void) | null = null;
  private unsubscribeTelemetryEvent: (() => void) | null = null;

  constructor(options: TelemetryStoreOptions);
  constructor(
    virtualTerminal: VirtualTerminal,
    parser: TelemetryParser,
    projectDir: string,
    ptyRunner?: Pick<PtyRunner, 'getPid'> | number
  );
  constructor(
    optionsOrVt: TelemetryStoreOptions | VirtualTerminal,
    parser?: TelemetryParser,
    projectDir?: string,
    ptyRunnerOrPid?: Pick<PtyRunner, 'getPid'> | number
  ) {
    this.startedAt = Date.now();
    this.phaseStartedAt = this.startedAt;

    if (
      optionsOrVt &&
      typeof optionsOrVt === 'object' &&
      'getViewportLines' in optionsOrVt
    ) {
      this.virtualTerminal = optionsOrVt;
      this.parser = parser ?? new TelemetryParser();
      this.projectDir = path.resolve(projectDir ?? process.cwd());

      if (typeof ptyRunnerOrPid === 'number') {
        this.explicitPid = ptyRunnerOrPid;
      } else if (ptyRunnerOrPid) {
        this.ptyRunner = ptyRunnerOrPid;
      }
    } else {
      const opts = (optionsOrVt as TelemetryStoreOptions) ?? {
        projectDir: process.cwd(),
      };
      this.projectDir = path.resolve(opts.projectDir);
      this.sessionStartedAt = opts.sessionStartedAt;
      this.processRun = opts.processRun;
      this.endedOutcome = opts.processRun?.outcome;
      this.virtualTerminal = opts.virtualTerminal ?? new VirtualTerminal();
      this.parser = opts.parser ?? new TelemetryParser();
      this.ptyRunner = opts.ptyRunner;
      this.explicitPid = opts.pid;
    }

    // Default initial workspace poll
    this.lastPollSnapshot = {
      branch: 'unknown',
      dirtyFilesCount: 0,
      specPath: null,
      specContent: null,
      planPath: null,
      planContent: null,
      tasks: [],
    };

    // Initial poll to capture baseline workspace state without treating initial commit as new
    this.lastPollSnapshot = this.pollWorkspace();
    if (this.lastPollSnapshot.lastCommit?.sha) {
      this.lastSeenCommitSha = this.lastPollSnapshot.lastCommit.sha;
    }

    // Connect virtual terminal committed lines to telemetry parser
    this.unsubscribeLineCommit = this.virtualTerminal.onLineCommit((line: string) => {
      this.parser.processLine(line);
      this.notify();
    });

    this.unsubscribeTelemetryEvent = this.parser.onEvent((event) => {
      this.handleTelemetryEvent(event);
    });
  }

  /**
   * Advances the ledger to EXECUTING when an execution subagent is dispatched
   * while the session is still in a planning phase.
   */
  private handleTelemetryEvent(event: TelemetryEvent): void {
    if (this.endedOutcome) return;
    if (event.type !== 'SUBAGENT_DISPATCHED') {
      return;
    }

    if (!EXECUTION_SUBAGENT_ROLES.includes(event.role.toLowerCase())) {
      return;
    }

    this.phaseSource = event.source ?? 'agent_output';

    const ledgerPath = getLedgerPath(this.projectDir);
    if (!fs.existsSync(ledgerPath)) {
      return;
    }

    updateLedger(this.projectDir, (ledger) => {
      if (this.processRun && ledger.sessionId !== this.processRun.sessionId) return;
      if (!canPromoteLedgerStatus(ledger, this.processRun?.runId)) return;
      if (ledger.status === 'IDLE' || ledger.status === 'PLANNING' || ledger.status === 'CHECKPOINT_SPEC') {
        ledger.status = 'EXECUTING';
      }
    });
  }

  private pollWorkspace(): WorkspacePollSnapshot {
    const ledgerPath = getLedgerPath(this.projectDir);
    const statusBefore = fs.existsSync(ledgerPath) ? loadLedger(this.projectDir).status : undefined;
    const snapshot = pollWorkspaceOnce(this.projectDir, {
      minMtimeMs: this.sessionStartedAt,
      allowStatusPromotion: !this.endedOutcome,
    });
    if (fs.existsSync(ledgerPath)) {
      const ledger = loadLedger(this.projectDir);
      if (statusBefore !== ledger.status && ledger.status === 'EXECUTING') {
        this.phaseSource = 'artifacts';
      }
    }
    return snapshot;
  }

  private getPersistedProcessState(): { outcome?: ProcessOutcome; phaseSource?: ObservationSource } {
    const ledgerPath = getLedgerPath(this.projectDir);
    if (!fs.existsSync(ledgerPath)) return {};
    const ledger = loadLedger(this.projectDir);
    const event = [...ledger.events].reverse().find((item) =>
      item.metadata?.kind === 'PROCESS_STARTED' || item.metadata?.kind === 'PROCESS_OUTCOME'
    );
    if (!event) return {};
    const metadata = event.metadata;
    if (typeof metadata?.runId !== 'string' || metadata.sessionId !== ledger.sessionId ||
      (this.processRun && metadata.runId !== this.processRun.runId)) {
      return {};
    }
    if (metadata.kind !== 'PROCESS_OUTCOME') return { phaseSource: 'ledger' };
    const base = { runId: metadata.runId, sessionId: metadata.sessionId, observedAt: event.timestamp };
    if (metadata.outcomeKind === 'exit') {
      return { phaseSource: 'ledger', outcome: {
        ...base,
        kind: 'exit',
        ...(typeof metadata.exitCode === 'number' ? { exitCode: metadata.exitCode } : {}),
        ...(typeof metadata.signal === 'number' ? { signal: metadata.signal } : {}),
      } };
    }
    if (metadata.outcomeKind === 'interrupted') {
      return { phaseSource: 'ledger', outcome: {
        ...base,
        kind: 'interrupted',
        ...(typeof metadata.supervisorSignal === 'string' ? { supervisorSignal: metadata.supervisorSignal } : {}),
        ...(typeof metadata.supervisorExitCode === 'number' ? { supervisorExitCode: metadata.supervisorExitCode } : {}),
      } };
    }
    if (metadata.outcomeKind === 'startup_error' && typeof metadata.message === 'string') {
      return { phaseSource: 'ledger', outcome: { ...base, kind: 'startup_error', message: metadata.message } };
    }
    return { phaseSource: 'ledger' };
  }

  /** Marks this local process generation ended and fences later parser/poller promotions. */
  public handleProcessOutcome(outcome: ProcessOutcome): void {
    if (this.processRun && this.processRun.runId !== outcome.runId) return;
    if (this.endedOutcome) return;
    this.endedOutcome = outcome;
    if (this.processRun) this.processRun.outcome = outcome;
    this.notify();
  }

  /**
   * Subscribes a listener to structured telemetry events emitted by the parser.
   */
  public onTelemetryEvent(listener: (event: TelemetryEvent) => void): () => void {
    return this.parser.onEvent(listener);
  }

  /**
   * Immediately runs a workspace poll cycle, checks for new Git commits,
   * updates cached artifacts and tasks, and notifies listeners.
   */
  public pollNow(): WorkspacePollSnapshot {
    const currentPoll = this.pollWorkspace();
    const currentSha = currentPoll.lastCommit?.sha;

    if (
      currentSha &&
      this.lastSeenCommitSha !== null &&
      currentSha !== this.lastSeenCommitSha
    ) {
      const subject = currentPoll.lastCommit?.subject ?? '';
      const gitItem: ActivityFeedItem = {
        id: `git-${Date.now()}-${currentSha}`,
        timestamp: new Date().toISOString(),
        actor: 'GIT',
        message: `Commit ${currentSha}: ${subject}`,
      };
      this.extraFeedItems.push(gitItem);

      const ledgerPath = getLedgerPath(this.projectDir);
      if (fs.existsSync(ledgerPath)) {
        try {
          appendLedgerEvent(
            this.projectDir,
            'INFO',
            `[GIT] Commit ${currentSha}: ${subject}`,
            { sha: currentSha, subject }
          );
        } catch {
          // Ignore ledger append errors
        }
      }
    }

    if (currentSha) {
      this.lastSeenCommitSha = currentSha;
    }

    this.lastPollSnapshot = currentPoll;
    this.notify();
    return currentPoll;
  }

  /**
   * Starts periodic workspace polling at the specified interval.
   */
  public startPolling(intervalMs: number = 2000): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.pollNow();
    this.pollTimer = setInterval(() => {
      this.pollNow();
    }, intervalMs);

    this.pollTimer.unref?.();
  }

  /**
   * Stops polling timer and unsubscribes from virtual terminal events.
   */
  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.unsubscribeLineCommit) {
      this.unsubscribeLineCommit();
      this.unsubscribeLineCommit = null;
    }

    if (this.unsubscribeTelemetryEvent) {
      this.unsubscribeTelemetryEvent();
      this.unsubscribeTelemetryEvent = null;
    }
  }

  /**
   * Subscribes a listener callback to state changes. Returns an unsubscribe function.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Dispatches notifications to all registered subscriber callbacks.
   */
  public notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in TelemetryStore listener:', err);
      }
    }
  }

  /**
   * Resets the phase timer to measure elapsed time from a new checkpoint.
   */
  public resetPhaseTimer(now: number = Date.now()): void {
    this.phaseStartedAt = now;
    this.notify();
  }

  /**
   * Sets or overrides the active process ID.
   */
  public setPid(pid: number | undefined): void {
    this.explicitPid = pid;
    this.notify();
  }

  /**
   * Generates a consolidated snapshot of the current system telemetry.
   */
  public getSnapshot(): TelemetrySnapshot {
    const parserState = this.parser.getState();
    const now = Date.now();

    const totalElapsedMs = Math.max(0, now - this.startedAt);
    const phaseElapsedMs = Math.max(0, now - this.phaseStartedAt);
    const subagentElapsedMs =
      parserState.activeSubagent && parserState.subagentStartedAt
        ? Math.max(0, now - parserState.subagentStartedAt)
        : 0;

    const pid =
      this.explicitPid !== undefined
        ? this.explicitPid
        : this.ptyRunner?.getPid();

    const activityFeed = [...parserState.activityFeed, ...this.extraFeedItems];

    const persistedProcess = this.getPersistedProcessState();
    const persistedOutcome = persistedProcess.outcome;
    const processOutcome = persistedOutcome ?? this.endedOutcome;
    const phaseSource = persistedOutcome ? 'ledger' : this.phaseSource ?? persistedProcess.phaseSource;
    return {
      branch: this.lastPollSnapshot.branch,
      dirtyFilesCount: this.lastPollSnapshot.dirtyFilesCount,
      lastCommit: this.lastPollSnapshot.lastCommit,
      totalElapsedMs,
      phaseElapsedMs,
      subagentElapsedMs,
      mainAgent: parserState.mainAgent,
      pid,
      activeSubagent: parserState.activeSubagent,
      lastAction: parserState.lastAction,
      lastCommand: parserState.lastCommand,
      lastErrorLine: parserState.lastErrorLine,
      agentSteps: parserState.agentSteps,
      waitingForInput: parserState.waitingForInput,
      specPath: this.lastPollSnapshot.specPath,
      specContent: this.lastPollSnapshot.specContent,
      planPath: this.lastPollSnapshot.planPath,
      planContent: this.lastPollSnapshot.planContent,
      tasks: this.lastPollSnapshot.tasks,
      activityFeed,
      ptyViewportLines: this.virtualTerminal.getViewportLines(),
      ...(processOutcome ? { processOutcome } : {}),
      ...(persistedOutcome ? { processOutcomeSource: 'ledger' as const } : {}),
      ...(phaseSource ? { phaseSource } : {}),
    };
  }
}
