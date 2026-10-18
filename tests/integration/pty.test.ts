import { describe, it, expect } from 'vitest';
import { PtyRunner } from '../../src/index.js';

describe('PtyRunner Native Integration', () => {
  it('launches a live PTY subprocess executing node and streams bytes properly', async () => {
    let output = '';
    const runner = new PtyRunner({
      projectDir: process.cwd(),
      binaryPath: process.execPath,
      agent: '',
      args: ['-e', "console.log('PTY_NATIVE_READY')"],
      dryRun: false,
    });

    runner.onData((data) => {
      output += data;
    });

    const exitCode = await runner.start();
    expect(exitCode).toBe(0);
    expect(output).toContain('PTY_NATIVE_READY');
  }, 15000);
});
