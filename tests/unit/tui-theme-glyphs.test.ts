import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../../src/tui/theme.js';
import { resolveGlyphs } from '../../src/tui/glyphs.js';

describe('theme resolution', () => {
  it('resolves truecolor mode and palette when colorLevel is 3', () => {
    const theme = resolveTheme({ env: {}, colorLevel: 3 });
    expect(theme.mode).toBe('truecolor');
    expect(theme.noMotion).toBe(false);
    expect(theme.colors).toEqual({
      text: '#D5E2E6',
      dim: '#84A0AD',
      active: '#5CC8C0',
      done: '#8CCB8A',
      ask: '#FF8FA2',
      line: '#2C4A5E',
    });
  });

  it('resolves ansi16 mode and palette when colorLevel is 2 or 1', () => {
    const themeLevel2 = resolveTheme({ env: {}, colorLevel: 2 });
    expect(themeLevel2.mode).toBe('ansi16');
    expect(themeLevel2.colors).toEqual({
      text: 'white',
      dim: 'gray',
      active: 'cyan',
      done: 'green',
      ask: 'magentaBright',
      line: 'blue',
    });

    const themeLevel1 = resolveTheme({ env: {}, colorLevel: 1 });
    expect(themeLevel1.mode).toBe('ansi16');
    expect(themeLevel1.colors.ask).toBe('magentaBright');
  });

  it('resolves monochrome mode with undefined colors when NO_COLOR is set or colorLevel is 0', () => {
    const themeNoColor = resolveTheme({ env: { NO_COLOR: '1' }, colorLevel: 3 });
    expect(themeNoColor.mode).toBe('monochrome');
    expect(themeNoColor.colors).toEqual({
      text: undefined,
      dim: undefined,
      active: undefined,
      done: undefined,
      ask: undefined,
      line: undefined,
    });

    const themeColorLevel0 = resolveTheme({ env: {}, colorLevel: 0 });
    expect(themeColorLevel0.mode).toBe('monochrome');
    expect(themeColorLevel0.colors).toEqual({
      text: undefined,
      dim: undefined,
      active: undefined,
      done: undefined,
      ask: undefined,
      line: undefined,
    });
  });

  it('resolves light mode and handles NO_MOTION when COLORFGBG indicates light background', () => {
    const themeLight = resolveTheme({
      env: { COLORFGBG: '0;15', NO_MOTION: '1' },
      colorLevel: 3,
    });
    expect(themeLight.mode).toBe('light');
    expect(themeLight.noMotion).toBe(true);
    expect(themeLight.colors.text).toBeUndefined();
    expect(themeLight.colors.dim).toBe('gray');
    expect(themeLight.colors.active).toBe('#5CC8C0');
    expect(themeLight.colors.done).toBe('#8CCB8A');
    expect(themeLight.colors.ask).toBe('#FF8FA2');
    expect(themeLight.colors.line).toBe('#2C4A5E');

    const themeLight7 = resolveTheme({
      env: { COLORFGBG: 'default;7', NO_MOTION: 'true' },
      colorLevel: 3,
    });
    expect(themeLight7.mode).toBe('light');
    expect(themeLight7.noMotion).toBe(true);

    const themeLightAnsi = resolveTheme({
      env: { COLORFGBG: '0;15' },
      colorLevel: 2,
    });
    expect(themeLightAnsi.mode).toBe('light');
    expect(themeLightAnsi.colors.text).toBeUndefined();
    expect(themeLightAnsi.colors.dim).toBe('gray');
    expect(themeLightAnsi.colors.active).toBe('cyan');
  });

  it('resolves default colorLevel and noMotion when options are omitted', () => {
    const defaultTheme = resolveTheme();
    expect(['truecolor', 'ansi16', 'light', 'monochrome']).toContain(defaultTheme.mode);
    expect(typeof defaultTheme.noMotion).toBe('boolean');
    expect(defaultTheme.colors).toBeDefined();
  });
});

describe('glyph resolution', () => {
  it('resolves Unicode glyphs for modern terminal environments', () => {
    const glyphsWinWT = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'win32' });
    expect(glyphsWinWT).toEqual({
      done: '✓',
      running: '▸',
      paused: '❚❚',
      prompt: '›',
      treeBranch: '├',
      treeLast: '└',
      hr: '─',
      vr: '│',
      teeDown: '┬',
      teeUp: '┴',
      spinnerFrames: ['▸', '▹', '▸', '▹'],
    });

    const glyphsLinux = resolveGlyphs({ env: { WT_SESSION: '1' }, platform: 'linux' });
    expect(glyphsLinux.done).toBe('✓');
    expect(glyphsLinux.hr).toBe('─');
    expect(glyphsLinux.vr).toBe('│');
    expect(glyphsLinux.teeDown).toBe('┬');
    expect(glyphsLinux.teeUp).toBe('┴');
    expect(glyphsLinux.spinnerFrames).toEqual(['▸', '▹', '▸', '▹']);

    const glyphsTermProgram = resolveGlyphs({
      env: { TERM_PROGRAM: 'vscode' },
      platform: 'win32',
    });
    expect(glyphsTermProgram.done).toBe('✓');

    const glyphsConEmu = resolveGlyphs({
      env: { ConEmuANSI: 'ON' },
      platform: 'win32',
    });
    expect(glyphsConEmu.done).toBe('✓');

    const glyphsXterm = resolveGlyphs({
      env: { TERM: 'xterm-256color' },
      platform: 'win32',
    });
    expect(glyphsXterm.done).toBe('✓');
  });

  it('resolves ASCII fallbacks when AGYSUP_ASCII is 1 or on legacy win32 console', () => {
    const asciiGlyphs = {
      done: '[x]',
      running: '>',
      paused: '||',
      prompt: '>',
      treeBranch: '|-',
      treeLast: '`-',
      hr: '-',
      vr: '|',
      teeDown: '+',
      teeUp: '+',
      spinnerFrames: ['>', '-', '>', '-'],
    };

    const glyphsAgySupAscii = resolveGlyphs({ env: { AGYSUP_ASCII: '1' } });
    expect(glyphsAgySupAscii).toEqual(asciiGlyphs);
    expect(glyphsAgySupAscii.hr).toBe('-');
    expect(glyphsAgySupAscii.vr).toBe('|');
    expect(glyphsAgySupAscii.teeDown).toBe('+');
    expect(glyphsAgySupAscii.teeUp).toBe('+');

    const glyphsLegacyWin = resolveGlyphs({ env: {}, platform: 'win32' });
    expect(glyphsLegacyWin).toEqual(asciiGlyphs);
  });

  it('resolves default glyphs when options are omitted', () => {
    const defaultGlyphs = resolveGlyphs();
    expect(defaultGlyphs).toBeDefined();
    expect(defaultGlyphs.spinnerFrames).toHaveLength(4);
  });
});
