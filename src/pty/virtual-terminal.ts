import * as xtermHeadless from '@xterm/headless';
import type { Terminal as HeadlessTerminalType } from '@xterm/headless';
import type { VirtualTerminalOptions } from './types.js';

// Resolve Terminal constructor handling both ESM namespace and CJS default exports
const HeadlessTerminal: typeof HeadlessTerminalType =
  (xtermHeadless as unknown as { Terminal?: typeof HeadlessTerminalType }).Terminal ??
  (xtermHeadless as unknown as { default?: { Terminal?: typeof HeadlessTerminalType } }).default?.Terminal ??
  (xtermHeadless as unknown as typeof HeadlessTerminalType);

/**
 * Headless virtual terminal buffer wrapping @xterm/headless.
 * Emulates terminal escape sequences, manages viewport lines, and emits
 * settled plain-text lines for telemetry parsing.
 */
export class VirtualTerminal {
  private term: HeadlessTerminalType;
  private lineCommitListeners: Array<(line: string) => void> = [];
  private lastCommittedRow: number = 0;
  private lastEmittedLine: string | null = null;
  private isDisposed: boolean = false;

  constructor(options?: VirtualTerminalOptions) {
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const scrollback = options?.scrollback ?? 1000;

    this.term = new HeadlessTerminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
  }

  /**
   * Writes raw chunk/ANSI stream to the virtual terminal emulator.
   * Resolves after parser completes processing, and emits any newly settled lines.
   */
  async write(data: string): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.term.write(data, () => {
        this.processCommittedLines();
        resolve();
      });
    });
  }

  /**
   * Subscribes a listener to receive newly settled lines (e.g. after newline / carriage-return overwrites).
   * Returns an unsubscribe function.
   */
  onLineCommit(callback: (line: string) => void): () => void {
    this.lineCommitListeners.push(callback);
    return () => {
      const idx = this.lineCommitListeners.indexOf(callback);
      if (idx !== -1) {
        this.lineCommitListeners.splice(idx, 1);
      }
    };
  }

  /**
   * Returns visible plain-text lines from the current active viewport.
   * Trailing empty lines are trimmed, and output is capped to maxRows if provided.
   */
  getViewportLines(maxRows?: number): string[] {
    const buf = this.term.buffer.active;
    const startY = buf.viewportY;
    const totalRows = this.term.rows;
    const lines: string[] = [];

    for (let i = 0; i < totalRows; i++) {
      const line = buf.getLine(startY + i);
      lines.push(line ? line.translateToString(true) : '');
    }

    // Strip trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    if (maxRows !== undefined && maxRows >= 0 && lines.length > maxRows) {
      return lines.slice(0, maxRows);
    }

    return lines;
  }

  /**
   * Returns the current active line under the cursor.
   */
  getCursorLine(): string {
    const buf = this.term.buffer.active;
    const cursorRow = buf.baseY + buf.cursorY;
    const line = buf.getLine(cursorRow);
    return line ? line.translateToString(true) : '';
  }

  /**
   * Resizes virtual terminal column width and row height.
   */
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }

  /**
   * Returns current terminal column width.
   */
  getCols(): number {
    return this.term.cols;
  }

  /**
   * Returns current terminal row height.
   */
  getRows(): number {
    return this.term.rows;
  }

  /**
   * Disposes the headless terminal emulator and clears active listeners.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.lineCommitListeners = [];
    this.term.dispose();
  }

  private processCommittedLines(): void {
    const buf = this.term.buffer.active;
    const currentCursorRow = buf.baseY + buf.cursorY;

    if (currentCursorRow < this.lastCommittedRow) {
      this.lastCommittedRow = currentCursorRow;
    }

    if (currentCursorRow > this.lastCommittedRow) {
      for (let y = this.lastCommittedRow; y < currentCursorRow; y++) {
        const line = buf.getLine(y);
        if (!line) {
          continue;
        }

        const text = line.translateToString(true).trim();
        if (text.length === 0) {
          continue;
        }

        if (text === this.lastEmittedLine) {
          continue;
        }

        this.lastEmittedLine = text;
        for (const listener of this.lineCommitListeners) {
          try {
            listener(text);
          } catch (err) {
            console.error('Error in VirtualTerminal onLineCommit listener:', err);
          }
        }
      }

      this.lastCommittedRow = currentCursorRow;
    }
  }
}
