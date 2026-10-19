import React from 'react';
import { Box, Text } from 'ink';
import { resolveTheme, type ThemeConfig } from '../theme.js';

export interface SlashCommandItem {
  command: string;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  { command: '/spec', description: 'Full-screen spec viewer' },
  { command: '/plan', description: 'Full-screen plan viewer' },
  { command: '/audit', description: 'Full-screen audit ledger' },
  { command: '/raw', description: 'Take over the terminal' },
  { command: '/pause', description: 'Pause the team' },
  { command: '/resume', description: 'Resume the team' },
  { command: '/decide', description: 'Jump to pending decision' },
  { command: '/help', description: 'List keys and commands' },
  { command: '/quit', description: 'Stop the team and quit' },
] as const;

export function filterSlashCommands(query: string): SlashCommandItem[] {
  if (!query.startsWith('/')) {
    return [];
  }
  const normalized = query.trim().toLowerCase();
  return SLASH_COMMANDS.filter((item) =>
    item.command.toLowerCase().startsWith(normalized)
  );
}

export interface CommandPaletteProps {
  query: string;
  selectedIndex?: number;
  theme?: ThemeConfig;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  query,
  selectedIndex = 0,
  theme,
}) => {
  if (!query.startsWith('/')) {
    return null;
  }

  const matches = filterSlashCommands(query);
  if (matches.length === 0) {
    return null;
  }

  const activeTheme = theme ?? resolveTheme();

  return (
    <Box flexDirection="column" paddingX={1}>
      {matches.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={item.command} flexDirection="row">
            <Text
              color={isSelected ? activeTheme.colors.active : activeTheme.colors.text}
              bold={isSelected}
            >
              {item.command}
            </Text>
            <Text color={activeTheme.colors.dim}>
              {'   '}{item.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
