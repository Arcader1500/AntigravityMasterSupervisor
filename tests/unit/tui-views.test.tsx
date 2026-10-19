import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { formatDuration } from '../../src/tui/components/HeaderBar.js';
import { SpecPlanView } from '../../src/tui/components/SpecPlanView.js';
import { AuditLogView } from '../../src/tui/components/AuditLogView.js';
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
