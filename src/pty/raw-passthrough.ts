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

  if (isRawSupported) {
    try {
      stdin.setRawMode(true);
    } catch {
      // In some environments, setRawMode may fail if stream is redirected
    }
  }

  if (typeof stdin.resume === 'function') {
    stdin.resume();
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

  stdin.on('data', onData);
  stdout.on('resize', onResize);

  let detached = false;
  const detach = () => {
    if (detached) {
      return;
    }
    detached = true;

    if (typeof stdin.removeListener === 'function') {
      stdin.removeListener('data', onData);
    }
    if (typeof stdout.removeListener === 'function') {
      stdout.removeListener('resize', onResize);
    }

    if (isRawSupported) {
      try {
        stdin.setRawMode(false);
      } catch {
        // Safe to ignore
      }
    }

    if (typeof stdin.pause === 'function') {
      stdin.pause();
    }
  };

  return { detach };
}
