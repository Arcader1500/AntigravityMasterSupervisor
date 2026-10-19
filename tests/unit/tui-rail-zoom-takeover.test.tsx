import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import type { TelemetrySnapshot, PlanTaskItem, AgentStepItem } from '../../src/telemetry/types.js';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';
import {
  TeamRail,
  deriveTeamMembers,
  type TeamMemberRow,
} from '../../src/tui/components/TeamRail.js';
import {
  ZoomView,
  formatAgentStep,
  toCapitalizedWord,
} from '../../src/tui/components/ZoomView.js';
import { TakeoverView } from '../../src/tui/components/TakeoverView.js';

function createMockSnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    branch: 'feat/test',
    dirtyFilesCount: 0,
    totalElapsedMs: 120000,
    phaseElapsedMs: 72000,
    subagentElapsedMs: 72000,
    mainAgent: 'orchestrator',
    pid: 1234,
    activeSubagent: 'implementer',
    lastAction: null,
    lastCommand: null,
    waitingForInput: false,
    specPath: null,
    specContent: null,
    planPath: null,
    planContent: null,
    tasks: [],
    activityFeed: [],
    ptyViewportLines: [],
    ...overrides,
  };
}

describe('deriveTeamMembers', () => {
  it('returns planner, researcher, plan-critic during Planning phase with no plan tasks', () => {
    const snapshot = createMockSnapshot({
      mainAgent: 'planner',
      activeSubagent: null,
      tasks: [],
    });
    const members = deriveTeamMembers(snapshot, 0, false, 'PLANNING');
    expect(members).toHaveLength(3);
    expect(members[0]).toMatchObject({ id: 'planner', role: 'planner', isMain: true, statusText: 'running' });
    expect(members[1]).toMatchObject({ id: 'researcher', role: 'researcher', isMain: false, statusText: 'idle' });
    expect(members[2]).toMatchObject({ id: 'plan-critic', role: 'plan-critic', isMain: false, statusText: 'idle' });
  });

  it('marks active member as paused, needs you when pendingDecisionCount > 0 or waitingForInput', () => {
    const snapshot = createMockSnapshot({
      mainAgent: 'orchestrator',
      activeSubagent: 'implementer',
      waitingForInput: true,
      tasks: [
        { id: 't1', index: 1, title: 'Task 1', status: 'completed' },
        { id: 't2', index: 2, title: 'Task 2', status: 'in_progress' },
      ],
    });
    const members = deriveTeamMembers(snapshot, 1, false, 'EXECUTING');
    const impl = members.find((m) => m.role === 'implementer');
    expect(impl).toBeDefined();
    expect(impl?.statusText).toBe('paused, needs you');
    expect(impl?.needsYou).toBe(true);
  });

  it('populates orchestrator, implementer, code-reviewer, verifier during execution', () => {
    const snapshot = createMockSnapshot({
      mainAgent: 'orchestrator',
      activeSubagent: 'implementer',
      subagentElapsedMs: 72000,
      tasks: [
        { id: 't1', index: 1, title: 'Redis schema', status: 'completed' },
        { id: 't2', index: 2, title: 'Token bucket', status: 'completed' },
        { id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' },
        { id: 't4', index: 4, title: 'Integration tests', status: 'pending' },
        { id: 't5', index: 5, title: 'Review and verify', status: 'pending' },
      ],
    });
    const members = deriveTeamMembers(snapshot, 0, false, 'EXECUTING');
    expect(members).toHaveLength(4);
    expect(members[0].role).toBe('orchestrator');
    expect(members[0].statusText).toBe('running');

    expect(members[1].role).toBe('implementer');
    expect(members[1].taskNumber).toBe(3);
    expect(members[1].elapsedFormatted).toBe('1m 12s');

    expect(members[2].role).toBe('code-reviewer');
    expect(members[2].taskNumber).toBe(2);
    expect(members[2].statusText).toBe('approved');

    expect(members[3].role).toBe('verifier');
    expect(members[3].statusText).toBe('after Task 5');
  });

  it('marks active member as paused when isPaused is true', () => {
    const snapshot = createMockSnapshot({
      activeSubagent: 'implementer',
    });
    const members = deriveTeamMembers(snapshot, 0, true, 'EXECUTING');
    const impl = members.find((m) => m.role === 'implementer');
    expect(impl?.statusText).toBe('paused');
    expect(impl?.needsYou).toBe(false);
  });
});

describe('TeamRail component', () => {
  const unicodeGlyphs = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'linux' });
  const asciiGlyphs = resolveGlyphs({ env: { AGYSUP_ASCII: '1' } });
  const theme = resolveTheme();

  const sampleMembers: TeamMemberRow[] = [
    { id: 'orchestrator', role: 'orchestrator', isMain: true, statusText: 'running', needsYou: false },
    { id: 'implementer', role: 'implementer', isMain: false, taskNumber: 3, statusText: 'running', elapsedFormatted: '1m 12s', needsYou: false },
    { id: 'code-reviewer', role: 'code-reviewer', isMain: false, taskNumber: 2, statusText: 'approved', needsYou: false },
    { id: 'verifier', role: 'verifier', isMain: false, statusText: 'after Task 5', needsYou: false },
  ];

  const sampleTasks: PlanTaskItem[] = [
    { id: 't1', index: 1, title: 'Redis schema', status: 'completed' },
    { id: 't2', index: 2, title: 'Token bucket', status: 'completed' },
    { id: 't3', index: 3, title: 'Route middleware', status: 'in_progress' },
    { id: 't4', index: 4, title: 'Integration tests', status: 'pending' },
    { id: 't5', index: 5, title: 'Review and verify', status: 'pending' },
  ];

  it('renders 32-column rail with Team tree and member details', () => {
    const { lastFrame } = render(
      <TeamRail
        members={sampleMembers}
        tasks={sampleTasks}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Team');
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('├ implementer');
    expect(frame).toContain('Task 3');
    expect(frame).toContain('1m 12s');
    expect(frame).toContain('├ code-reviewer');
    expect(frame).toContain('Task 2');
    expect(frame).toContain('approved');
    expect(frame).toContain('└ verifier');
    expect(frame).toContain('after Task 5');
  });

  it('renders ASCII tree prefixes when ASCII glyphs are resolved', () => {
    const { lastFrame } = render(
      <TeamRail
        members={sampleMembers}
        tasks={sampleTasks}
        glyphs={asciiGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('|- implementer');
    expect(frame).toContain('`- verifier');
  });

  it('renders Tasks list with done/running/pending prefixes and truncates long titles', () => {
    const longTasks: PlanTaskItem[] = [
      ...sampleTasks,
      {
        id: 't6',
        index: 6,
        title: 'Very long task title that exceeds 32 characters in width',
        status: 'pending',
      },
    ];

    const { lastFrame } = render(
      <TeamRail
        members={sampleMembers}
        tasks={longTasks}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Tasks');
    expect(frame).toContain('✓ 1 Redis schema');
    expect(frame).toContain('✓ 2 Token bucket');
    expect(frame).toContain('▸ 3 Route middleware');
    expect(frame).toContain('  4 Integration tests');
    // Truncated title with ellipsis
    expect(frame).toContain('…');
    expect(frame).not.toContain('Very long task title that exceeds 32 characters in width');
  });

  it('renders Tasks appear once the plan is approved during planning phase', () => {
    const planningMembers: TeamMemberRow[] = [
      { id: 'planner', role: 'planner', isMain: true, statusText: 'running', needsYou: false },
      { id: 'researcher', role: 'researcher', isMain: false, statusText: 'idle', needsYou: false },
      { id: 'plan-critic', role: 'plan-critic', isMain: false, statusText: 'idle', needsYou: false },
    ];
    const { lastFrame } = render(
      <TeamRail
        members={planningMembers}
        tasks={[]}
        ledgerStatus="PLANNING"
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('planner');
    expect(frame.replace(/\n\s*/g, ' ')).toContain('Tasks appear once the plan is approved.');
  });

  it('renders checklist items in ZOOM mode when zoomTask is provided', () => {
    const zoomTask: PlanTaskItem = {
      id: 't3',
      index: 3,
      title: 'Route middleware',
      status: 'in_progress',
      checklist: [
        { text: 'Write the failing test', checked: true },
        { text: 'Implement the middleware', checked: true },
        { text: 'Pass the typecheck', checked: false },
        { text: 'Report to the orchestrator', checked: false },
      ],
    };

    const { lastFrame } = render(
      <TeamRail
        members={sampleMembers}
        tasks={sampleTasks}
        zoomTask={zoomTask}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Task 3 checklist from the plan');
    expect(frame).toContain('✓ Write the failing test');
    expect(frame).toContain('✓ Implement the middleware');
    expect(frame).toContain('▸ Pass the typecheck');
    expect(frame).toContain('Report to the orchestrator');
  });

  it('omits Handled for you block when counts are 0, and displays it when > 0', () => {
    const { lastFrame: frameZero } = render(
      <TeamRail
        members={sampleMembers}
        tasks={sampleTasks}
        handledCounts={{ promptsApproved: 0 }}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    expect(frameZero() ?? '').not.toContain('Handled for you');

    const { lastFrame: frameNonZero } = render(
      <TeamRail
        members={sampleMembers}
        tasks={sampleTasks}
        handledCounts={{ promptsApproved: 22 }}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    expect(frameNonZero() ?? '').toContain('Handled for you');
    expect(frameNonZero() ?? '').toContain('22 permission prompts approved');
  });

  it('renders focused selected row and colors needsYou status in ask', () => {
    const membersWithNeedsYou: TeamMemberRow[] = [
      { id: 'orchestrator', role: 'orchestrator', isMain: true, statusText: 'running', needsYou: false },
      { id: 'implementer', role: 'implementer', isMain: false, taskNumber: 3, statusText: 'paused, needs you', needsYou: true },
      { id: 'verifier', role: 'verifier', isMain: false, statusText: 'waiting', needsYou: false },
    ];

    const { lastFrame } = render(
      <TeamRail
        members={membersWithNeedsYou}
        tasks={sampleTasks}
        selectedMemberIndex={1}
        isFocused={true}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('paused, needs you');
    expect(frame).toContain('├ implementer');
  });
});

describe('formatAgentStep helper', () => {
  it('formats read steps with up to 3 targets and extra count for >3', () => {
    const step1: AgentStepItem = {
      id: 's1',
      timestamp: '18:42:10',
      agent: 'implementer',
      kind: 'read',
      targets: ['auth.ts', 'config.ts', 'limiter.test.ts'],
      status: 'ok',
    };
    expect(formatAgentStep(step1, false)).toEqual({
      text: 'Read auth.ts, config.ts and limiter.test.ts',
      tone: 'text',
    });

    const step2: AgentStepItem = {
      id: 's2',
      timestamp: '18:42:10',
      agent: 'implementer',
      kind: 'read',
      targets: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      status: 'ok',
    };
    expect(formatAgentStep(step2, false)).toEqual({
      text: 'Read a.ts, b.ts, c.ts and 2 more',
      tone: 'text',
    });

    const stepRunning: AgentStepItem = {
      ...step1,
      status: 'running',
    };
    expect(formatAgentStep(stepRunning, true)).toEqual({
      text: 'Reading auth.ts, config.ts and limiter.test.ts',
      tone: 'active',
    });
  });

  it('formats write steps with addedLines', () => {
    const step: AgentStepItem = {
      id: 'w1',
      timestamp: '18:42:51',
      agent: 'implementer',
      kind: 'write',
      targets: ['src/middleware/limiter.ts'],
      addedLines: 84,
      status: 'ok',
    };
    expect(formatAgentStep(step, false)).toEqual({
      text: 'Wrote src/middleware/limiter.ts (+84 lines)',
      tone: 'text',
    });

    const stepRunning: AgentStepItem = {
      ...step,
      status: 'running',
    };
    expect(formatAgentStep(stepRunning, true)).toEqual({
      text: 'Writing src/middleware/limiter.ts (+84 lines)',
      tone: 'active',
    });
  });

  it('formats command steps with specialized active verbs and test summary outcomes', () => {
    const tscRunning: AgentStepItem = {
      id: 'c1',
      timestamp: '18:43:22',
      agent: 'implementer',
      kind: 'command',
      command: 'npx tsc --noEmit -p tsconfig.json',
      status: 'running',
    };
    expect(formatAgentStep(tscRunning, true)).toEqual({
      text: 'Running the typecheck',
      tone: 'active',
    });

    const testRunning: AgentStepItem = {
      id: 'c2',
      timestamp: '18:43:22',
      agent: 'implementer',
      kind: 'command',
      command: 'npm test',
      status: 'running',
    };
    expect(formatAgentStep(testRunning, true)).toEqual({
      text: 'Running tests',
      tone: 'active',
    });

    const testFinished: AgentStepItem = {
      id: 'c3',
      timestamp: '18:43:05',
      agent: 'implementer',
      kind: 'command',
      command: 'npm test',
      exitCode: 0,
      testSummary: { passed: 14, failed: 0 },
      status: 'ok',
    };
    expect(formatAgentStep(testFinished, false)).toEqual({
      text: 'Ran npm test: 14 passed, 0 failed',
      tone: 'text',
    });

    const failedCommand: AgentStepItem = {
      id: 'c4',
      timestamp: '18:43:05',
      agent: 'implementer',
      kind: 'command',
      command: 'npm test',
      exitCode: 1,
      status: 'failed',
    };
    expect(formatAgentStep(failedCommand, false)).toEqual({
      text: 'Ran npm test: failed (exit 1)',
      tone: 'ask',
    });
  });

  it('formats mcp tool queries', () => {
    const mcpRunning: AgentStepItem = {
      id: 'm1',
      timestamp: '18:40:00',
      agent: 'researcher',
      kind: 'mcp',
      mcpQuery: 'TokenBucket',
      status: 'running',
    };
    expect(formatAgentStep(mcpRunning, true)).toEqual({
      text: 'Looking up TokenBucket in the code graph',
      tone: 'active',
    });

    const mcpDone: AgentStepItem = {
      ...mcpRunning,
      status: 'ok',
    };
    expect(formatAgentStep(mcpDone, false)).toEqual({
      text: 'Looked up TokenBucket in the code graph',
      tone: 'text',
    });
  });
});

describe('ZoomView component', () => {
  const unicodeGlyphs = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'linux' });
  const theme = resolveTheme();

  const steps: AgentStepItem[] = [
    {
      id: 's1',
      timestamp: '18:42:10',
      agent: 'implementer',
      kind: 'read',
      targets: ['auth.ts', 'config.ts', 'limiter.test.ts'],
      status: 'ok',
    },
    {
      id: 's2',
      timestamp: '18:42:51',
      agent: 'implementer',
      kind: 'write',
      targets: ['src/middleware/limiter.ts'],
      addedLines: 84,
      status: 'ok',
    },
    {
      id: 's3',
      timestamp: '18:43:05',
      agent: 'implementer',
      kind: 'command',
      command: 'npm test',
      exitCode: 0,
      testSummary: { passed: 14, failed: 0 },
      status: 'ok',
    },
    {
      id: 's4',
      timestamp: '18:43:22',
      agent: 'implementer',
      kind: 'command',
      command: 'npx tsc --noEmit -p tsconfig.json',
      status: 'running',
    },
  ];

  const ptyLines = [
    'info: compiling project...',
    '$ tsc --noEmit -p tsconfig.json',
    '',
  ];

  it('renders summary card with task title, start timer, number word steps and nothing failed', () => {
    const { lastFrame } = render(
      <ZoomView
        role="implementer"
        taskTitle="Route middleware"
        taskNumber={3}
        elapsedFormatted="1m 12s"
        steps={steps}
        ptyLines={ptyLines}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▸ Route middleware');
    expect(frame).toContain('Started 1m 12s ago. Four steps so far, nothing failed.');
    expect(frame).toContain('18:42:10');
    expect(frame).toContain('Read auth.ts, config.ts and limiter.test.ts');
    expect(frame).toContain('Wrote src/middleware/limiter.ts (+84 lines)');
    expect(frame).toContain('Ran npm test: 14 passed, 0 failed');
    expect(frame).toContain('Running the typecheck');
    expect(frame).toContain('Raw output, last lines');
    expect(frame).toContain('$ tsc --noEmit -p tsconfig.json');
  });

  it('notes main agent steps when isSharedStream is true', () => {
    const { lastFrame } = render(
      <ZoomView
        role="orchestrator"
        elapsedFormatted="5m 00s"
        steps={steps.slice(0, 2)}
        ptyLines={ptyLines}
        isSharedStream={true}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Main agent steps are shown.');
  });

  it('formats capitalized number words helper', () => {
    expect(toCapitalizedWord(0)).toBe('Zero');
    expect(toCapitalizedWord(1)).toBe('One');
    expect(toCapitalizedWord(4)).toBe('Four');
    expect(toCapitalizedWord(9)).toBe('Nine');
    expect(toCapitalizedWord(12)).toBe('12');
  });

  it('displays failed count when steps have failed status', () => {
    const stepsWithFailures: AgentStepItem[] = [
      { id: '1', timestamp: '10:00:00', agent: 'impl', kind: 'command', command: 'npm test', status: 'failed', exitCode: 1 },
      { id: '2', timestamp: '10:01:00', agent: 'impl', kind: 'command', command: 'npm test', status: 'failed', exitCode: 1 },
    ];
    const { lastFrame } = render(
      <ZoomView
        role="implementer"
        elapsedFormatted="2m 00s"
        steps={stepsWithFailures}
        ptyLines={[]}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Two steps so far, 2 failed.');
  });

  it('clamps scrollOffset to steps.length - 1 to avoid blanking steps', () => {
    const { lastFrame } = render(
      <ZoomView
        role="implementer"
        elapsedFormatted="1m 00s"
        steps={steps}
        scrollOffset={999}
        ptyLines={[]}
        glyphs={unicodeGlyphs}
        theme={theme}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ran npx tsc --noEmit -p tsconfig.json: ok');
    expect(frame).not.toContain('Read auth.ts');
  });
});

describe('TakeoverView component', () => {
  const theme = resolveTheme();

  it('renders the one-line ask banner and terminal lines without navigation banners', () => {
    const lines = [
      'Line 1 of PTY output',
      'Line 2 of PTY output',
      'Line 3 of PTY output',
    ];

    const { lastFrame } = render(
      <TakeoverView lines={lines} theme={theme} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain("You are typing into the agent's terminal. Press Ctrl+] to return.");
    expect(frame).toContain('Line 1 of PTY output');
    expect(frame).toContain('Line 2 of PTY output');
    expect(frame).toContain('Line 3 of PTY output');
    expect(frame).not.toContain('● PTY INTERACT');
    expect(frame).not.toContain('○ NAVIGATION');
    expect(frame).not.toContain('[NAVIGATION MODE]');
  });

  it('renders placeholder when terminal lines are empty', () => {
    const { lastFrame } = render(
      <TakeoverView lines={[]} theme={theme} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(No terminal output yet)');
  });

  it('slices terminal output to maxRows', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Output line ${i + 1}`);
    const { lastFrame } = render(
      <TakeoverView lines={lines} maxRows={5} theme={theme} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Output line 30');
    expect(frame).toContain('Output line 26');
    expect(frame).not.toContain('Output line 25');
  });
});
