import React from 'react';
import { Box, Text } from 'ink';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface ComposerProps {
  value: string;
  placeholder: string;
  maxWidth?: number;
  isFocused?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export function getComposerPlaceholder(options: {
  hasStarted: boolean;
  mode: 'CHAT' | 'TEAM' | 'ZOOM' | 'TAKEOVER';
  decisionOptionCount?: number;
}): string {
  if (options.mode === 'ZOOM') {
    return 'Message the supervisor about this agent';
  }
  if (options.decisionOptionCount && options.decisionOptionCount > 0) {
    const count = options.decisionOptionCount;
    if (count === 1) {
      return 'Press 1, or answer in your own words';
    }
    const numbers = Array.from({ length: count }, (_, i) => String(i + 1));
    const leading = numbers.slice(0, -1).join(', ');
    const last = numbers[numbers.length - 1];
    return `Press ${leading} or ${last}, or answer in your own words`;
  }
  if (!options.hasStarted) {
    return 'Describe what you want built';
  }
  return 'Message the supervisor, or type / for commands';
}

function softWrapLine(line: string, wrapWidth: number): string[] {
  if (line.length <= wrapWidth) {
    return [line];
  }

  const words = line.split(' ');
  const wrapped: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word.length > wrapWidth) {
      if (currentLine.length > 0) {
        wrapped.push(currentLine);
        currentLine = '';
      }
      let remaining = word;
      while (remaining.length > wrapWidth) {
        wrapped.push(remaining.slice(0, wrapWidth));
        remaining = remaining.slice(wrapWidth);
      }
      currentLine = remaining;
      continue;
    }

    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= wrapWidth) {
      currentLine += ' ' + word;
    } else {
      wrapped.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    wrapped.push(currentLine);
  }

  return wrapped.length > 0 ? wrapped : [''];
}

export function wrapComposerLines(
  value: string,
  width: number,
  maxVisibleLines = 4
): string[] {
  if (value.length === 0) {
    return [];
  }

  const wrapWidth = Math.max(10, width - 3);
  const rawLines = value.split(/\r?\n|\\n/);
  const wrappedLines: string[] = [];

  for (const rawLine of rawLines) {
    const wrapped = softWrapLine(rawLine, wrapWidth);
    wrappedLines.push(...wrapped);
  }

  const maxLines = Math.max(1, maxVisibleLines);
  return wrappedLines.slice(-maxLines);
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  placeholder,
  maxWidth = 80,
  isFocused = true,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  if (value.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color={activeTheme.colors.active}>
            {activeGlyphs.prompt}{' '}
          </Text>
          <Text color={activeTheme.colors.dim}>{placeholder}</Text>
        </Box>
      </Box>
    );
  }

  const lines = wrapComposerLines(value, maxWidth, 4);

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row">
          {index === 0 ? (
            <Text color={activeTheme.colors.active}>
              {activeGlyphs.prompt}{' '}
            </Text>
          ) : (
            <Text>{'  '}</Text>
          )}
          <Text color={activeTheme.colors.text}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};
