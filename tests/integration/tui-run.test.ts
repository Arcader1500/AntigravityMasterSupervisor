import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { PtyRunner } from '../../src/pty/runner.js';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryParser } from '../../src/telemetry/parser.js';
import { TelemetryStore } from '../../src/telemetry/store.js';
import { runCommand } from '../../src/cli/commands/run.js';
import { loadLedger } from '../../src/core/ledger.js';

describe('TUI & Telemetry Live PTY Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tui-run-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('runs runCommand in --no-tui mode with live node process and writes ledger', async () => {
    await runCommand(tmpDir, {
      agyBin: process.execPath,
      noTui: true,
      args: ['-e', 'console.log("simulated agy live output");'],
    });

    const ledger = loadLedger(tmpDir);
    expect(ledger.status).toBe('COMPLETED');
    expect(ledger.events.some((e) => e.message.includes('Supervisor execution started'))).toBe(true);
    expect(ledger.events.some((e) => e.message.includes('ended with exit code 0'))).toBe(true);
  });

  it('streams live node-pty output through VirtualTerminal into TelemetryStore', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    const parser = new TelemetryParser({ mainAgent: 'planner' });
    const store = new TelemetryStore({
      projectDir: tmpDir,
      virtualTerminal: vt,
      parser,
    });

    const runner = new PtyRunner({
      projectDir: tmpDir,
      binaryPath: process.execPath,
      agent: '',
      args: [
        '-e',
        'console.log("invoke_subagent -> researcher"); console.log("view_file -> README.md");',
      ],
      dryRun: false,
    });

    runner.onData((chunk) => {
      void vt.write(chunk);
    });

    const exitCode = await runner.start();
    expect(exitCode).toBe(0);

    const snap = store.getSnapshot();
    expect(snap.activeSubagent).toBe('researcher');
    expect(snap.lastAction).toContain('README.md');
    store.stop();
    vt.dispose();
  });
});
