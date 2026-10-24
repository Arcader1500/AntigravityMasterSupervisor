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
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tui-run-'));
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
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
    expect(ledger.status).toBe('IDLE');
    expect(ledger.events.some((e) => e.message.includes('Supervisor execution started'))).toBe(true);
    expect(ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_STARTED')).toHaveLength(1);
    expect(ledger.events.filter((e) => e.metadata?.kind === 'PROCESS_OUTCOME')).toHaveLength(1);
    expect(ledger.events.find((e) => e.metadata?.kind === 'PROCESS_OUTCOME')?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 0 });
  });

  it('persists real Node PTY exit 7 and propagates its CLI exit code', async () => {
    await runCommand(tmpDir, { agyBin: process.execPath, noTui: true, args: ['-e', 'process.exit(7)'] });
    const ledger = loadLedger(tmpDir);
    expect(ledger.status).toBe('FAILED');
    expect(process.exitCode).toBe(7);
    expect(ledger.events.find((e) => e.metadata?.kind === 'PROCESS_OUTCOME')?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 7 });
  });

  it('does not infer success from a PASS line before a zero-exit child', async () => {
    await runCommand(tmpDir, { agyBin: process.execPath, noTui: true, args: ['-e', 'console.log("PASS"); process.exit(0)'] });
    const ledger = loadLedger(tmpDir);
    expect(ledger.status).toBe('IDLE');
    expect(ledger.events.find((e) => e.metadata?.kind === 'PROCESS_OUTCOME')?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 0 });
  });

  it('assigns different process identities to repeated resume invocations', async () => {
    await runCommand(tmpDir, { agyBin: process.execPath, noTui: true, args: ['-e', 'process.exit(0)'] });
    const sessionId = loadLedger(tmpDir).sessionId;
    await runCommand(tmpDir, { agyBin: process.execPath, noTui: true, resume: true, args: ['-e', 'process.exit(0)'] });
    await runCommand(tmpDir, { agyBin: process.execPath, noTui: true, resume: true, args: ['-e', 'process.exit(0)'] });
    const ledger = loadLedger(tmpDir);
    const runs = ledger.events.filter((event) => event.metadata?.kind === 'PROCESS_STARTED');
    expect(ledger.sessionId).toBe(sessionId);
    expect(new Set(runs.map((event) => event.metadata?.runId)).size).toBe(3);
    expect(runs.every((event) => event.metadata?.sessionId === sessionId)).toBe(true);
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
