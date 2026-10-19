import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import {
  Composer,
  getComposerPlaceholder,
  wrapComposerLines,
  type ComposerProps,
} from '../../src/tui/components/Composer.js';
import {
  CommandPalette,
  filterSlashCommands,
  SLASH_COMMANDS,
  type SlashCommandItem,
  type CommandPaletteProps,
} from '../../src/tui/components/CommandPalette.js';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';

describe('getComposerPlaceholder helper', () => {
  it('returns first-launch prompt when not started', () => {
    expect(
      getComposerPlaceholder({
        hasStarted: false,
        mode: 'CHAT',
      })
    ).toBe('Describe what you want built');
  });

  it('returns chat prompt when started in CHAT or TEAM mode', () => {
    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'CHAT',
      })
    ).toBe('Message the supervisor, or type / for commands');

    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'TEAM',
      })
    ).toBe('Message the supervisor, or type / for commands');
  });

  it('returns zoom prompt when in ZOOM mode regardless of started flag', () => {
    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'ZOOM',
      })
    ).toBe('Message the supervisor about this agent');

    expect(
      getComposerPlaceholder({
        hasStarted: false,
        mode: 'ZOOM',
      })
    ).toBe('Message the supervisor about this agent');
  });

  it('returns decision prompts with option count formatting', () => {
    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'CHAT',
        decisionOptionCount: 1,
      })
    ).toBe('Press 1, or answer in your own words');

    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'CHAT',
        decisionOptionCount: 2,
      })
    ).toBe('Press 1 or 2, or answer in your own words');

    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'CHAT',
        decisionOptionCount: 3,
      })
    ).toBe('Press 1, 2 or 3, or answer in your own words');

    expect(
      getComposerPlaceholder({
        hasStarted: true,
        mode: 'CHAT',
        decisionOptionCount: 4,
      })
    ).toBe('Press 1, 2, 3 or 4, or answer in your own words');
  });
});

describe('wrapComposerLines helper', () => {
  it('returns empty array when value is empty', () => {
    expect(wrapComposerLines('', 80)).toEqual([]);
  });

  it('preserves single short line', () => {
    expect(wrapComposerLines('hello world', 80)).toEqual(['hello world']);
  });

  it('splits on literal \\n newlines and CRLF', () => {
    expect(wrapComposerLines('first line\nsecond line', 80)).toEqual([
      'first line',
      'second line',
    ]);
    expect(wrapComposerLines('first line\r\nsecond line', 80)).toEqual([
      'first line',
      'second line',
    ]);
    expect(wrapComposerLines('first line\\nsecond line', 80)).toEqual([
      'first line',
      'second line',
    ]);
  });

  it('limits to maxVisibleLines (default 4) showing the tail lines', () => {
    const input = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6';
    const lines = wrapComposerLines(input, 80, 4);
    expect(lines).toEqual(['line 3', 'line 4', 'line 5', 'line 6']);
  });

  it('soft-wraps long lines based on width - 3 (min 10)', () => {
    // effective width: Math.max(10, 23 - 3) = 20
    const longText = 'word1 word2 word3 word4 word5 word6 word7';
    const lines = wrapComposerLines(longText, 23, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it('breaks long words that exceed wrap width', () => {
    const longWord = 'abcdefghijklmnopqrstuvwxyz';
    const lines = wrapComposerLines(longWord, 13, 10); // wrap width Math.max(10, 10) = 10
    expect(lines).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  });

  it('shows only tail lines when soft-wrapping exceeds maxVisibleLines', () => {
    const longWord = '12345678901234567890123456789012345678901234567890'; // 50 chars
    // wrap width Math.max(10, 13 - 3) = 10 -> 5 chunks of 10 chars
    const lines = wrapComposerLines(longWord, 13, 4);
    expect(lines).toHaveLength(4);
    expect(lines).toEqual([
      '1234567890',
      '1234567890',
      '1234567890',
      '1234567890',
    ]);
  });
});

describe('filterSlashCommands helper', () => {
  it('returns empty array when query does not start with /', () => {
    expect(filterSlashCommands('')).toEqual([]);
    expect(filterSlashCommands('spec')).toEqual([]);
    expect(filterSlashCommands('help')).toEqual([]);
  });

  it('returns all slash commands when query is /', () => {
    const matches = filterSlashCommands('/');
    expect(matches).toHaveLength(9);
    expect(matches.map((m) => m.command)).toEqual([
      '/spec',
      '/plan',
      '/audit',
      '/raw',
      '/pause',
      '/resume',
      '/decide',
      '/help',
      '/quit',
    ]);
  });

  it('filters commands by prefix case-insensitively', () => {
    expect(filterSlashCommands('/s').map((m) => m.command)).toEqual(['/spec']);
    expect(filterSlashCommands('/S').map((m) => m.command)).toEqual(['/spec']);
    expect(filterSlashCommands('/p').map((m) => m.command)).toEqual([
      '/plan',
      '/pause',
    ]);
    expect(filterSlashCommands('/r').map((m) => m.command)).toEqual([
      '/raw',
      '/resume',
    ]);
    expect(filterSlashCommands('/q').map((m) => m.command)).toEqual(['/quit']);
    expect(filterSlashCommands('/unknown')).toEqual([]);
  });
});

describe('Composer component', () => {
  const unicodeGlyphs = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'linux' });
  const asciiGlyphs = resolveGlyphs({ env: { AGYSUP_ASCII: '1' } });

  it('renders prompt › and placeholder when value is empty', () => {
    const placeholder = getComposerPlaceholder({ hasStarted: false, mode: 'CHAT' });
    const { lastFrame } = render(
      <Composer
        value=""
        placeholder={placeholder}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('›');
    expect(frame).toContain('Describe what you want built');
  });

  it('renders ascii prompt > when ascii glyphs are configured', () => {
    const placeholder = getComposerPlaceholder({ hasStarted: true, mode: 'CHAT' });
    const { lastFrame } = render(
      <Composer
        value=""
        placeholder={placeholder}
        glyphs={asciiGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('>');
    expect(frame).toContain('Message the supervisor, or type / for commands');
  });

  it('renders decision placeholder when decisionOptionCount is provided', () => {
    const placeholder = getComposerPlaceholder({
      hasStarted: true,
      mode: 'CHAT',
      decisionOptionCount: 3,
    });
    const { lastFrame } = render(
      <Composer
        value=""
        placeholder={placeholder}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Press 1, 2 or 3, or answer in your own words');
  });

  it('renders zoom placeholder in ZOOM mode', () => {
    const placeholder = getComposerPlaceholder({
      hasStarted: true,
      mode: 'ZOOM',
    });
    const { lastFrame } = render(
      <Composer
        value=""
        placeholder={placeholder}
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Message the supervisor about this agent');
  });

  it('renders typed value with prompt on first line', () => {
    const { lastFrame } = render(
      <Composer
        value="Refactor auth middleware"
        placeholder="Type here"
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('›');
    expect(frame).toContain('Refactor auth middleware');
    expect(frame).not.toContain('Type here');
  });

  it('renders continuation lines with 2-space indent up to 4 lines', () => {
    const { lastFrame } = render(
      <Composer
        value="first line\nsecond line\nthird line"
        placeholder="Type here"
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('›');
    expect(frame).toContain('first line');
    expect(frame).toContain('second line');
    expect(frame).toContain('third line');
  });

  it('scrolls internally and displays the last 4 lines when input exceeds 4 lines', () => {
    const { lastFrame } = render(
      <Composer
        value="line 1\nline 2\nline 3\nline 4\nline 5\nline 6"
        placeholder="Type here"
        glyphs={unicodeGlyphs}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('line 1');
    expect(frame).not.toContain('line 2');
    expect(frame).toContain('line 3');
    expect(frame).toContain('line 4');
    expect(frame).toContain('line 5');
    expect(frame).toContain('line 6');
  });
});

describe('CommandPalette component', () => {
  it('returns null when query does not start with /', () => {
    const { lastFrame } = render(
      <CommandPalette query="spec" />
    );
    expect(lastFrame()).toBe('');
  });

  it('returns null when query has no matching commands', () => {
    const { lastFrame } = render(
      <CommandPalette query="/nonexistent" />
    );
    expect(lastFrame()).toBe('');
  });

  it('renders all slash commands when query is /', () => {
    const { lastFrame } = render(
      <CommandPalette query="/" />
    );
    const frame = lastFrame() ?? '';
    for (const item of SLASH_COMMANDS) {
      expect(frame).toContain(item.command);
      expect(frame).toContain(item.description);
    }
  });

  it('filters commands when query is /s', () => {
    const { lastFrame } = render(
      <CommandPalette query="/s" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/spec');
    expect(frame).toContain('Full-screen spec viewer');
    expect(frame).not.toContain('/plan');
    expect(frame).not.toContain('/quit');
  });

  it('highlights selected item when selectedIndex is provided', () => {
    const theme = resolveTheme({ env: {}, colorLevel: 3 });
    const { lastFrame } = render(
      <CommandPalette query="/" selectedIndex={1} theme={theme} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/plan');
    expect(frame).toContain('Full-screen plan viewer');
  });

  it('renders above the Composer when input starts with /', () => {
    const input = '/s';
    const { lastFrame } = render(
      <Box flexDirection="column">
        <CommandPalette query={input} />
        <Composer value={input} placeholder="Describe what you want built" />
      </Box>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/spec');
    expect(frame).toContain('Full-screen spec viewer');
    expect(frame).toContain('›');
  });
});
