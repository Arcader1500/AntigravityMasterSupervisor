import { describe, expect, it } from 'vitest';
import type { SupervisorLedger } from '../../src/core/types.js';
import type { TelemetrySnapshot } from '../../src/telemetry/types.js';
import { deriveProcessPresentation } from '../../src/tui/process-presentation.js';

function ledger(status: SupervisorLedger['status'], events: SupervisorLedger['events'] = []): SupervisorLedger {
  return {
    version: '1.0.0', sessionId: 'session', projectPath: '.', createdAt: '', updatedAt: '',
    status, activeAgent: null,
    checkpoints: { spec: { status: 'UNINITIALIZED' }, plan: { status: 'UNINITIALIZED' } },
    events,
  };
}

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    branch: 'main', dirtyFilesCount: 0, totalElapsedMs: 0, phaseElapsedMs: 0,
    subagentElapsedMs: 0, mainAgent: 'orchestrator', pid: undefined, activeSubagent: null,
    lastAction: null, lastCommand: null, waitingForInput: false, specPath: null,
    specContent: null, planPath: null, planContent: null, tasks: [], activityFeed: [],
    ptyViewportLines: [], ...overrides,
  };
}

describe('deriveProcessPresentation', () => {
  it('keeps legacy COMPLETED readable without presenting verified success', () => {
    const view = deriveProcessPresentation(ledger('COMPLETED'));
    expect(view.legacyCompleted).toBe(true);
    expect(view.outcomeText).toContain('Legacy ledger status: COMPLETED');
    expect(view.reviewText).toMatch(/unconfirmed/);
    expect(view.outcomeText).not.toMatch(/checks passed|verified/i);
  });

  it('distinguishes initial IDLE from a known process outcome and names the source', () => {
    const view = deriveProcessPresentation(ledger('IDLE'), snapshot({ phaseSource: 'ledger' }));
    expect(view.outcomeText).toContain('may not have started');
    expect(view.sourceText).toContain('recorded ledger');
  });

  it('reports exit zero without implying review, verification, or task completion', () => {
    const view = deriveProcessPresentation(ledger('IDLE'), snapshot({
      processOutcome: { runId: 'r', sessionId: 'session', kind: 'exit', exitCode: 0, observedAt: 'now' },
      processOutcomeSource: 'ledger',
    }));
    expect(view.outcomeText).toBe('Agent process exited with code 0');
    expect(view.sourceText).toContain('recorded ledger');
    expect(view.reviewText).toContain('unconfirmed');
  });

  it('attributes task progress to its artifact provenance rather than unrelated phase source', () => {
    const view = deriveProcessPresentation(ledger('EXECUTING'), snapshot({
      phaseSource: 'agent_output',
      tasks: [
        { id: 'one', index: 1, title: 'A', status: 'completed' },
        { id: 'two', index: 2, title: 'B', status: 'in_progress' },
      ],
    }));
    expect(view.sourceText).toContain('agent output');
    expect(view.progressText).toContain('1 of 2 tasks are recorded complete in artifacts progress');
    expect(view.progressText).toMatch(/does not establish review or verification/);
    expect(view.progressKind).toBe('recorded');
  });

  it('does not label artifact task counts as agent-reported based on phase source', () => {
    const view = deriveProcessPresentation(ledger('EXECUTING'), snapshot({
      phaseSource: 'agent_output',
      tasks: [{ id: 'one', index: 1, title: 'A', status: 'completed' }],
    }));
    expect(view.progressKind).toBe('recorded');
    expect(view.progressText).toContain('1 of 1 tasks are recorded complete in artifacts progress');
  });

  it('keeps an exit without code or signal unknown', () => {
    const view = deriveProcessPresentation(ledger('IDLE'), snapshot({
      processOutcome: { runId: 'r', sessionId: 'session', kind: 'exit', observedAt: 'now' },
      processOutcomeSource: 'ledger',
    }));
    expect(view.outcomeText).toContain('termination is unknown');
    expect(view.outcomeText).not.toContain('code 0');
  });

  it('uses a ledger-only recorded exit zero when no telemetry snapshot is available', () => {
    const view = deriveProcessPresentation(ledger('IDLE', [{
      timestamp: '2026-10-24T10:00:00Z', level: 'INFO', message: 'Agent process exited with code 0',
      metadata: { kind: 'PROCESS_OUTCOME', runId: 'run-1', sessionId: 'session', outcomeKind: 'exit', exitCode: 0 },
    }]));
    expect(view.outcomeText).toBe('Agent process exited with code 0');
    expect(view.sourceText).toBe('Source: recorded ledger.');
    expect(view.legacyCompleted).toBe(false);
  });

  it('uses a ledger-only exit without numeric details as unknown', () => {
    const view = deriveProcessPresentation(ledger('IDLE', [{
      timestamp: '2026-10-24T10:00:00Z', level: 'WARN', message: 'Agent process terminated',
      metadata: { kind: 'PROCESS_OUTCOME', runId: 'run-1', sessionId: 'session', outcomeKind: 'exit' },
    }]));
    expect(view.outcomeText).toContain('termination is unknown');
    expect(view.outcomeText).not.toContain('code 0');
  });

  it('does not resurrect an older snapshot outcome after a newer ledger process start', () => {
    const view = deriveProcessPresentation(ledger('IDLE', [
      { timestamp: '2026-10-24T10:00:00Z', level: 'INFO', message: 'Started', metadata: { kind: 'PROCESS_STARTED', runId: 'run-1', sessionId: 'session' } },
      { timestamp: '2026-10-24T10:01:00Z', level: 'INFO', message: 'Exited zero', metadata: { kind: 'PROCESS_OUTCOME', runId: 'run-1', sessionId: 'session', outcomeKind: 'exit', exitCode: 0 } },
      { timestamp: '2026-10-24T10:02:00Z', level: 'INFO', message: 'Started again', metadata: { kind: 'PROCESS_STARTED', runId: 'run-2', sessionId: 'session' } },
    ]), snapshot({ processOutcome: { runId: 'run-1', sessionId: 'session', kind: 'exit', exitCode: 0, observedAt: '2026-10-24T10:01:00Z' } }));
    expect(view.outcomeText).toContain('Process start recorded for run run-2');
    expect(view.outcomeText).not.toContain('code 0');
    expect(view.legacyCompleted).toBe(false);
  });
});
