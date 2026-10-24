export interface NormalizedInputEvent {
  id: string;
  kind: 'submit' | 'key' | 'text';
  raw: string;
  key?: string;
}

export function createInputDecoder(): {
  push(chunk: string): NormalizedInputEvent[];
  reset(): void;
} {
  let nextId = 1;
  let suppressLf = false;
  let escapeBuffer = '';
  const emit = (kind: NormalizedInputEvent['kind'], raw: string, key?: string) => ({
    id: `input-${nextId++}`,
    kind,
    raw,
    ...(key ? { key } : {}),
  });

  return {
    push(chunk) {
      const events: NormalizedInputEvent[] = [];
      let input = escapeBuffer + chunk;
      escapeBuffer = '';
      for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (suppressLf) {
          suppressLf = false;
          if (char === '\n') continue;
        }
        if (char === '\x1b') {
          const rest = input.slice(i);
          if (rest.startsWith('\x1b[200~')) {
            const end = input.indexOf('\x1b[201~', i + 6);
            if (end < 0) {
              escapeBuffer = input.slice(i);
              break;
            }
            events.push(emit('text', input.slice(i + 6, end)));
            i = end + 5;
            continue;
          }
          const match = rest.match(/^\x1b(?:\[[0-9;?]*[A-Za-z~]|O[A-Za-z])/);
          if (match) {
            events.push(emit('key', match[0], match[0]));
            i += match[0].length - 1;
            continue;
          }
          if (rest === '\x1b') {
            events.push(emit('key', char, 'escape'));
            continue;
          }
          if (/^\x1b(?:\[|O)[0-9;?]*$/.test(rest)) {
            escapeBuffer = rest;
            break;
          }
          events.push(emit('key', char, 'escape'));
          continue;
        }
        if (char === '\r' || char === '\n') {
          events.push(emit('submit', char, 'enter'));
          suppressLf = char === '\r';
        } else if (char === '\x03' || char === '\x14' || char === '\x12' || char === '\t' || char === '\x7f' || char === '\b' || char === '\x1d') {
          events.push(emit('key', char, char));
        } else {
          events.push(emit('text', char));
        }
      }
      return events;
    },
    reset() {
      suppressLf = false;
      escapeBuffer = '';
    },
  };
}
