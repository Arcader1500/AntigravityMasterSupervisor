export type ThemeToken = 'text' | 'dim' | 'active' | 'done' | 'ask' | 'line';

export interface ThemeConfig {
  mode: 'truecolor' | 'ansi16' | 'light' | 'monochrome';
  noMotion: boolean;
  colors: Record<ThemeToken, string | undefined>;
}

export interface ResolveThemeOptions {
  env?: NodeJS.ProcessEnv;
  colorLevel?: number;
}

function detectColorLevel(env: NodeJS.ProcessEnv): number {
  if (env.FORCE_COLOR !== undefined) {
    if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') {
      return 0;
    }
    const parsed = parseInt(env.FORCE_COLOR, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return Math.min(3, parsed);
    }
    return 1;
  }

  const depth =
    typeof process.stdout?.getColorDepth === 'function'
      ? process.stdout.getColorDepth()
      : 24;

  if (depth >= 24) {
    return 3;
  }
  if (depth >= 4) {
    return 1;
  }
  return 0;
}

export function resolveTheme(options?: ResolveThemeOptions): ThemeConfig {
  const env = options?.env ?? process.env;
  const colorLevel =
    options?.colorLevel !== undefined
      ? options.colorLevel
      : detectColorLevel(env);

  const noMotion = env.NO_MOTION === '1' || env.NO_MOTION === 'true';

  if ((env.NO_COLOR !== undefined && env.NO_COLOR !== '') || colorLevel === 0) {
    return {
      mode: 'monochrome',
      noMotion,
      colors: {
        text: undefined,
        dim: undefined,
        active: undefined,
        done: undefined,
        ask: undefined,
        line: undefined,
      },
    };
  }

  const colorfgbg = env.COLORFGBG?.trim();
  if (colorfgbg !== undefined && (colorfgbg.endsWith(';7') || colorfgbg.endsWith(';15'))) {
    return {
      mode: 'light',
      noMotion,
      colors: {
        text: undefined,
        dim: 'gray',
        active: colorLevel < 3 ? 'cyan' : '#5CC8C0',
        done: colorLevel < 3 ? 'green' : '#8CCB8A',
        ask: colorLevel < 3 ? 'magentaBright' : '#FF8FA2',
        line: colorLevel < 3 ? 'blue' : '#2C4A5E',
      },
    };
  }

  if (colorLevel < 3) {
    return {
      mode: 'ansi16',
      noMotion,
      colors: {
        text: 'white',
        dim: 'gray',
        active: 'cyan',
        done: 'green',
        ask: 'magentaBright',
        line: 'blue',
      },
    };
  }

  return {
    mode: 'truecolor',
    noMotion,
    colors: {
      text: '#D5E2E6',
      dim: '#84A0AD',
      active: '#5CC8C0',
      done: '#8CCB8A',
      ask: '#FF8FA2',
      line: '#2C4A5E',
    },
  };
}
