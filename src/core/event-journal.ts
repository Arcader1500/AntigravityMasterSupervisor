import * as fs from 'node:fs';
import * as path from 'node:path';

export interface JournalEvent<Payload = unknown> {
  schemaVersion: number;
  runId: string;
  sessionId: string;
  source: string;
  sequence: number;
  receivedAt: string;
  kind: string;
  payload?: Payload;
  eventId: string;
  payloadOmitted?: 'redaction_failed';
  truncation?: { stdout?: boolean; stderr?: boolean };
}

export interface JournalIssue {
  code: 'missing-file' | 'read-error' | 'malformed-record' | 'truncated-record' | 'unsupported-version' | 'missing-segment' | 'invalid-event';
  line?: number;
  message: string;
}

export interface JournalReadResult {
  events: JournalEvent[];
  duplicates: Array<{ line: number; eventId: string }>;
  outOfOrder: Array<{ line: number; eventId: string; sequence: number }>;
  errors: JournalIssue[];
  lastValidSequence: number | null;
}

export interface JournalReader {
  read(): JournalReadResult;
}

export interface JournalWriter {
  append(event: JournalEvent): { appended: boolean; eventId: string };
}

const SCHEMA_VERSION = 1;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SECRET_PATTERN = /(token|secret|password|api[_-]?key|authorization)(\s*["']?\s*[:=]\s*["']?)([^\s,"';]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SENSITIVE_KEY = /token|secret|password|api[_-]?key|authorization/i;

function redactText(value: string): string {
  return value
    .replace(SECRET_PATTERN, '$1$2[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}

function sanitizePayload(value: unknown): { payload?: unknown; truncation?: JournalEvent['truncation']; failed: boolean } {
  const seen = new WeakSet<object>();
  const truncation: NonNullable<JournalEvent['truncation']> = {};
  const visit = (input: unknown, key = ''): unknown => {
    if (typeof input === 'string') {
      if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
      const redacted = redactText(input);
      if (key === 'stdout' || key === 'stderr') {
        const capped = Buffer.from(redacted, 'utf8');
        if (capped.byteLength > MAX_OUTPUT_BYTES) {
          truncation[key] = true;
          return capped.subarray(0, MAX_OUTPUT_BYTES).toString('utf8').replace(/\uFFFD$/, '');
        }
      }
      return redacted;
    }
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) throw new Error('cyclic payload');
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => visit(item));
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([childKey, child]) => [childKey, visit(child, childKey)]));
  };

  try {
    const payload = visit(value);
    return { payload, ...(Object.keys(truncation).length ? { truncation } : {}), failed: false };
  } catch {
    return { failed: true };
  }
}

function isJournalEvent(value: unknown): value is JournalEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<JournalEvent>;
  return Number.isInteger(event.schemaVersion) && typeof event.runId === 'string' &&
    typeof event.sessionId === 'string' && typeof event.source === 'string' &&
    Number.isInteger(event.sequence) && (event.sequence ?? 0) >= 0 &&
    typeof event.receivedAt === 'string' && typeof event.kind === 'string' && typeof event.eventId === 'string';
}

export function createJournalReader(filePath: string): JournalReader {
  return {
    read(): JournalReadResult {
      const result: JournalReadResult = { events: [], duplicates: [], outOfOrder: [], errors: [], lastValidSequence: null };
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-file' : 'read-error';
        result.errors.push({ code, message: `Unable to read journal: ${(error as Error).message}` });
        return result;
      }

      const lines = content.split('\n');
      if (content.length > 0 && !content.endsWith('\n')) {
        result.errors.push({ code: 'truncated-record', line: lines.length, message: 'Final journal record is not newline terminated.' });
        lines.pop();
      } else {
        lines.pop();
      }

      const ids = new Set<string>();
      const sequences = new Map<string, number>();
      const taintedSources = new Set<string>();
      let unknownGap = false;
      for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index];
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          result.errors.push({ code: 'malformed-record', line: lineNumber, message: 'Journal record is not valid JSON.' });
          unknownGap = true;
          continue;
        }
        if (!isJournalEvent(value)) {
          result.errors.push({ code: 'invalid-event', line: lineNumber, message: 'Journal record is missing required event fields.' });
          unknownGap = true;
          continue;
        }
        if (value.schemaVersion !== SCHEMA_VERSION) {
          result.errors.push({ code: 'unsupported-version', line: lineNumber, message: `Unsupported journal schema version ${value.schemaVersion}.` });
          taintedSources.add(`${value.runId}\0${value.sessionId}\0${value.source}`);
          continue;
        }
        if (ids.has(value.eventId)) {
          result.duplicates.push({ line: lineNumber, eventId: value.eventId });
          continue;
        }
        const sourceKey = `${value.runId}\0${value.sessionId}\0${value.source}`;
        const previous = sequences.get(sourceKey);
        if (previous !== undefined && value.sequence <= previous) {
          result.outOfOrder.push({ line: lineNumber, eventId: value.eventId, sequence: value.sequence });
          taintedSources.add(sourceKey);
          continue;
        }
        if (previous !== undefined && value.sequence > previous + 1) {
          result.errors.push({ code: 'missing-segment', line: lineNumber, message: `Sequence gap after ${previous}; found ${value.sequence}.` });
          taintedSources.add(sourceKey);
          continue;
        }
        if (unknownGap || taintedSources.has(sourceKey)) continue;
        ids.add(value.eventId);
        sequences.set(sourceKey, value.sequence);
        result.events.push(value);
        result.lastValidSequence = value.sequence;
      }
      return result;
    },
  };
}

export function createJournalWriter(filePath: string): JournalWriter {
  return {
    append(event: JournalEvent): { appended: boolean; eventId: string } {
      if (!isJournalEvent(event)) throw new TypeError('Invalid journal event.');
      if (event.schemaVersion !== SCHEMA_VERSION) throw new TypeError(`Unsupported journal schema version ${event.schemaVersion}.`);
      const current = createJournalReader(filePath).read();
      if (current.events.some((item) => item.eventId === event.eventId) || current.duplicates.some((item) => item.eventId === event.eventId)) {
        return { appended: false, eventId: event.eventId };
      }
      const lastForSource = [...current.events].reverse().find((item) => item.runId === event.runId && item.sessionId === event.sessionId && item.source === event.source);
      if (lastForSource && event.sequence <= lastForSource.sequence) throw new Error('Journal sequence must increase for each run/session/source.');

      const safe = sanitizePayload(event.payload);
      const normalized: JournalEvent = {
        ...event,
        ...(safe.failed ? { payloadOmitted: 'redaction_failed' as const } : { payload: safe.payload }),
        ...(safe.truncation ? { truncation: safe.truncation } : {}),
      };
      if (safe.failed) delete normalized.payload;

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(filePath, 'a');
      try {
        fs.writeSync(fd, `${JSON.stringify(normalized)}\n`, undefined, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { appended: true, eventId: event.eventId };
    },
  };
}
