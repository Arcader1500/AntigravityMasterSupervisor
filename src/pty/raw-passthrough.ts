import type { PtyRunner } from './runner.js';
import type { RawPassthroughHandle } from './types.js';

/**
 * Attaches raw keyboard passthrough and terminal resize synchronization
 * between Node's process streams and an active PtyRunner instance.
 *
 * @param ptyRunner Active or interactive PtyRunner target
 * @param stdin Readable input stream (defaults to process.stdin)
 * @param stdout Writable output stream (defaults to process.stdout)
 * @returns RawPassthroughHandle with a detach() cleanup callback
 */
export function attachRawPassthrough(
  ptyRunner: Pick<PtyRunner, 'write' | 'resize'>,
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout
): RawPassthroughHandle {
  const isRawSupported = Boolean(stdin.isTTY && typeof stdin.setRawMode === 'function');
  const wasRaw = typeof stdin.isRaw === 'boolean' ? stdin.isRaw : false;
  const wasPaused = typeof stdin.isPaused === 'function'
    ? stdin.isPaused()
    : stdin.readableFlowing === false;

  if (isRawSupported) {
    try {
      stdin.setRawMode(true);
    } catch {
      // In some environments, setRawMode may fail if stream is redirected
    }
  }

  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    ptyRunner.write(text);
  };

  const onResize = () => {
    if (stdout.columns !== undefined && stdout.rows !== undefined) {
      ptyRunner.resize(stdout.columns, stdout.rows);
    }
  };

  let detached = false;
  const detach = () => {
    if (detached) {
      return;
    }
    detached = true;

    let firstError: unknown;
    const restore = (action: () => void) => {
      try { action(); } catch (error) { firstError ??= error; }
    };
    if (typeof stdin.removeListener === 'function') restore(() => stdin.removeListener('data', onData));
    if (typeof stdout.removeListener === 'function') restore(() => stdout.removeListener('resize', onResize));
    if (isRawSupported) restore(() => stdin.setRawMode(wasRaw));
    if (wasPaused && typeof stdin.pause === 'function') restore(() => stdin.pause());
    if (!wasPaused && typeof stdin.resume === 'function') restore(() => stdin.resume());
    if (firstError) throw firstError;
  };

  try {
    if (typeof stdin.resume === 'function') stdin.resume();
    stdin.on('data', onData);
    stdout.on('resize', onResize);
  } catch (error) {
    try { detach(); } catch { /* Preserve the setup error. */ }
    throw error;
  }

  return { detach };
}
