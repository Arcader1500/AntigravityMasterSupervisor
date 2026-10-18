import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar, formatDuration } from '../../src/tui/components/HeaderBar.js';
import { FooterBar } from '../../src/tui/components/FooterBar.js';
import { MainStatusView } from '../../src/tui/components/MainStatusView.js';
import { SpecPlanView } from '../../src/tui/components/SpecPlanView.js';
import { AuditLogView } from '../../src/tui/components/AuditLogView.js';
import type { TelemetrySnapshot } from '../../src/telemetry/types.js';
import type { SupervisorLedger } from '../../src/core/types.js';

describe('formatDuration helper', () => {
  it('formats zero or negative durations', () => {
    expect(formatDuration(0)).toBe('00m 00s');
    expect(formatDuration(-100)).toBe('00m 00s');
  });

  it('formats seconds and minutes correctly', () => {
    expect(formatDuration(65000)).toBe('01m 05s');
    expect(formatDuration(255000)).toBe('04m 15s');
  });

  it('formats hours correctly when duration exceeds 60 minutes', () => {
    expect(formatDuration(3665000)).toBe('01h 01m 05s');
  });
});

describe('HeaderBar component', () => {
  it('renders HeaderBar with branch, elapsed time, and waiting prompt indicator', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/tui"
        totalElapsedMs={65000}
        status="EXECUTING"
        inputMode="NAVIGATION"
        waitingForInput={true}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('feat/tui');
    expect(frame).toContain('01m 05s');
    expect(frame).toContain('EXECUTING');
    expect(frame).toContain('NAV');
    expect(frame).toContain('INPUT');
  });

  it('renders HeaderBar with PTY INTERACT mode badge and no waiting alert when false', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="main"
        totalElapsedMs={120000}
        status="RUNNING"
        inputMode="PTY_INTERACT"
        waitingForInput={false}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('main');
    expect(frame).toContain('02m 00s');
    expect(frame).toContain('PTY INTERACT');
    expect(frame).not.toContain('WAITING FOR INPUT');
  });
});

describe('FooterBar component', () => {
  it('renders navigation tabs and marks active panel in NAVIGATION mode', () => {
    const { lastFrame } = render(
      <FooterBar activePanel={1} inputMode="NAVIGATION" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[1] Main Status');
    expect(frame).toContain('[2] Live PTY');
    expect(frame).toContain('[3] Spec & Plan');
    expect(frame).toContain('[4] Audit Log');
  });

  it('renders FooterBar context legend for PTY_INTERACT mode', () => {
    const { lastFrame } = render(
      <FooterBar activePanel={2} inputMode="PTY_INTERACT" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ctrl+]');
    expect(frame).toContain('PTY INTERACT LOCKED');
  });

  it('renders activeDoc tab indicator when activePanel is 3', () => {
    const { lastFrame } = render(
      <FooterBar activePanel={3} inputMode="NAVIGATION" activeDoc="spec" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[s] Spec');
    expect(frame).toContain('[p] Plan');
  });
});

describe('MainStatusView component', () => {
  const mockSnapshot: TelemetrySnapshot = {
    branch: 'feat/test',
    dirtyFilesCount: 2,
    totalElapsedMs: 300000,
    phaseElapsedMs: 255000,
    subagentElapsedMs: 72000,
    mainAgent: 'orchestrator',
    pid: 18492,
    activeSubagent: 'implementer',
    lastAction: 'edit_file -> src/limiter.ts',
    lastCommand: 'vitest run tests/limiter.test.ts',
    waitingForInput: false,
    specPath: 'docs/superpowers/specs/feature-spec.md',
    specContent: '# Spec',
    planPath: 'docs/superpowers/plans/feature-plan.md',
    planContent: '# Plan',
    tasks: [
      { id: '1', title: 'Task 1: Setup schema', status: 'completed', commitSha: 'a1b2c3d' },
      { id: '2', title: 'Task 2: Implement logic', status: 'in_progress' },
      { id: '3', title: 'Task 3: Add integration tests', status: 'pending' },
    ],
    activityFeed: [
      { id: '1', timestamp: '14:28:10', actor: 'ORCH', message: 'Dispatched implementer' },
      { id: '2', timestamp: '14:28:24', actor: 'IMPL', message: 'Read src/routes.ts' },
    ],
    ptyViewportLines: [],
  };

  it('renders currently running agent, subagent, pid, elapsed times, last action and last command', () => {
    const { lastFrame } = render(<MainStatusView snapshot={mockSnapshot} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('18492');
    expect(frame).toContain('implementer');
    expect(frame).toContain('04m 15s');
    expect(frame).toContain('01m 12s');
    expect(frame).toContain('edit_file -> src/limiter.ts');
    expect(frame).toContain('vitest run tests/limiter.test.ts');
  });

  it('renders pipeline task list with appropriate status icons', () => {
    const { lastFrame } = render(<MainStatusView snapshot={mockSnapshot} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[✓]');
    expect(frame).toContain('Task 1: Setup schema');
    expect(frame).toContain('a1b2c3d');
    expect(frame).toContain('[▶]');
    expect(frame).toContain('Task 2: Implement logic');
    expect(frame).toContain('[ ]');
    expect(frame).toContain('Task 3: Add integration tests');
  });

  it('renders clean activity feed items with timestamp and actor', () => {
    const { lastFrame } = render(<MainStatusView snapshot={mockSnapshot} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14:28:10');
    expect(frame).toContain('[ORCH]');
    expect(frame).toContain('Dispatched implementer');
    expect(frame).toContain('14:28:24');
    expect(frame).toContain('[IMPL]');
    expect(frame).toContain('Read src/routes.ts');
  });

  it('formats ISO timestamps to compact HH:MM:SS format in activity feed', () => {
    const isoSnapshot: TelemetrySnapshot = {
      ...mockSnapshot,
      activityFeed: [
        {
          id: 'iso-1',
          timestamp: '2026-10-18T14:28:10.123Z',
          actor: 'GIT',
          message: 'Commit 123456: Fix bug',
        },
      ],
    };
    const { lastFrame } = render(<MainStatusView snapshot={isoSnapshot} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14:28:10');
    expect(frame).not.toContain('2026-10-18T');
    expect(frame).toContain('[GIT]');
    expect(frame).toContain('Commit 123456: Fix bug');
  });

  it('handles empty task list and empty feed gracefully', () => {
    const emptySnapshot: TelemetrySnapshot = {
      ...mockSnapshot,
      tasks: [],
      activityFeed: [],
      activeSubagent: null,
      lastAction: null,
      lastCommand: null,
      pid: undefined,
    };
    const { lastFrame } = render(<MainStatusView snapshot={emptySnapshot} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('None');
  });
});

describe('SpecPlanView component', () => {
  it('renders active spec markdown document sliced by scrollOffset and maxRows', () => {
    const content = ['# Spec Title', '## Section 1', 'Line A', 'Line B', 'Line C'].join('\n');
    const { lastFrame } = render(
      <SpecPlanView
        specPath="docs/superpowers/specs/feature-spec.md"
        specContent={content}
        planPath="docs/superpowers/plans/feature-plan.md"
        planContent="# Plan Title"
        activeDoc="spec"
        scrollOffset={1}
        maxRows={2}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('feature-spec.md');
    expect(frame).toContain('## Section 1');
    expect(frame).toContain('Line A');
    expect(frame).not.toContain('Line C');
  });

  it('renders active plan document when activeDoc is plan', () => {
    const { lastFrame } = render(
      <SpecPlanView
        specPath="docs/superpowers/specs/feature-spec.md"
        specContent="# Spec Title"
        planPath="docs/superpowers/plans/feature-plan.md"
        planContent="Task 1: Setup test"
        activeDoc="plan"
        scrollOffset={0}
        maxRows={10}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('feature-plan.md');
    expect(frame).toContain('Task 1: Setup test');
  });

  it('renders helpful empty state when document is null', () => {
    const { lastFrame } = render(
      <SpecPlanView
        specPath={null}
        specContent={null}
        planPath={null}
        planContent={null}
        activeDoc="spec"
        scrollOffset={0}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docs/superpowers/specs/');
    expect(frame).toContain('No active spec');
  });
});

describe('AuditLogView component', () => {
  const mockLedger: SupervisorLedger = {
    version: '1.0.0',
    sessionId: 'session-xyz-123',
    projectPath: 'D:/Code/Project',
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T10:30:00Z',
    status: 'EXECUTING',
    activeAgent: 'orchestrator',
    checkpoints: {
      spec: { status: 'APPROVED', path: 'docs/superpowers/specs/spec.md' },
      plan: { status: 'PENDING', path: 'docs/superpowers/plans/plan.md' },
    },
    events: [
      { timestamp: '10:00:01', level: 'INFO', message: 'Ledger initialized' },
      { timestamp: '10:05:00', level: 'WARN', message: 'Lint warning encountered' },
      { timestamp: '10:10:00', level: 'ERROR', message: 'Process exited abnormally' },
    ],
  };

  it('renders session id, status, active agent, and checkpoints', () => {
    const { lastFrame } = render(<AuditLogView ledger={mockLedger} scrollOffset={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('session-xyz-123');
    expect(frame).toContain('EXECUTING');
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('APPROVED');
    expect(frame).toContain('PENDING');
  });

  it('renders ledger events sliced by scrollOffset and maxRows', () => {
    const { lastFrame } = render(
      <AuditLogView ledger={mockLedger} scrollOffset={1} maxRows={1} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Lint warning encountered');
    expect(frame).not.toContain('Ledger initialized');
    expect(frame).not.toContain('Process exited abnormally');
  });

  it('handles empty event list gracefully', () => {
    const emptyLedger: SupervisorLedger = {
      ...mockLedger,
      events: [],
    };
    const { lastFrame } = render(<AuditLogView ledger={emptyLedger} scrollOffset={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('session-xyz-123');
    expect(frame).toContain('No audit events');
  });
});
