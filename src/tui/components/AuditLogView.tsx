import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box, Text, measureElement } from 'ink';
import type { SupervisorLedger } from '../../core/types.js';
import type { TelemetrySnapshot } from '../../telemetry/types.js';
import { deriveProcessPresentation, type ProcessPresentation } from '../process-presentation.js';

export interface AuditLogViewProps {
  ledger: SupervisorLedger;
  scrollOffset: number;
  maxRows?: number;
  width?: number;
  snapshot?: TelemetrySnapshot;
  processPresentation?: ProcessPresentation;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({
  ledger,
  scrollOffset,
  maxRows = 20,
  width,
  snapshot,
  processPresentation,
}) => {
  const presentation = processPresentation ?? deriveProcessPresentation(ledger, snapshot);
  const events = ledger.events ?? [];
  const candidateEvents = events.slice(scrollOffset, scrollOffset + maxRows);
  const sessionNode = useRef<React.ElementRef<typeof Box>>(null);
  const presentationNode = useRef<React.ElementRef<typeof Box>>(null);
  const eventsHeaderNode = useRef<React.ElementRef<typeof Box>>(null);
  const eventNodes = useRef(new Map<number, React.ElementRef<typeof Box>>());
  const compact = width !== undefined && width < 80;
  const [sessionRows, setSessionRows] = useState(0);
  const [presentationRows, setPresentationRows] = useState(0);
  const [eventsHeaderRows, setEventsHeaderRows] = useState(2);
  const [visibleEventCount, setVisibleEventCount] = useState(maxRows);

  const eventsFrameRows = Math.max(
    0,
    maxRows - sessionRows - 1 - presentationRows - 1
  );
  const visibleEventRows = Math.max(0, eventsFrameRows - 2 - eventsHeaderRows);

  useLayoutEffect(() => {
    const measuredSession = sessionNode.current ? measureElement(sessionNode.current).height : 0;
    const measuredPresentation = presentationNode.current ? measureElement(presentationNode.current).height : 0;
    const measuredHeader = eventsHeaderNode.current ? measureElement(eventsHeaderNode.current).height : 0;
    if (measuredSession > 0 && measuredSession !== sessionRows) setSessionRows(measuredSession);
    if (measuredPresentation > 0 && measuredPresentation !== presentationRows) setPresentationRows(measuredPresentation);
    const eventsHeaderHeight = measuredHeader > 0 ? measuredHeader + 1 : 0;
    if (eventsHeaderHeight > 0 && eventsHeaderHeight !== eventsHeaderRows) {
      setEventsHeaderRows(eventsHeaderHeight);
    }

    let usedRows = 0;
    let count = 0;
    for (let index = 0; index < candidateEvents.length; index++) {
      const node = eventNodes.current.get(scrollOffset + index);
      const height = node ? measureElement(node).height : 0;
      if (height <= 0 || (usedRows + height > visibleEventRows && count > 0)) break;
      if (height > visibleEventRows) break;
      usedRows += height;
      count++;
    }
    if (count !== visibleEventCount) setVisibleEventCount(count);
  });

  const visibleEvents = candidateEvents.slice(0, visibleEventCount);
  const startIdx = events.length > 0 ? scrollOffset + 1 : 0;
  const endIdx = Math.min(scrollOffset + visibleEvents.length, events.length);

  return (
    <Box width={width} flexDirection="column" paddingX={1} height={maxRows} overflowY="hidden" flexShrink={0}>
      {/* Session Metadata */}
      <Box
        ref={sessionNode}
        flexDirection="column"
        borderStyle={compact ? undefined : 'single'}
        borderColor="gray"
        paddingX={compact ? 0 : 1}
        marginBottom={1}
        flexShrink={0}
      >
        {compact ? (
          <Text bold color="cyan">📜 Audit ledger · {ledger.status} · {ledger.sessionId}</Text>
        ) : (
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color="cyan">📜 SUPERVISOR AUDIT LEDGER</Text>
              <Text color="gray">Recorded status: <Text bold color="yellow">{ledger.status}</Text></Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
              <Text>Session ID   : <Text color="yellow">{ledger.sessionId}</Text></Text>
              <Text>Active Agent : <Text color="magenta">{ledger.activeAgent || 'None'}</Text></Text>
            </Box>
            <Box flexDirection="row" gap={3} marginTop={1}>
              <Text>Spec checkpoint recorded: <Text bold color="yellow">{ledger.checkpoints?.spec?.status ?? 'UNINITIALIZED'}</Text></Text>
              <Text>Plan checkpoint recorded: <Text bold color="yellow">{ledger.checkpoints?.plan?.status ?? 'UNINITIALIZED'}</Text></Text>
            </Box>
          </>
        )}
      </Box>

      <Box ref={presentationNode} flexDirection="column" marginBottom={1} flexShrink={0}>
        <Text>{presentation.outcomeText}</Text>
        {compact ? (
          <Text>{presentation.sourceText} {presentation.reviewText}</Text>
        ) : (
          <>
            <Text>{presentation.sourceText}</Text>
            <Text>{presentation.reviewText}</Text>
          </>
        )}
        <Text>{compact ? presentation.progressText.split(';')[0] : presentation.progressText}</Text>
      </Box>

      {/* Events List */}
      {eventsFrameRows > 0 && <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        height={eventsFrameRows}
        overflowY="hidden"
        flexShrink={0}
      >
        <Box ref={eventsHeaderNode} flexDirection="row" justifyContent="space-between" marginBottom={1} flexShrink={0}>
          <Text bold color="cyan">
            {compact ? `AUDIT EVENTS (${events.length} total) · ${startIdx}-${endIdx} shown` : `AUDIT EVENTS (${events.length} total)`}
          </Text>
          {!compact && events.length > 0 && (
            <Text color="gray">
              Showing events {startIdx}-{endIdx} of {events.length} (Scroll with [↑/↓] or [k/j])
            </Text>
          )}
        </Box>

        {events.length === 0 ? (
          <Box height={visibleEventRows} overflowY="hidden" paddingY={1} flexShrink={0}>
            <Text color="gray">No audit events logged.</Text>
          </Box>
        ) : (
          <Box height={visibleEventRows} overflowY="hidden" flexDirection="column" flexShrink={0}>
          {candidateEvents.map((evt, idx) => {
            const levelColor =
              evt.level === 'ERROR'
                ? 'red'
                : evt.level === 'WARN'
                ? 'yellow'
                : 'cyan';
            return (
              <Box key={scrollOffset + idx} ref={(node) => node ? eventNodes.current.set(scrollOffset + idx, node) : eventNodes.current.delete(scrollOffset + idx)} flexDirection="row" flexShrink={0}>
                <Text color="gray">[{evt.timestamp}] </Text>
                <Text bold color={levelColor}>
                  [{evt.level}]{' '}
                </Text>
                <Text>{evt.message}</Text>
              </Box>
            );
          })}
          </Box>
        )}
      </Box>}
    </Box>
  );
};
