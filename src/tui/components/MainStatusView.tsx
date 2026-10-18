import React from 'react';
import { Box, Text } from 'ink';
import type { TelemetrySnapshot } from '../../telemetry/types.js';
import { formatDuration } from './HeaderBar.js';

export interface MainStatusViewProps {
  snapshot: TelemetrySnapshot;
}

export const MainStatusView: React.FC<MainStatusViewProps> = ({ snapshot }) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* CURRENTLY RUNNING SECTION */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="yellow">
          ⚡ CURRENTLY RUNNING
        </Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            Main Agent : <Text bold color="cyan">{snapshot.mainAgent}</Text>
            {snapshot.pid ? <Text color="gray"> (PID {snapshot.pid})</Text> : null}
          </Text>
          <Text>
            Phase Elapsed : <Text color="yellow">{formatDuration(snapshot.phaseElapsedMs)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            Subagent   : <Text bold color="magenta">{snapshot.activeSubagent || 'None'}</Text>
          </Text>
          <Text>
            Task Elapsed  : <Text color="yellow">{formatDuration(snapshot.subagentElapsedMs)}</Text>
          </Text>
        </Box>
        <Box flexDirection="row">
          <Text>Last Action: </Text>
          <Text color="white">{snapshot.lastAction || 'None'}</Text>
        </Box>
        <Box flexDirection="row">
          <Text>Last Cmd   : </Text>
          <Text color="gray">{snapshot.lastCommand || 'None'}</Text>
        </Box>
      </Box>

      {/* PIPELINE & TASK PROGRESS and CLEAN ACTIVITY FEED */}
      <Box flexDirection="row" gap={1}>
        {/* Left Pane: Pipeline & Task Progress */}
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="cyan">
            📋 PIPELINE & TASK PROGRESS
          </Text>
          <Box flexDirection="column" marginY={1}>
            <Text color={snapshot.specPath ? 'green' : 'gray'}>
              {snapshot.specPath ? '[✓]' : '[ ]'} Spec: {snapshot.specPath ? snapshot.specPath : 'Pending'}
            </Text>
            <Text color={snapshot.planPath ? 'green' : 'gray'}>
              {snapshot.planPath ? '[✓]' : '[ ]'} Plan: {snapshot.planPath ? snapshot.planPath : 'Pending'}
            </Text>
          </Box>
          <Box flexDirection="column">
            {snapshot.tasks.length === 0 ? (
              <Text color="gray">No tasks found</Text>
            ) : (
              snapshot.tasks.map((task) => {
                const icon =
                  task.status === 'completed'
                    ? '[✓]'
                    : task.status === 'in_progress'
                    ? '[▶]'
                    : '[ ]';
                const iconColor =
                  task.status === 'completed'
                    ? 'green'
                    : task.status === 'in_progress'
                    ? 'yellow'
                    : 'gray';
                return (
                  <Box key={task.id} flexDirection="row">
                    <Text color={iconColor}>{icon} </Text>
                    <Text color={task.status === 'pending' ? 'gray' : 'white'}>
                      {task.title}
                    </Text>
                    {task.commitSha ? (
                      <Text color="gray"> ({task.commitSha})</Text>
                    ) : null}
                  </Box>
                );
              })
            )}
          </Box>
        </Box>

        {/* Right Pane: Clean Activity Feed */}
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="cyan">
            📡 CLEAN ACTIVITY FEED
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {snapshot.activityFeed.length === 0 ? (
              <Text color="gray">No recent activity</Text>
            ) : (
              snapshot.activityFeed.slice(-15).map((item) => (
                <Box key={item.id} flexDirection="row">
                  <Text color="gray">
                    {item.timestamp.includes('T')
                      ? item.timestamp.slice(11, 19)
                      : item.timestamp}{' '}
                  </Text>
                  <Text bold color="blue">
                    [{item.actor.toUpperCase()}]{' '}
                  </Text>
                  <Text>{item.message}</Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
