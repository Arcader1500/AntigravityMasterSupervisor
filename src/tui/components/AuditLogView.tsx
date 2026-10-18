import React from 'react';
import { Box, Text } from 'ink';
import type { SupervisorLedger } from '../../core/types.js';

export interface AuditLogViewProps {
  ledger: SupervisorLedger;
  scrollOffset: number;
  maxRows?: number;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({
  ledger,
  scrollOffset,
  maxRows = 20,
}) => {
  const events = ledger.events ?? [];
  const visibleEvents = events.slice(scrollOffset, scrollOffset + maxRows);
  const startIdx = events.length > 0 ? scrollOffset + 1 : 0;
  const endIdx = Math.min(scrollOffset + maxRows, events.length);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Session Metadata */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="cyan">
            📜 SUPERVISOR AUDIT LEDGER
          </Text>
          <Text color="gray">
            Status: <Text bold color="green">{ledger.status}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text>
            Session ID   : <Text color="yellow">{ledger.sessionId}</Text>
          </Text>
          <Text>
            Active Agent : <Text color="magenta">{ledger.activeAgent || 'None'}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" gap={3} marginTop={1}>
          <Text>
            Spec Checkpoint: <Text bold color={ledger.checkpoints?.spec?.status === 'APPROVED' ? 'green' : 'yellow'}>{ledger.checkpoints?.spec?.status ?? 'UNINITIALIZED'}</Text>
          </Text>
          <Text>
            Plan Checkpoint: <Text bold color={ledger.checkpoints?.plan?.status === 'APPROVED' ? 'green' : 'yellow'}>{ledger.checkpoints?.plan?.status ?? 'UNINITIALIZED'}</Text>
          </Text>
        </Box>
      </Box>

      {/* Events List */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Text bold color="cyan">
            AUDIT EVENTS ({events.length} total)
          </Text>
          {events.length > 0 && (
            <Text color="gray">
              Showing events {startIdx}-{endIdx} of {events.length} (Scroll with [↑/↓] or [k/j])
            </Text>
          )}
        </Box>

        {events.length === 0 ? (
          <Box paddingY={1}>
            <Text color="gray">No audit events logged.</Text>
          </Box>
        ) : (
          visibleEvents.map((evt, idx) => {
            const levelColor =
              evt.level === 'ERROR'
                ? 'red'
                : evt.level === 'WARN'
                ? 'yellow'
                : 'cyan';
            return (
              <Box key={scrollOffset + idx} flexDirection="row">
                <Text color="gray">[{evt.timestamp}] </Text>
                <Text bold color={levelColor}>
                  [{evt.level}]{' '}
                </Text>
                <Text>{evt.message}</Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
};
