import { describe, expect, it } from 'vitest';
import { createInputDecoder } from '../../src/tui/input-events.js';

describe('createInputDecoder', () => {
  it('suppresses a CRLF pair split across chunks while preserving subsequent submits', () => {
    const decoder = createInputDecoder();
    const cr = decoder.push('\r');
    const lf = decoder.push('\n\r\n');
    expect(cr.map((event) => event.kind)).toEqual(['submit']);
    expect(lf.map((event) => event.kind)).toEqual(['submit']);
    expect(lf.map((event) => event.raw)).toEqual(['\r']);
  });

  it('assigns unique IDs across reset and preserves text and escape sequences', () => {
    const decoder = createInputDecoder();
    const first = decoder.push('ab\x1b[A\r');
    decoder.reset();
    const second = decoder.push('c\n');
    expect(first.map((event) => [event.kind, event.raw])).toEqual([
      ['text', 'a'], ['text', 'b'], ['key', '\x1b[A'], ['submit', '\r'],
    ]);
    expect(second.map((event) => event.kind)).toEqual(['text', 'submit']);
    expect(new Set([...first, ...second].map((event) => event.id)).size).toBe(6);
  });

  it('preserves bracketed multiline paste as one text event', () => {
    const decoder = createInputDecoder();
    expect(decoder.push('\x1b[200~first\r\nsecond\x1b[201~')).toMatchObject([
      { kind: 'text', raw: 'first\r\nsecond' },
    ]);
  });
});
