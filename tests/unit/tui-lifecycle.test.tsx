import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PtyRunner } from '../../src/pty/runner.js';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';
import { TelemetryStore } from '../../src/telemetry/store.js';
import { TranscriptStore } from '../../src/tui/transcript-store.js';
import { initLedger, loadLedger } from '../../src/core/ledger.js';
import { mountSupervisorTui } from '../../src/tui/index.js';

const { renderMock } = vi.hoisted(() => ({ renderMock: vi.fn() }));
vi.mock('ink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ink')>()),
  render: renderMock,
}));

class FakeRunner {
  dataCallbacks = new Set<(data: string) => void>();
  exitCallbacks = new Set<(code: number, signal?: number) => void>();
  running = false;
  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn(() => { this.running = false; });
  getPid = vi.fn(() => 4321);
  isProcessRunning = () => this.running;
  onData = (listener: (data: string) => void) => {
    this.dataCallbacks.add(listener);
    return () => { this.dataCallbacks.delete(listener); };
  };
  onExit = (listener: (code: number, signal?: number) => void) => {
    this.exitCallbacks.add(listener);
    return () => { this.exitCallbacks.delete(listener); };
  };
  emitExit(code: number, signal?: number) {
    this.running = false;
    for (const callback of [...this.exitCallbacks]) callback(code, signal);
  }
}

describe('TUI lifecycle', () => {
  let projectDir: string;
  let originalIsTTY: boolean | undefined;
  let stdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tui-lifecycle-'));
    initLedger(projectDir);
    originalIsTTY = process.stdout.isTTY;
    stdoutWrite = process.stdout.write;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    renderMock.mockReset().mockImplementation(() => ({
      unmount: vi.fn(),
      rerender: vi.fn(),
      waitUntilExit: () => new Promise<void>(() => {}),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY });
    process.stdout.write = stdoutWrite;
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('persists a standalone mount outcome once and settles waitUntilExit after unmount', async () => {
    const runner = new FakeRunner();
    const instance = mountSupervisorTui({ projectDir, ptyRunner: runner as unknown as PtyRunner });
    runner.emitExit(7, 15);

    const outcomes = loadLedger(projectDir).events.filter((event) => event.metadata?.kind === 'PROCESS_OUTCOME');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.metadata).toMatchObject({ outcomeKind: 'exit', exitCode: 7, signal: 15 });
    expect(instance.store.getSnapshot().processOutcome).toMatchObject({ kind: 'exit', exitCode: 7, signal: 15 });
    expect(instance.transcriptStore?.getSnapshot().items.some((item) => item.kind === 'SupervisorNote' && item.text === 'Agent process exited with code 7')).toBe(true);

    instance.unmount();
    await expect(instance.waitUntilExit()).resolves.toBeUndefined();
  });

  it('restores the input raw state that existed before the TUI mount', () => {
    const stdin = process.stdin as any;
    const originalDescriptors = ['isTTY', 'isRaw', 'setRawMode', 'isPaused', 'pause', 'resume']
      .map((key) => [key, Object.getOwnPropertyDescriptor(stdin, key)] as const);
    const setRawMode = vi.fn();
    const resume = vi.fn();
    try {
      Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
      Object.defineProperty(stdin, 'isRaw', { configurable: true, value: true });
      Object.defineProperty(stdin, 'setRawMode', { configurable: true, value: setRawMode });
      Object.defineProperty(stdin, 'isPaused', { configurable: true, value: () => false });
      Object.defineProperty(stdin, 'resume', { configurable: true, value: resume });
      const instance = mountSupervisorTui({ projectDir, ptyRunner: new FakeRunner() as unknown as PtyRunner });
      instance.unmount();
      expect(setRawMode).toHaveBeenCalledWith(true);
      expect(resume).toHaveBeenCalled();
    } finally {
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(stdin, key, descriptor);
        else delete stdin[key];
      }
    }
  });

  it('keeps the PTY and virtual terminal within small terminal bounds and tracks growth', () => {
    const runner = new FakeRunner();
    const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 8 });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 30 });
    try {
      const instance = mountSupervisorTui({ projectDir, ptyRunner: runner as unknown as PtyRunner });
      expect(instance.virtualTerminal.getRows()).toBe(2);
      expect(runner.resize).toHaveBeenLastCalledWith(30, 2);

      Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 30 });
      Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 100 });
      process.stdout.emit('resize');
      expect(instance.virtualTerminal.getRows()).toBe(24);
      expect(runner.resize).toHaveBeenLastCalledWith(100, 24);
      instance.unmount();
    } finally {
      if (rows) Object.defineProperty(process.stdout, 'rows', rows);
      else delete (process.stdout as any).rows;
      if (columns) Object.defineProperty(process.stdout, 'columns', columns);
      else delete (process.stdout as any).columns;
    }
  });

  it('continues cleanup after injected failures and ignores data callbacks after disposal', async () => {
    const runner = new FakeRunner();
    runner.running = true;
    const originalOnData = runner.onData;
    runner.onData = (listener) => {
      const unsubscribe = originalOnData(listener);
      return () => { unsubscribe(); throw new Error('data listener cleanup fault'); };
    };
    const priorResizeListeners = process.stdout.listenerCount('resize');
    const originalRemoveListener = process.stdout.removeListener.bind(process.stdout);
    vi.spyOn(process.stdout, 'removeListener').mockImplementation(((event: string | symbol, listener: (...args: any[]) => void) => {
      originalRemoveListener(event as any, listener as any);
      if (event === 'resize') throw new Error('resize listener cleanup fault');
      return process.stdout;
    }) as any);
    const originalVtDispose = VirtualTerminal.prototype.dispose;
    const originalStoreStop = TelemetryStore.prototype.stop;
    const originalTranscriptDispose = TranscriptStore.prototype.dispose;
    const vtDispose = vi.spyOn(VirtualTerminal.prototype, 'dispose').mockImplementation(function (this: VirtualTerminal) {
      originalVtDispose.call(this);
      throw new Error('virtual terminal cleanup fault');
    });
    const storeStop = vi.spyOn(TelemetryStore.prototype, 'stop').mockImplementation(function (this: TelemetryStore) {
      originalStoreStop.call(this);
      throw new Error('store cleanup fault');
    });
    const transcriptDispose = vi.spyOn(TranscriptStore.prototype, 'dispose').mockImplementation(function (this: TranscriptStore) {
      originalTranscriptDispose.call(this);
      throw new Error('transcript cleanup fault');
    });
    const instance = mountSupervisorTui({ projectDir, ptyRunner: runner as unknown as PtyRunner });
    const unmount = renderMock.mock.results.at(-1)?.value.unmount as ReturnType<typeof vi.fn>;
    const rerender = renderMock.mock.results.at(-1)?.value.rerender as ReturnType<typeof vi.fn>;
    unmount.mockImplementation(() => { throw new Error('Ink cleanup fault'); });
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      writes.push(value);
      if (value.includes('\x1b[?1049l')) throw new Error('screen cleanup fault');
      return true;
    }) as typeof process.stdout.write;
    const pendingDataCallback = [...runner.dataCallbacks][0];
    const writeSpy = vi.spyOn(instance.virtualTerminal, 'write');

    instance.unmount();
    pendingDataCallback?.('too late');
    runner.emitExit(9);
    await Promise.resolve();

    expect(transcriptDispose).toHaveBeenCalledTimes(1);
    expect(storeStop).toHaveBeenCalledTimes(1);
    expect(vtDispose).toHaveBeenCalledTimes(1);
    expect(runner.kill).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(writes.some((value) => value.includes('\x1b[?1049l'))).toBe(true);
    expect(writes.some((value) => value.includes('\x1b[?25h'))).toBe(true);
    expect(runner.dataCallbacks.size).toBe(0);
    expect(process.stdout.listenerCount('resize')).toBe(priorResizeListeners);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(loadLedger(projectDir).events.filter((event) => event.metadata?.kind === 'PROCESS_OUTCOME')).toHaveLength(1);
    expect(rerender).not.toHaveBeenCalled();
    await expect(instance.waitUntilExit()).resolves.toBeUndefined();
  });

  it('removes listeners across repeated mounts', () => {
    const runner = new FakeRunner();
    const priorResizeListeners = process.stdout.listenerCount('resize');
    for (let index = 0; index < 2; index++) {
      const instance = mountSupervisorTui({ projectDir, ptyRunner: runner as unknown as PtyRunner });
      expect(runner.dataCallbacks.size).toBe(1);
      expect(runner.exitCallbacks.size).toBe(1);
      instance.unmount();
      expect(runner.dataCallbacks.size).toBe(0);
      expect(runner.exitCallbacks.size).toBe(0);
    }
    expect(process.stdout.listenerCount('resize')).toBe(priorResizeListeners);
  });

  it('records standalone startup failure and restores the normal screen when render throws', () => {
    const runner = new FakeRunner();
    const priorResizeListeners = process.stdout.listenerCount('resize');
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
    renderMock.mockImplementation(() => { throw new Error('render setup failed'); });

    expect(() => mountSupervisorTui({ projectDir, ptyRunner: runner as unknown as PtyRunner })).toThrow('render setup failed');
    expect(loadLedger(projectDir).events.find((event) => event.metadata?.kind === 'PROCESS_OUTCOME')?.metadata)
      .toMatchObject({ outcomeKind: 'startup_error', message: 'render setup failed' });
    expect(writes.some((value) => value.includes('\x1b[?1049l'))).toBe(true);
    expect(runner.dataCallbacks.size).toBe(0);
    expect(runner.exitCallbacks.size).toBe(0);
    expect(process.stdout.listenerCount('resize')).toBe(priorResizeListeners);
  });
});
