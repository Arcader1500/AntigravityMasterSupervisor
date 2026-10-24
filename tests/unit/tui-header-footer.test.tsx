import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  HeaderBar,
  formatCompactTimer,
  formatDuration,
} from '../../src/tui/components/HeaderBar.js';
import { FooterBar } from '../../src/tui/components/FooterBar.js';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';

describe('formatCompactTimer helper', () => {
  it('formats zero or negative durations as 00:00', () => {
    expect(formatCompactTimer(0)).toBe('00:00');
    expect(formatCompactTimer(-500)).toBe('00:00');
    expect(formatCompactTimer(NaN)).toBe('00:00');
  });

  it('formats MM:SS correctly when under 60 minutes', () => {
    expect(formatCompactTimer(65000)).toBe('01:05');
    expect(formatCompactTimer(402000)).toBe('06:42');
    expect(formatCompactTimer(3599000)).toBe('59:59');
  });

  it('formats HH:MM:SS correctly when at or exceeding 60 minutes', () => {
    expect(formatCompactTimer(3600000)).toBe('01:00:00');
    expect(formatCompactTimer(4002000)).toBe('01:06:42');
  });
});

describe('HeaderBar conversational component', () => {
  const unicodeGlyphs = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'linux' });

  it('renders bold agysup wordmark, branch name, phase strip, and compact elapsed timer', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        specApproved={true}
        planApproved={true}
        currentWave={2}
        totalWaves={3}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('agysup');
    expect(frame).toContain('feat/rate-limit');
    expect(frame).toContain('Spec recorded  Plan recorded  Build  Verify  (recorded ledger)');
    expect(frame).toContain('06:42');
  });

  it('renders breadcrumb in ZOOM mode instead of the phase strip', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        zoomTarget={{ role: 'implementer', taskNumber: 3 }}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('agysup');
    expect(frame).toContain('Team / implementer, Task 3');
    expect(frame).not.toContain('Spec');
    expect(frame).not.toContain('Build');
    expect(frame).toContain('06:42');
  });

  it('renders breadcrumb without task number when not provided in ZOOM mode', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        zoomTarget={{ role: 'orchestrator' }}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Team / orchestrator');
  });

  it('renders legacy COMPLETED without claiming verified done', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        status="COMPLETED"
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Legacy ledger status COMPLETED');
    expect(frame).toContain('Source: recorded ledger.');
    expect(frame).toContain('unconfirmed');
    expect(frame).not.toContain('Done');
    expect(frame).not.toContain('Verify ✓');
  });

  it('renders 1 needs you badge when pendingDecisionCount is 1 in color and monochrome', () => {
    const colorTheme = resolveTheme({ colorLevel: 3 });
    const { lastFrame: colorFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        pendingDecisionCount={1}
        theme={colorTheme}
        glyphs={unicodeGlyphs}
      />
    );
    expect(colorFrame() ?? '').toContain('1 needs you');

    const monoTheme = resolveTheme({ env: { NO_COLOR: '1' } });
    const { lastFrame: monoFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        pendingDecisionCount={1}
        theme={monoTheme}
        glyphs={unicodeGlyphs}
      />
    );
    expect(monoFrame() ?? '').toContain('1 needs you');
  });

  it('renders Paused badge when isPaused is true', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        totalElapsedMs={402000}
        isPaused={true}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Paused');
  });

  it('renders Spec as the only active phase on a fresh PLANNING session before spec approval', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        status="PLANNING"
        specApproved={false}
        planApproved={false}
        totalTasks={0}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Spec ▸  Plan  Build  Verify');
  });

  it('keeps Spec and Build phases mutually exclusive during EXECUTING without approvals or tasks', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/rate-limit"
        status="EXECUTING"
        specApproved={false}
        planApproved={false}
        totalTasks={0}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Build ▸');
  });

  it('attributes an artifact-inferred execution phase to artifacts', () => {
    const { lastFrame } = render(
      <HeaderBar status="EXECUTING" phaseSource="artifacts" specApproved={false} planApproved={false} />
    );
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/Build [>▸] \(phase inferred from artifacts\)/);
    expect(frame).not.toContain('(recorded ledger)');
  });

  it('preserves legacy HeaderBar output when only legacy props are passed', () => {
    const { lastFrame } = render(
      <HeaderBar
        branch="feat/legacy"
        totalElapsedMs={65000}
        status="EXECUTING"
        inputMode="NAVIGATION"
        waitingForInput={true}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('🚀 AGY SUPERVISOR');
    expect(frame).toContain('feat/legacy');
    expect(frame).toContain('01m 05s');
    expect(frame).toContain('NAV');
    expect(frame).toContain('WAITING FOR INPUT');
  });

  it('keeps compatibility HeaderBar COMPLETED neutral', () => {
    const { lastFrame } = render(<HeaderBar status="COMPLETED" inputMode="NAVIGATION" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('COMPLETED (legacy,');
    expect(frame).toContain('unverified)');
    expect(frame).not.toContain('Done');
  });
});

describe('FooterBar conversational component', () => {
  it('renders default CHAT hints with zero tab pills', () => {
    const { lastFrame } = render(<FooterBar mode="CHAT" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Tab team   Enter open agent   /pause queues input');
    expect(frame).toContain('attempts a POSIX child signal');
    expect(frame).not.toContain('[1]');
    expect(frame).not.toContain('[2]');
    expect(frame).not.toContain('[3]');
    expect(frame).not.toContain('[4]');
  });

  it('renders CHAT hints when paused with /resume leading hint', () => {
    const { lastFrame } = render(<FooterBar mode="CHAT" isPaused={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Paused: signal status unavailable; input is queued.');
    expect(frame).toContain('/resume');
    expect(frame).not.toContain('[1]');
  });

  it.each([
    ['windows_input_only', 'Paused: Windows queues input'],
    ['pause_signal_failed', 'Paused: POSIX child signal failed'],
    ['pause_signal_unavailable', 'Paused: POSIX child signal unavailable'],
    ['pause_signal_sent_unconfirmed', 'Paused: POSIX child signal attempted'],
  ] as const)('reports pause feedback %s accurately', (pauseFeedback, expected) => {
    const { lastFrame } = render(<FooterBar mode="CHAT" isPaused pauseFeedback={pauseFeedback} />);
    expect(lastFrame() ?? '').toContain(expected);
  });

  it('renders decision prompt hints when hasFocusedDecision is true', () => {
    const { lastFrame } = render(<FooterBar mode="CHAT" hasFocusedDecision={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1 2 3 choose   Enter send   Esc ask me later');
    expect(frame).not.toContain('[1] Main Status');
  });

  it('lists one digit per decision option and defaults to three digits', () => {
    const twoOptions = render(
      <FooterBar mode="CHAT" hasFocusedDecision={true} decisionOptionCount={2} />
    );
    expect(twoOptions.lastFrame() ?? '').toContain(
      '1 2 choose   Enter send   Esc ask me later'
    );

    const fourOptions = render(
      <FooterBar mode="CHAT" hasFocusedDecision={true} decisionOptionCount={4} />
    );
    expect(fourOptions.lastFrame() ?? '').toContain(
      '1 2 3 4 choose   Enter send   Esc ask me later'
    );

    const defaultOptions = render(
      <FooterBar mode="CHAT" hasFocusedDecision={true} />
    );
    expect(defaultOptions.lastFrame() ?? '').toContain(
      '1 2 3 choose   Enter send   Esc ask me later'
    );
  });

  it('renders TEAM mode hints', () => {
    const { lastFrame } = render(<FooterBar mode="TEAM" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('↑ ↓ select   Enter open agent   Tab or Esc back to the conversation');
    expect(frame).not.toContain('[1]');
  });

  it('renders ZOOM mode hints', () => {
    const { lastFrame } = render(<FooterBar mode="ZOOM" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Esc back to the conversation   Ctrl+R full raw output   Ctrl+T take over this terminal');
    expect(frame).not.toContain('[1]');
  });

  it('renders TAKEOVER mode hints', () => {
    const { lastFrame } = render(<FooterBar mode="TAKEOVER" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain("You are typing into the agent's terminal. Press Ctrl+] to return.");
    expect(frame).not.toContain('[1]');
  });

  it('renders overlay open hints when activeOverlay is set', () => {
    const { lastFrame } = render(<FooterBar mode="CHAT" activeOverlay="audit" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Esc back to the conversation   ↑ ↓ scroll');
    expect(frame).not.toContain('[1]');
  });

  it('renders double Ctrl+C quit confirmation hint', () => {
    const { lastFrame } = render(<FooterBar mode="CHAT" confirmingQuit={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Stop the team and quit? Press Ctrl+C again.');
    expect(frame).not.toContain('[1]');
  });

  it('preserves legacy FooterBar output when legacy props are passed without mode', () => {
    const { lastFrame } = render(
      <FooterBar activePanel={1} inputMode="NAVIGATION" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[1] Main');
    expect(frame).toContain('Status');
    expect(frame).toContain('[2] Live');
    expect(frame).toContain('PTY');
  });
});
