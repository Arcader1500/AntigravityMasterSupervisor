import React from 'react';
import { Box, Text } from 'ink';
import type { InputMode, TuiPanelId } from '../../telemetry/types.js';

export interface FooterBarProps {
  activePanel: TuiPanelId;
  inputMode: InputMode;
  activeDoc?: 'spec' | 'plan';
}

export const FooterBar: React.FC<FooterBarProps> = ({
  activePanel,
  inputMode,
  activeDoc,
}) => {
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
};
