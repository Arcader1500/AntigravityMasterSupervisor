import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createJournalReader, createJournalWriter } from '../../src/core/event-journal.js';

const roots: string[] = [];
function tempFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-journal-'));
  roots.push(root);
  return path.join(root, 'events.jsonl');
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    source: 'synthetic-fixture',
    sequence: 1,
    receivedAt: '2026-10-25T00:00:00.000Z',
    kind: 'observation',
    eventId: 'event-1',
    payload: { text: 'synthetic event' },
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('event journal', () => {
  it('appends durably and idempotently by event ID', () => {
    const file = tempFile();
    const writer = createJournalWriter(file);
    expect(writer.append(event()).appended).toBe(true);
    expect(writer.append(event()).appended).toBe(false);
    expect(createJournalReader(file).read().events).toHaveLength(1);
  });

  it('redacts secret patterns and caps captured output at 64 KiB', () => {
    const file = tempFile();
    const payload = { stdout: `token=secret-value ${'x'.repeat(70 * 1024)}`, apiKey: 'secret-property-value' };
    createJournalWriter(file).append(event({ payload }));
    const result = createJournalReader(file).read();
    const saved = result.events[0].payload as { stdout: string };
    expect(saved.stdout).not.toContain('secret-value');
    expect(result.events[0].payload).not.toHaveProperty('apiKey', 'secret-property-value');
    expect(saved.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.events[0].truncation?.stdout).toBe(true);
  });

  it('omits payload when redaction cannot safely serialize it', () => {
    const file = tempFile();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    createJournalWriter(file).append(event({ payload: cyclic }));
    const saved = createJournalReader(file).read().events[0];
    expect(saved).not.toHaveProperty('payload');
    expect(saved.payloadOmitted).toBe('redaction_failed');
  });

  it('reports duplicates, out-of-order events, sequence gaps, malformed and unsupported records', () => {
    const file = tempFile();
    fs.writeFileSync(file, [
      JSON.stringify(event()),
      JSON.stringify(event({ eventId: 'event-1' })),
      JSON.stringify(event({ eventId: 'event-old', sequence: 0 })),
      JSON.stringify(event({ eventId: 'event-gap', sequence: 3 })),
      JSON.stringify(event({ eventId: 'event-unsupported', sequence: 4, schemaVersion: 2 })),
      '{broken',
      JSON.stringify(event({ eventId: 'event-after-corruption', sequence: 2 })),
    ].join('\n') + '\n');
    const result = createJournalReader(file).read();
    expect(result.events.map((item) => item.eventId)).toEqual(['event-1']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.outOfOrder).toHaveLength(1);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['missing-segment', 'unsupported-version', 'malformed-record']));
    expect(result.lastValidSequence).toBe(1);
  });

  it('reports missing and truncated journal files', () => {
    const missing = createJournalReader(tempFile()).read();
    expect(missing.errors[0].code).toBe('missing-file');
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify(event()));
    expect(createJournalReader(file).read().errors[0].code).toBe('truncated-record');
  });

  it('reads only synthetic fixtures', () => {
    const fixtureRoot = path.resolve('tests/fixtures/stage-b');
    for (const name of ['stream-event.jsonl', 'permission-event.jsonl', 'duplicate-replay.jsonl']) {
      const parsed = createJournalReader(path.join(fixtureRoot, name)).read();
      expect(parsed.events.length, name).toBeGreaterThan(0);
      expect(parsed.events.every((item) => item.source === 'synthetic-fixture')).toBe(true);
    }
  });
});
