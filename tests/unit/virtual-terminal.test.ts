import { describe, it, expect, vi } from 'vitest';
import { VirtualTerminal } from '../../src/pty/virtual-terminal.js';

describe('VirtualTerminal', () => {
  it('buffers ANSI streams, handles carriage-return overwrites, and emits settled lines', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    const committed: string[] = [];
    vt.onLineCommit((line) => committed.push(line));

    await vt.write('\x1b[36mSpinning...\x1b[0m\r\x1b[2KCompleted step 1\r\nSecond line\r\n');
    const lines = vt.getViewportLines();
    expect(lines[0]).toBe('Completed step 1');
    expect(lines[1]).toBe('Second line');
    expect(committed).toContain('Completed step 1');
    expect(committed).toContain('Second line');
    vt.dispose();
  });

  it('updates getViewportLines with stripped plain-text lines for ANSI sequences', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    await vt.write('\x1b[32mHello\x1b[0m\r\nWorld\r\n');
    const lines = vt.getViewportLines();
    expect(lines).toEqual(['Hello', 'World']);
    vt.dispose();
  });

  it('resolves spinner overwrites to settled line and avoids duplicate empty lines', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    const committed: string[] = [];
    vt.onLineCommit((line) => committed.push(line));

    await vt.write('frame1\r\x1b[2Kframe2\r\x1b[2KDone\r\n\r\n\r\n');
    const lines = vt.getViewportLines();
    expect(lines[0]).toBe('Done');
    expect(committed).toEqual(['Done']);
    vt.dispose();
  });

  it('limits lines when maxRows is specified in getViewportLines', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    await vt.write('Line 1\r\nLine 2\r\nLine 3\r\n');
    const allLines = vt.getViewportLines();
    expect(allLines).toEqual(['Line 1', 'Line 2', 'Line 3']);

    const limited = vt.getViewportLines(2);
    expect(limited).toEqual(['Line 1', 'Line 2']);
    vt.dispose();
  });

  it('returns the active line under the cursor via getCursorLine', async () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    await vt.write('Prompt: typing here');
    expect(vt.getCursorLine()).toBe('Prompt: typing here');

    await vt.write('\r\nNext active line');
    expect(vt.getCursorLine()).toBe('Next active line');
    vt.dispose();
  });

  it('resizes dimensions and reflects cols and rows', () => {
    const vt = new VirtualTerminal({ cols: 80, rows: 24 });
    expect(vt.getCols()).toBe(80);
    expect(vt.getRows()).toBe(24);

    vt.resize(100, 40);
    expect(vt.getCols()).toBe(100);
    expect(vt.getRows()).toBe(40);
    vt.dispose();
  });

  it('allows unsubscribing from onLineCommit', async () => {
    const vt = new VirtualTerminal();
    const committed: string[] = [];
    const unsubscribe = vt.onLineCommit((line) => committed.push(line));

    await vt.write('First line\r\n');
    expect(committed).toEqual(['First line']);

    unsubscribe();
    await vt.write('Second line\r\n');
    expect(committed).toEqual(['First line']);
    vt.dispose();
  });
});
