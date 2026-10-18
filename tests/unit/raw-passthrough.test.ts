import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachRawPassthrough } from '../../src/pty/raw-passthrough.js';

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  resume = vi.fn();
  pause = vi.fn();
}

class MockStdout extends EventEmitter {
  columns = 120;
  rows = 40;
}

describe('attachRawPassthrough', () => {
  it('enables raw mode, forwards stdin data to ptyRunner, and forwards stdout resize', () => {
    const mockPty = {
      write: vi.fn(),
      resize: vi.fn(),
    };
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const handle = attachRawPassthrough(
      mockPty,
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream
    );

    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.resume).toHaveBeenCalled();

    // Verify stdin forwarding Buffer
    stdin.emit('data', Buffer.from('ls -la\n'));
    expect(mockPty.write).toHaveBeenCalledWith('ls -la\n');

    // Verify stdin forwarding string
    stdin.emit('data', 'echo test\n');
    expect(mockPty.write).toHaveBeenCalledWith('echo test\n');

    // Verify stdout resize forwarding
    stdout.columns = 140;
    stdout.rows = 45;
    stdout.emit('resize');
    expect(mockPty.resize).toHaveBeenCalledWith(140, 45);

    // Verify detach restores raw mode and removes listeners
    handle.detach();
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);

    // Subsequent events should not trigger pty methods
    mockPty.write.mockClear();
    mockPty.resize.mockClear();

    stdin.emit('data', Buffer.from('after detach'));
    stdout.emit('resize');

    expect(mockPty.write).not.toHaveBeenCalled();
    expect(mockPty.resize).not.toHaveBeenCalled();
  });

  it('handles non-TTY stdin gracefully without error', () => {
    const mockPty = {
      write: vi.fn(),
      resize: vi.fn(),
    };
    const stdin = new EventEmitter() as unknown as NodeJS.ReadStream & { isTTY?: boolean };
    stdin.isTTY = false;
    const stdout = new MockStdout();

    let handle: { detach: () => void } | undefined;
    expect(() => {
      handle = attachRawPassthrough(mockPty, stdin as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
    }).not.toThrow();

    handle?.detach();
  });

  it('is idempotent when calling detach multiple times', () => {
    const mockPty = {
      write: vi.fn(),
      resize: vi.fn(),
    };
    const stdin = new MockStdin();
    const stdout = new MockStdout();

    const handle = attachRawPassthrough(
      mockPty,
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream
    );

    handle.detach();
    expect(stdin.setRawMode).toHaveBeenCalledTimes(2); // once true, once false

    handle.detach();
    expect(stdin.setRawMode).toHaveBeenCalledTimes(2); // no extra setRawMode calls
  });
});
