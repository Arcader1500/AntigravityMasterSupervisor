import React from 'react';
import { Box, Text } from 'ink';
import type { InputMode, TuiPanelId } from '../../telemetry/types.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';

export interface FooterBarProps {
  // Conversational props
  mode?: 'CHAT' | 'TEAM' | 'ZOOM' | 'TAKEOVER';
  hasFocusedDecision?: boolean;
  decisionOptionCount?: number;
  isPaused?: boolean;
  confirmingQuit?: boolean;
  activeOverlay?: null | 'spec' | 'plan' | 'audit' | 'raw';
  theme?: ThemeConfig;

  // Legacy props
  activePanel?: TuiPanelId;
  inputMode?: InputMode;
  activeDoc?: 'spec' | 'plan';
}

export const FooterBar: React.FC<FooterBarProps> = ({
  mode,
  hasFocusedDecision,
  decisionOptionCount,
  isPaused,
  confirmingQuit,
  activeOverlay,
  theme,
  activePanel,
  inputMode,
  activeDoc,
}) => {
  const activeTheme = theme ?? resolveTheme();

  // 1. Double Ctrl+C quit confirmation
  if (confirmingQuit) {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.ask}>
          Stop the team and quit? Press Ctrl+C again.
        </Text>
      </Box>
    );
  }

  // 2. Active overlay open
  if (activeOverlay !== null && activeOverlay !== undefined) {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.dim}>
          Esc back to the conversation   ↑ ↓ scroll
        </Text>
      </Box>
    );
  }

  // 3. Backward-compatibility guard: when mode is undefined and activePanel is provided,
  // render legacy footer so legacy views continue to pass in Waves 2–3.
  if (mode === undefined && activePanel !== undefined) {
    if (inputMode === 'PTY_INTERACT') {
      return (
        <Box
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          justifyContent="space-between"
        >
          <Text bold color="magenta">
            🔒 PTY INTERACT LOCKED — Press Ctrl+] to detach
          </Text>
          <Text color="gray">
            Keys sent directly to subagent terminal
          </Text>
        </Box>
      );
    }

    const panels: Array<{ id: TuiPanelId; label: string }> = [
      { id: 1, label: '[1] Main Status' },
      { id: 2, label: '[2] Live PTY' },
      { id: 3, label: '[3] Spec & Plan' },
      { id: 4, label: '[4] Audit Log' },
    ];

    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Box flexDirection="row" gap={2}>
          {panels.map((panel) => {
            const isActive = activePanel === panel.id;
            return (
              <Text
                key={panel.id}
                bold={isActive}
                color={isActive ? 'cyan' : 'gray'}
                inverse={isActive}
              >
                {panel.label}
              </Text>
            );
          })}
        </Box>

        <Box flexDirection="row" gap={1}>
          {activePanel === 3 && (
            <Text color="yellow">
              <Text bold={activeDoc === 'spec'}>[s] Spec</Text>
              {'  '}
              <Text bold={activeDoc === 'plan'}>[p] Plan</Text>
              {' │ '}
            </Text>
          )}
          <Text color="gray">[P] Pause  [Q] Quit</Text>
        </Box>
      </Box>
    );
  }

  // 4. Conversational modes
  if (mode === 'TAKEOVER' || inputMode === 'PTY_INTERACT') {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.ask}>
          You are typing into the agent's terminal. Press Ctrl+] to return.
        </Text>
      </Box>
    );
  }

  if (mode === 'ZOOM') {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.dim}>
          Esc back to the conversation   Ctrl+R full raw output   Ctrl+T take over this terminal
        </Text>
      </Box>
    );
  }

  if (mode === 'TEAM') {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.dim}>
          ↑ ↓ select   Enter open agent   Tab or Esc back to the conversation
        </Text>
      </Box>
    );
  }

  // mode === 'CHAT' or default
  if (hasFocusedDecision) {
    const count =
      decisionOptionCount && decisionOptionCount > 0
        ? Math.min(9, decisionOptionCount)
        : 3;
    const digits = Array.from({ length: count }, (_, i) => i + 1).join(' ');
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.dim}>
          {`${digits} choose   Enter send   Esc ask me later`}
        </Text>
      </Box>
    );
  }

  if (isPaused) {
    return (
      <Box paddingX={1}>
        <Text color={activeTheme.colors.dim}>
          /resume   Tab team   Enter open agent   / commands   Ctrl+T take over the terminal
        </Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text color={activeTheme.colors.dim}>
        Tab team   Enter open agent   / commands   Ctrl+T take over the terminal
      </Text>
    </Box>
  );
};
