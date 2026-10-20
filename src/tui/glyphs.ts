export interface GlyphSet {
  done: string;
  running: string;
  paused: string;
  prompt: string;
  treeBranch: string;
  treeLast: string;
  hr: string;
  vr: string;
  teeDown: string;
  teeUp: string;
  spinnerFrames: readonly [string, string, string, string];
}

export function resolveGlyphs(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): GlyphSet {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;

  let isAscii = false;

  if (env.AGYSUP_ASCII === '1') {
    isAscii = true;
  } else if (platform === 'win32') {
    const hasModernTerminal = Boolean(
      env.WT_SESSION ||
      env.TERM_PROGRAM ||
      env.ConEmuANSI ||
      env.TERM === 'xterm-256color'
    );
    if (!hasModernTerminal) {
      isAscii = true;
    }
  }

  if (isAscii) {
    return {
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
  }

  return {
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
  };
}
