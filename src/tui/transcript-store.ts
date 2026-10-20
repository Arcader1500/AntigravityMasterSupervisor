import type { TelemetryEvent, PlanTaskItem } from '../telemetry/types.js';
import type { TelemetryStore } from '../telemetry/store.js';
import type { TelemetryParser } from '../telemetry/parser.js';
import type { SupervisorLedger } from '../core/types.js';
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
  onWritePty: (data: string) => void;
  onRingBell?: () => void;
  onEnterTakeover?: () => void;
  onOpenOverlay?: (overlay: 'spec' | 'plan' | 'audit' | 'raw') => void;
  onRequestQuit?: () => void;
  getPtyPid?: () => number | undefined;
  platform?: NodeJS.Platform;
}

export interface TranscriptStoreSnapshot {
  narrator: NarratorState;
  items: TranscriptItem[];
  hasStarted: boolean;
  isPaused: boolean;
  pendingDecisionCount: number;
  focusedDecision: Extract<TranscriptItem, { kind: 'DecisionCard' | 'FailureCard' }> | null;
  handledCounts: {
    promptsApproved: number;
    questionsAnswered?: number;
    planFixes?: number;
  };
}

export class TranscriptStore {
  private options: TranscriptStoreOptions;
  private narratorState: NarratorState;
  private isPaused: boolean = false;
  private pendingPtyWrites: string[] = [];
  private rungBellCardIds: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();
  private unsubscribes: Array<() => void> = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private lastLedgerStatus: string = 'IDLE';
  private lastSeenCommitSha: string | null = null;
  private lastErrorLine: string | null = null;

  constructor(options: TranscriptStoreOptions) {
    this.options = options;
    this.narratorState = createInitialNarratorState();

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
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in TranscriptStore listener:', err);
      }
    }
  }

  public dispatch(event: NarratorInputEvent): void {
    if (this.isPaused && event.type === 'TICK_ELAPSED') {
      return;
    }
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
      pendingDecisionCount: this.narratorState.pendingDecisionCount,
      focusedDecision: this.getFocusedDecision(),
      handledCounts: this.getHandledCounts(),
    };
  }

  public getFocusedDecision(): Extract<TranscriptItem, { kind: 'DecisionCard' | 'FailureCard' }> | null {
    for (const item of this.narratorState.items) {
      if (item.kind === 'DecisionCard' && item.status === 'pending') {
        return item;
      }
      if (item.kind === 'FailureCard' && item.status === 'pending') {
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

  private writePty(data: string): void {
    if (this.isPaused) {
      this.pendingPtyWrites.push(data);
    } else {
      this.options.onWritePty(data);
    }
  }

  public submitUserMessage(text: string): void {
    const timestamp = new Date().toISOString();
    this.dispatch({
      type: 'USER_MESSAGE',
      text,
      timestamp,
    });
    this.writePty(text + '\r');
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

  public answerFocusedDecision(freeformText?: string): void {
    const focused = this.getFocusedDecision();
    if (!focused) {
      return;
    }

    const hasFreeform = freeformText !== undefined && freeformText.trim().length > 0;
    const trimmedFreeform = hasFreeform ? freeformText!.trim() : undefined;

    if (focused.kind === 'DecisionCard') {
      if (focused.promptKind === 'ask_question') {
        const K = focused.options.length;
        if (trimmedFreeform !== undefined) {
          const payload = '\x1b[B'.repeat(K) + '\r' + trimmedFreeform + '\r';
          this.writePty(payload);
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: trimmedFreeform,
          });
        } else {
          const k = focused.selectedOptionIndex || 1;
          const payload = '\x1b[B'.repeat(k - 1) + '\r';
          this.writePty(payload);
          const opt = focused.options.find((o) => o.index === k);
          const answerText = opt?.label ?? `Option ${k}`;
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText,
          });
        }
      } else if (focused.promptKind === 'permission') {
        const k = focused.selectedOptionIndex || 1;
        if (k === 1) {
          this.writePty('\x0b');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: 'Allow',
          });
        } else {
          this.writePty('\x1b');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: "Don't allow",
          });
        }
      } else if (focused.promptKind === 'checkpoint_spec') {
        if (trimmedFreeform !== undefined) {
          this.writePty(trimmedFreeform + '\r');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: trimmedFreeform,
          });
        } else if (focused.selectedOptionIndex === 2) {
          // Open spec overlay without collapsing decision card
          this.options.onOpenOverlay?.('spec');
        } else if (focused.selectedOptionIndex === 1) {
          this.writePty('Approve the spec.\r');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: 'Approve the spec.',
          });
        } else {
          const opt = focused.options.find((o) => o.index === focused.selectedOptionIndex);
          const label = opt?.label ?? 'Request changes to the spec.';
          this.writePty(label + '\r');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: label,
          });
        }
      }
    } else if (focused.kind === 'FailureCard') {
      if (trimmedFreeform !== undefined) {
        this.writePty(trimmedFreeform + '\r');
        this.dispatch({
          type: 'DECISION_ANSWERED',
          id: focused.id,
          answerText: trimmedFreeform,
        });
      } else {
        const k = focused.selectedOptionIndex || 1;
        const opt = focused.options.find((o) => o.index === k) ?? focused.options[0];
        if (opt.action === 'retry') {
          this.writePty('Retry the blocked task and resolve the error.\r');
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: opt.label,
          });
        } else if (opt.action === 'skip') {
          this.writePty(
            'Skip the blocked task and continue with the remaining tasks in the current wave.\r'
          );
          this.dispatch({
            type: 'DECISION_ANSWERED',
            id: focused.id,
            answerText: opt.label,
          });
        } else if (opt.action === 'takeover') {
          this.options.onEnterTakeover?.();
        } else if (opt.action === 'quit') {
          this.options.onRequestQuit?.();
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
    if (exitCode === 0) {
      return;
    }
    const lastErrorLine = this.getLastErrorLine();
    this.dispatch({
      type: 'PTY_EXITED',
      exitCode,
      lastErrorLine,
      timestamp: new Date().toISOString(),
    });
  }

  public pause(): void {
    if (this.isPaused) {
      return;
    }
    this.isPaused = true;
    const platform = this.options.platform ?? process.platform;
    if (platform !== 'win32') {
      const pid = this.options.getPtyPid?.();
      if (typeof pid === 'number' && pid > 0) {
        try {
          process.kill(pid, 'SIGSTOP');
        } catch {
          // ignore signal delivery errors
        }
      }
    }
    this.notify();
  }

  public resume(): void {
    if (!this.isPaused) {
      return;
    }
    this.isPaused = false;
    const platform = this.options.platform ?? process.platform;
    if (platform !== 'win32') {
      const pid = this.options.getPtyPid?.();
      if (typeof pid === 'number' && pid > 0) {
        try {
          process.kill(pid, 'SIGCONT');
        } catch {
          // ignore signal delivery errors
        }
      }
    }
    const queued = [...this.pendingPtyWrites];
    this.pendingPtyWrites = [];
    for (const data of queued) {
      try {
        this.options.onWritePty(data);
      } catch {
        // ignore write error
      }
    }
    this.notify();
  }

  public runSlashCommand(cmd: string): void {
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
