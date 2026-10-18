import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LivePtyView } from '../../src/tui/components/LivePtyView.js';

describe('LivePtyView', () => {
  it('renders viewport lines and interaction mode banner in PTY_INTERACT mode', () => {
    const { lastFrame } = render(
      <LivePtyView
        lines={['Welcome to Antigravity CLI', '? Select an option:']}
        inputMode="PTY_INTERACT"
        mainAgent="planner"
        pid={4321}
      />
    );
    expect(lastFrame()).toContain('Welcome to Antigravity CLI');
    expect(lastFrame()).toContain('? Select an option:');
    expect(lastFrame()).toContain('Ctrl+]');
    expect(lastFrame()).toContain('planner');
    expect(lastFrame()).toContain('4321');
  });

  it('renders status banner indicating keyboard input is unlocked in NAVIGATION mode', () => {
    const { lastFrame } = render(
      <LivePtyView
        lines={['Line 1: System initialized']}
        inputMode="NAVIGATION"
        mainAgent="orchestrator"
      />
    );
    expect(lastFrame()).toContain('Line 1: System initialized');
    expect(lastFrame()).toContain('Press [i] or [Enter] to interact with agy terminal');
    expect(lastFrame()).toContain('orchestrator');
  });

  it('renders empty-state placeholder when lines is empty', () => {
    const { lastFrame } = render(
      <LivePtyView
        lines={[]}
        inputMode="NAVIGATION"
        mainAgent="planner"
      />
    );
    expect(lastFrame()).toContain('No terminal output yet');
  });

  it('limits visible lines to maxRows, showing latest lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Terminal line ${i + 1}`);
    const { lastFrame } = render(
      <LivePtyView
        lines={lines}
        inputMode="PTY_INTERACT"
        mainAgent="planner"
        maxRows={10}
      />
    );
    // Should contain the last lines
    expect(lastFrame()).toContain('Terminal line 30');
    expect(lastFrame()).toContain('Terminal line 21');
    // Should NOT contain the earlier lines
    expect(lastFrame()).not.toContain('Terminal line 1\n');
    expect(lastFrame()).not.toContain('Terminal line 10');
  });
});
