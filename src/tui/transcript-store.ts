import type { TelemetryEvent, PlanTaskItem } from '../telemetry/types.js';
import { randomUUID } from 'node:crypto';
import type { TelemetryStore } from '../telemetry/store.js';
import type { TelemetryParser } from '../telemetry/parser.js';
import type { ProcessOutcome, ProcessRunContext, SupervisorLedger } from '../core/types.js';
import { createProcessRunContext } from '../core/process-outcome.js';
import {
  createInitialNarratorState,
  reduceNarrator,
  type NarratorState,
  type NarratorInputEvent,
  type TranscriptItem,
} from './narrator.js';
import { HELP_TEXT_NOTE } from './narrator-copy.js';

export function formatElapsedHuman(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export interface TranscriptStoreCallbacks {
  onOpenOverlay?: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => void;
  onEnterTakeover?: () => void;
  onRequestQuit?: () => void;
}

export interface TranscriptStoreOptions {
  telemetryStore: TelemetryStore;
  parser?: TelemetryParser;
  initialLedger?: SupervisorLedger;
  processRun?: ProcessRunContext;
  onWritePty: (data: string) => void;
  onRingBell?: () => void;
  onEnterTakeover?: () => void;
  onOpenOverlay?: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => void;
  onRequestQuit?: () => void;
  getPtyPid?: () => number | undefined;
  platform?: NodeJS.Platform;
}

export type PauseFeedback = 'active' | 'windows_input_only' | 'pause_signal_sent_unconfirmed' | 'pause_signal_failed' | 'pause_signal_unavailable' | 'resume_signal_sent_unconfirmed' | 'resume_signal_failed' | 'resume_signal_unavailable' | 'process_ended';

export interface TranscriptDeliverySnapshot {
  queuedWrites: number;
  pauseFeedback: PauseFeedback;
  terminal: boolean;
}

export interface TranscriptStoreSnapshot {
  narrator: NarratorState;
  items: TranscriptItem[];
  hasStarted: boolean;
  isPaused: boolean;
  delivery: TranscriptDeliverySnapshot;
  pendingDecisionCount: number;
  focusedDecision: Extract<TranscriptItem, { kind: 'DecisionCard' | 'FailureCard' }> | null;
  handledCounts: {
    promptsApproved: number;
    questionsAnswered?: number;
    planFixes?: number;
  };
}

interface PendingPtyWrite {
  payload: string;
  runId: string;
  submissionId?: string;
  cardId?: string;
  cardRevision?: number;
  answerText?: string;
}

export interface DecisionSubmission {
  id: string;
  decisionId: string;
}

const MAX_REMEMBERED_SUBMISSIONS = 1024;
const MAX_DELIVERY_ERROR_LENGTH = 240;

export class TranscriptStore {
  private options: TranscriptStoreOptions;
  private processRun: ProcessRunContext;
  private narratorState: NarratorState;
  private isPaused: boolean = false;
  private pendingPtyWrites: PendingPtyWrite[] = [];
  private inFlightWrite?: PendingPtyWrite;
  private submissions = new Map<string, 'pending' | 'resolved'>();
  private handledOutcomeRunIds = new Set<string>();
  private pauseFeedback: PauseFeedback = 'active';
  private terminal = false;
  private disposed = false;
  private rungBellCardIds: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();
  private unsubscribes: Array<() => void> = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private lastLedgerStatus: string = 'IDLE';
  private lastSeenCommitSha: string | null = null;
  private lastErrorLine: string | null = null;

  constructor(options: TranscriptStoreOptions) {
    this.options = options;
    this.processRun = options.processRun ?? createProcessRunContext(options.initialLedger?.sessionId ?? randomUUID());
    if (this.processRun.outcome) {
      this.terminal = true;
      this.pauseFeedback = 'process_ended';
    }
    this.narratorState = createInitialNarratorState();
    if (this.processRun.outcome) {
      this.handledOutcomeRunIds.add(this.processRun.outcome.runId);
      this.narratorState = reduceNarrator(this.narratorState, { type: 'PROCESS_OUTCOME', outcome: this.processRun.outcome });
    }

    if (options.initialLedger) {
      this.lastLedgerStatus = options.initialLedger.status;
      this.narratorState.ledgerStatus = options.initialLedger.status;
      if (options.initialLedger.status === 'CHECKPOINT_SPEC') {
        this.dispatchCheckpointSpecPrompt(options.initialLedger);
      }
    }

    // Seed lastSeenCommitSha so existing commits don't trigger NEW_COMMIT
    const initialSnapshot = options.telemetryStore.getSnapshot();
    if (initialSnapshot.lastCommit?.sha) {
      this.lastSeenCommitSha = initialSnapshot.lastCommit.sha;
    }
    if (initialSnapshot.tasks && initialSnapshot.tasks.length > 0) {
      this.dispatch({ type: 'TASKS_UPDATED', tasks: initialSnapshot.tasks });
    }

    // Listen to structured telemetry events
    const eventHandler = (event: TelemetryEvent) => {
      if (event.type === 'ERROR_LINE') {
        this.lastErrorLine = event.message;
      }
      const elapsedFormatted = this.getElapsedFormatted();
      const lastError = this.getLastErrorLine();
      this.dispatch({
        type: 'TELEMETRY_EVENT',
        event,
        elapsedFormatted,
        lastErrorLine: lastError,
      });
    };

    const unsubTelemetry = options.telemetryStore.onTelemetryEvent(eventHandler);
    this.unsubscribes.push(unsubTelemetry);

    // If a separate parser is provided, also subscribe if distinct
    if (options.parser && options.parser !== (options.telemetryStore as any).parser) {
      const unsubParser = options.parser.onEvent(eventHandler);
      this.unsubscribes.push(unsubParser);
    }

    // Subscribe to workspace store poll updates
    const unsubStore = options.telemetryStore.subscribe(() => {
      const snap = options.telemetryStore.getSnapshot();
      if (snap.tasks && snap.tasks !== this.narratorState.tasks) {
        this.dispatch({ type: 'TASKS_UPDATED', tasks: snap.tasks });
      }
      if (snap.lastCommit?.sha && snap.lastCommit.sha !== this.lastSeenCommitSha) {
        this.lastSeenCommitSha = snap.lastCommit.sha;
        this.dispatch({
          type: 'NEW_COMMIT',
          sha: snap.lastCommit.sha,
          subject: snap.lastCommit.subject,
          timestamp: new Date().toISOString(),
        });
      }
    });
    this.unsubscribes.push(unsubStore);

    // Periodic tick to update elapsed time on active DelegationCards
    this.tickTimer = setInterval(() => {
      if (!this.isPaused) {
        this.dispatch({
          type: 'TICK_ELAPSED',
          elapsedFormatted: this.getElapsedFormatted(),
        });
      }
    }, 1000);
    this.tickTimer.unref?.();
  }

  public subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setCallbacks(callbacks: TranscriptStoreCallbacks): () => void {
    const prevOpenOverlay = this.options.onOpenOverlay;
    const prevEnterTakeover = this.options.onEnterTakeover;
    const prevRequestQuit = this.options.onRequestQuit;

    if (callbacks.onOpenOverlay !== undefined) {
      this.options.onOpenOverlay = callbacks.onOpenOverlay;
    }
    if (callbacks.onEnterTakeover !== undefined) {
      this.options.onEnterTakeover = callbacks.onEnterTakeover;
    }
    if (callbacks.onRequestQuit !== undefined) {
      this.options.onRequestQuit = callbacks.onRequestQuit;
    }

    return () => {
      this.options.onOpenOverlay = prevOpenOverlay;
      this.options.onEnterTakeover = prevEnterTakeover;
      this.options.onRequestQuit = prevRequestQuit;
    };
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in TranscriptStore listener:', err);
      }
    }
  }

  public dispatch(event: NarratorInputEvent): void {
    if (this.disposed || this.terminal) return;
    if (this.isPaused && event.type === 'TICK_ELAPSED') {
      return;
    }
    this.applyEvent(event);
  }

  private applyEvent(event: NarratorInputEvent): void {
    this.narratorState = reduceNarrator(this.narratorState, event);
    this.checkBell();
    this.notify();
  }

  private checkBell(): void {
    const bellId = this.narratorState.latestBellDecisionId;
    if (bellId && !this.rungBellCardIds.has(bellId)) {
      this.rungBellCardIds.add(bellId);
      try {
        this.options.onRingBell?.();
      } catch {
        // ignore callback error
      }
    }
  }

  public getSnapshot(): TranscriptStoreSnapshot {
    return {
      narrator: this.narratorState,
      items: this.narratorState.items,
      hasStarted: this.narratorState.hasStarted,
      isPaused: this.isPaused,
      delivery: {
        queuedWrites: this.pendingPtyWrites.length,
        pauseFeedback: this.pauseFeedback,
        terminal: this.terminal,
      },
      pendingDecisionCount: this.narratorState.pendingDecisionCount,
      focusedDecision: this.getFocusedDecision(),
      handledCounts: this.getHandledCounts(),
    };
  }

  public getFocusedDecision(): Extract<TranscriptItem, { kind: 'DecisionCard' | 'FailureCard' }> | null {
    for (const item of this.narratorState.items) {
      if (item.kind === 'DecisionCard' && item.status === 'pending' && item.delivery !== 'queued') {
        return item;
      }
      if (item.kind === 'FailureCard' && item.status === 'pending' && item.delivery !== 'queued') {
        return item;
      }
    }
    return null;
  }

  private getHandledCounts(): {
    promptsApproved: number;
    questionsAnswered?: number;
    planFixes?: number;
  } {
    const quietItem = this.narratorState.items.find(
      (i): i is Extract<TranscriptItem, { kind: 'QuietCounter' }> => i.kind === 'QuietCounter'
    );
    if (quietItem) {
      return {
        promptsApproved: quietItem.promptsApproved,
        questionsAnswered: quietItem.questionsAnswered,
        planFixes: quietItem.planFixes,
      };
    }
    return {
      promptsApproved: 0,
      questionsAnswered: undefined,
      planFixes: undefined,
    };
  }

  private claimSubmission(submissionId?: string): boolean {
    if (!submissionId) return true;
    if (this.submissions.has(submissionId)) return false;
    this.trimSubmissions();
    if (this.submissions.size >= MAX_REMEMBERED_SUBMISSIONS) return false;
    this.submissions.set(submissionId, 'pending');
    this.trimSubmissions();
    return true;
  }

  private resolveSubmission(submissionId?: string): void {
    if (submissionId && this.submissions.has(submissionId)) {
      this.submissions.set(submissionId, 'resolved');
      this.trimSubmissions();
    }
  }

  private trimSubmissions(): void {
    if (this.submissions.size < MAX_REMEMBERED_SUBMISSIONS) return;
    for (const [id, status] of this.submissions) {
      if (status === 'resolved') this.submissions.delete(id);
      if (this.submissions.size < MAX_REMEMBERED_SUBMISSIONS) break;
    }
  }

  private updateCardDelivery(id: string, delivery: 'pending' | 'queued' | 'written' | 'error', deliveryError?: string): void {
    this.applyEvent({ type: 'DECISION_DELIVERY_UPDATED', id, delivery, deliveryError: deliveryError?.slice(0, MAX_DELIVERY_ERROR_LENGTH) });
  }

  private sendPtyWrite(payload: string, details: Omit<PendingPtyWrite, 'payload' | 'runId'> = {}): boolean {
    if (this.disposed || this.terminal) {
      this.resolveSubmission(details.submissionId);
      return false;
    }
    const entry: PendingPtyWrite = { payload, runId: this.processRun.runId, ...details };
    if (this.isPaused) {
      this.pendingPtyWrites.push(entry);
      if (entry.cardId) this.updateCardDelivery(entry.cardId, 'queued');
      this.notify();
      return false;
    }
    return this.deliverPtyWrite(entry);
  }

  private deliverPtyWrite(entry: PendingPtyWrite): boolean {
    if (this.disposed || this.terminal || entry.runId !== this.processRun.runId) {
      this.cancelWrite(entry, 'Process ended before input could be written.');
      return false;
    }
    this.inFlightWrite = entry;
    try {
      this.options.onWritePty(entry.payload);
      this.inFlightWrite = undefined;
      if (this.disposed || this.terminal) return false;
      this.resolveSubmission(entry.submissionId);
      if (entry.cardId) {
        this.updateCardDelivery(entry.cardId, 'written');
        if (entry.answerText !== undefined) {
          this.dispatch({ type: 'DECISION_ANSWERED', id: entry.cardId, answerText: entry.answerText });
        }
      }
      return true;
    } catch (error) {
      this.inFlightWrite = undefined;
      if (this.disposed || this.terminal) return false;
      const message = error instanceof Error ? error.message : String(error);
      this.cancelWrite(entry, `Input write failed: ${message}`);
      return false;
    }
  }

  private cancelWrite(entry: PendingPtyWrite, reason: string): void {
    this.resolveSubmission(entry.submissionId);
    if (entry.cardId) this.updateCardDelivery(entry.cardId, 'error', reason);
  }

  private queuedCardIsCurrent(entry: PendingPtyWrite): boolean {
    if (entry.runId !== this.processRun.runId) return false;
    if (!entry.cardId) return true;
    const card = this.narratorState.items.find((item) => item.id === entry.cardId);
    return !!card && (card.kind === 'DecisionCard' || card.kind === 'FailureCard') &&
      card.status === 'pending' && (card.revision ?? 0) === entry.cardRevision;
  }

  public submitUserMessage(text: string, submissionId?: string): void {
    if (this.disposed || this.terminal || !this.claimSubmission(submissionId)) return;
    const timestamp = new Date().toISOString();
    this.dispatch({
      type: 'USER_MESSAGE',
      text,
      timestamp,
    });
    this.sendPtyWrite(text + '\r', { submissionId });
  }

  public selectDecisionOption(index: number): void {
    const focused = this.getFocusedDecision();
    if (focused) {
      this.dispatch({
        type: 'DECISION_SELECTION_CHANGED',
        id: focused.id,
        selectedOptionIndex: index,
      });
    }
  }

  public answerFocusedDecision(freeformText?: string, submission?: DecisionSubmission): void {
    if (this.disposed || this.terminal) return;
    const focused = this.getFocusedDecision();
    if (!focused) {
      return;
    }
    if (submission && submission.decisionId !== focused.id) return;
    if (!this.claimSubmission(submission?.id)) return;

    const write = (payload: string, answerText: string) => this.sendPtyWrite(payload, {
      submissionId: submission?.id,
      cardId: focused.id,
      cardRevision: focused.revision ?? 0,
      answerText,
    });

    const hasFreeform = freeformText !== undefined && freeformText.trim().length > 0;
    const trimmedFreeform = hasFreeform ? freeformText!.trim() : undefined;

    if (focused.kind === 'DecisionCard') {
      if (focused.promptKind === 'ask_question') {
        const K = focused.options.length;
        if (trimmedFreeform !== undefined) {
          const payload = '\x1b[B'.repeat(K) + '\r' + trimmedFreeform + '\r';
          write(payload, trimmedFreeform);
        } else {
          const k = focused.selectedOptionIndex || 1;
          const payload = '\x1b[B'.repeat(k - 1) + '\r';
          const opt = focused.options.find((o) => o.index === k);
          const answerText = opt?.label ?? `Option ${k}`;
          write(payload, answerText);
        }
      } else if (focused.promptKind === 'permission') {
        const k = focused.selectedOptionIndex || 1;
        if (k === 1) {
          write('\x0b', 'Allow');
        } else {
          write('\x1b', "Don't allow");
        }
      } else if (focused.promptKind === 'checkpoint_spec') {
        if (trimmedFreeform !== undefined) {
          write(trimmedFreeform + '\r', trimmedFreeform);
        } else if (focused.selectedOptionIndex === 2) {
          // Open spec overlay without collapsing decision card
          this.options.onOpenOverlay?.('spec');
          this.resolveSubmission(submission?.id);
        } else if (focused.selectedOptionIndex === 1) {
          write('Approve the spec.\r', 'Approve the spec.');
        } else {
          const opt = focused.options.find((o) => o.index === focused.selectedOptionIndex);
          const label = opt?.label ?? 'Request changes to the spec.';
          write(label + '\r', label);
        }
      }
    } else if (focused.kind === 'FailureCard') {
      if (trimmedFreeform !== undefined) {
        write(trimmedFreeform + '\r', trimmedFreeform);
      } else {
        const k = focused.selectedOptionIndex || 1;
        const opt = focused.options.find((o) => o.index === k) ?? focused.options[0];
        if (opt.action === 'retry') {
          write('Retry the blocked task and resolve the error.\r', opt.label);
        } else if (opt.action === 'skip') {
          write('Skip the blocked task and continue with the remaining tasks in the current wave.\r', opt.label);
        } else if (opt.action === 'takeover') {
          this.options.onEnterTakeover?.();
          this.resolveSubmission(submission?.id);
        } else if (opt.action === 'quit') {
          this.options.onRequestQuit?.();
          this.resolveSubmission(submission?.id);
        }
      }
    }
  }

  public deferFocusedDecision(): void {
    const focused = this.getFocusedDecision();
    if (focused) {
      this.dispatch({
        type: 'DECISION_DEFERRED',
        id: focused.id,
      });
    }
  }

  public refocusDeferredDecision(): void {
    this.dispatch({
      type: 'DECISION_REFOCUSED',
    });
  }

  public updateLedger(ledger: SupervisorLedger): void {
    if (this.disposed || this.terminal) return;
    if (ledger.status === this.lastLedgerStatus) {
      return;
    }
    const prevStatus = this.lastLedgerStatus;
    this.lastLedgerStatus = ledger.status;
    const timestamp = new Date().toISOString();
    const snap = this.options.telemetryStore.getSnapshot();
    const branchName = snap?.branch || '';
    const totalElapsedFormatted = formatElapsedHuman(snap?.totalElapsedMs ?? 0);

    this.dispatch({
      type: 'LEDGER_STATUS_CHANGED',
      status: ledger.status,
      prevStatus,
      branchName,
      totalElapsedFormatted,
      timestamp,
    });

    if (ledger.status === 'CHECKPOINT_SPEC') {
      this.dispatchCheckpointSpecPrompt(ledger);
    }
  }

  private dispatchCheckpointSpecPrompt(ledger?: SupervisorLedger): void {
    const timestamp = new Date().toISOString();
    const specPath = ledger?.checkpoints?.spec?.path;
    this.dispatch({
      type: 'TELEMETRY_EVENT',
      event: {
        type: 'DECISION_PROMPT',
        promptKind: 'checkpoint_spec',
        headline: 'Spec review',
        question: 'Do you approve the spec?',
        contextLine: specPath ? `Spec path: ${specPath}` : undefined,
        options: [
          { index: 1, label: 'Approve', recommended: true },
          { index: 2, label: 'Open the spec' },
          { index: 3, label: 'Request changes' },
        ],
        timestamp,
      },
      elapsedFormatted: this.getElapsedFormatted(),
    });
  }

  public handlePtyExit(exitCode: number): void {
    this.handleProcessOutcome({
      runId: this.processRun.runId,
      sessionId: this.processRun.sessionId,
      kind: 'exit',
      exitCode,
      observedAt: new Date().toISOString(),
    });
  }

  public handleProcessOutcome(outcome: ProcessOutcome): void {
    if (this.disposed || outcome.runId !== this.processRun.runId || outcome.sessionId !== this.processRun.sessionId || this.handledOutcomeRunIds.has(outcome.runId)) return;
    this.handledOutcomeRunIds.add(outcome.runId);
    this.processRun.outcome = outcome;
    this.terminal = true;
    this.isPaused = false;
    this.pauseFeedback = 'process_ended';

    const pending = this.pendingPtyWrites;
    this.pendingPtyWrites = [];
    if (this.inFlightWrite) {
      this.cancelWrite(this.inFlightWrite, 'Process ended during an input write; delivery is unknown.');
      this.inFlightWrite = undefined;
    }
    for (const entry of pending) this.cancelWrite(entry, 'Process ended before queued input was written.');
    this.applyEvent({ type: 'PROCESS_OUTCOME', outcome });
  }

  public pause(): void {
    if (this.isPaused || this.disposed || this.terminal) {
      return;
    }
    this.isPaused = true;
    const platform = this.options.platform ?? process.platform;
    if (platform === 'win32') {
      this.pauseFeedback = 'windows_input_only';
    } else {
      const pid = this.options.getPtyPid?.();
      if (typeof pid === 'number' && pid > 0) {
        try {
          process.kill(pid, 'SIGSTOP');
          this.pauseFeedback = 'pause_signal_sent_unconfirmed';
        } catch {
          this.pauseFeedback = 'pause_signal_failed';
        }
      } else {
        this.pauseFeedback = 'pause_signal_unavailable';
      }
    }
    this.notify();
  }

  public resume(): void {
    if (!this.isPaused || this.disposed || this.terminal) {
      return;
    }
    this.isPaused = false;
    const platform = this.options.platform ?? process.platform;
    if (platform !== 'win32') {
      const pid = this.options.getPtyPid?.();
      if (typeof pid === 'number' && pid > 0) {
        try {
          process.kill(pid, 'SIGCONT');
          this.pauseFeedback = 'resume_signal_sent_unconfirmed';
        } catch {
          this.pauseFeedback = 'resume_signal_failed';
        }
      } else {
        this.pauseFeedback = 'resume_signal_unavailable';
      }
    } else {
      this.pauseFeedback = 'active';
    }
    const queued = this.pendingPtyWrites;
    this.pendingPtyWrites = [];
    for (const [index, entry] of queued.entries()) {
      if (this.terminal || this.disposed) {
        for (const remaining of queued.slice(index)) this.cancelWrite(remaining, 'Process ended before queued input was written.');
        break;
      }
      if (!this.queuedCardIsCurrent(entry)) {
        this.cancelWrite(entry, 'Queued response cancelled because its prompt changed or is no longer pending.');
        continue;
      }
      this.deliverPtyWrite(entry);
    }
    this.notify();
  }

  public runSlashCommand(cmd: string): void {
    if (this.disposed || this.terminal) return;
    const trimmed = cmd.trim();
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const parts = normalized.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/spec':
        this.options.onOpenOverlay?.('spec');
        break;
      case '/plan':
        this.options.onOpenOverlay?.('plan');
        break;
      case '/audit':
        this.options.onOpenOverlay?.('audit');
        break;
      case '/raw':
        this.options.onEnterTakeover?.();
        break;
      case '/pause':
        this.pause();
        break;
      case '/resume':
        this.resume();
        break;
      case '/decide':
        this.refocusDeferredDecision();
        break;
      case '/help':
        this.dispatch({
          type: 'APPEND_SUPERVISOR_NOTE',
          text: HELP_TEXT_NOTE,
          timestamp: new Date().toISOString(),
        });
        break;
      case '/quit':
        this.options.onRequestQuit?.();
        break;
    }
  }

  private getElapsedFormatted(): string {
    const snap = this.options.telemetryStore.getSnapshot();
    const ms = snap.subagentElapsedMs || snap.phaseElapsedMs || snap.totalElapsedMs;
    return formatElapsedHuman(ms);
  }

  private getLastErrorLine(): string | null {
    return this.lastErrorLine ?? this.options.telemetryStore.getSnapshot()?.lastErrorLine ?? null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.pendingPtyWrites;
    this.pendingPtyWrites = [];
    if (this.inFlightWrite) {
      this.cancelWrite(this.inFlightWrite, 'Transcript store disposed during an input write; delivery is unknown.');
      this.inFlightWrite = undefined;
    }
    for (const entry of pending) this.cancelWrite(entry, 'Transcript store disposed before queued input was written.');
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const unsub of this.unsubscribes) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.unsubscribes = [];
    this.listeners.clear();
  }
}
