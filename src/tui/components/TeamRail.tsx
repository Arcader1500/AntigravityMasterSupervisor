import React from 'react';
import { Box, Text } from 'ink';
import type { TelemetrySnapshot, PlanTaskItem } from '../../telemetry/types.js';
import { resolveTheme, type ThemeConfig } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface TeamMemberRow {
  id: string;
  role: string;
  isMain: boolean;
  taskNumber?: number;
  statusText: string; // 'running' | 'waiting' | 'idle' | 'approved' | 'after Task N' | 'paused' | 'paused, needs you'
  elapsedFormatted?: string;
  needsYou: boolean;
}

export interface TeamRailProps {
  members: TeamMemberRow[];
  tasks: PlanTaskItem[];
  ledgerStatus?: string;
  selectedMemberIndex?: number;
  isFocused?: boolean;
  zoomTask?: PlanTaskItem | null;
  handledCounts?: { promptsApproved: number; questionsAnswered?: number; planFixes?: number };
  width?: number;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

export function formatElapsed(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function deriveTeamMembers(
  snapshot: TelemetrySnapshot,
  pendingDecisionCount: number,
  isPaused: boolean,
  ledgerStatus?: string
): TeamMemberRow[] {
  const tasks = snapshot.tasks ?? (snapshot as any).planTasks ?? [];

  const rawActive = (snapshot as any).activeAgent ?? snapshot.activeSubagent ?? null;
  const activeRole = typeof rawActive === 'string' ? rawActive.toLowerCase() : null;

  const isExecutionSubagent =
    activeRole !== null &&
    (activeRole.includes('implementer') ||
      activeRole.includes('reviewer') ||
      activeRole.includes('verifier') ||
      activeRole.includes('orchestrator'));

  const isPlanning =
    tasks.length === 0 &&
    !isExecutionSubagent &&
    (ledgerStatus === 'IDLE' ||
      ledgerStatus === 'INITIALIZING' ||
      ledgerStatus === 'PLANNING' ||
      ledgerStatus === 'CHECKPOINT_SPEC');

  const isWaiting = pendingDecisionCount > 0 || Boolean(snapshot.waitingForInput);
  const elapsedFormatted =
    (snapshot as any).elapsedFormatted ||
    (snapshot.subagentElapsedMs > 0 ? formatElapsed(snapshot.subagentElapsedMs) : undefined);

  if (isPlanning) {
    let activeId = 'planner';
    if (activeRole && activeRole.includes('researcher')) {
      activeId = 'researcher';
    } else if (activeRole && (activeRole.includes('critic') || activeRole.includes('plan-critic'))) {
      activeId = 'plan-critic';
    }

    const roles: Array<{ id: string; role: string; isMain: boolean }> = [
      { id: 'planner', role: 'planner', isMain: true },
      { id: 'researcher', role: 'researcher', isMain: false },
      { id: 'plan-critic', role: 'plan-critic', isMain: false },
    ];

    return roles.map(({ id, role, isMain }) => {
      const isActive = id === activeId;
      let statusText = 'idle';
      let needsYou = false;

      if (isActive) {
        if (isWaiting) {
          statusText = 'paused, needs you';
          needsYou = true;
        } else if (isPaused) {
          statusText = 'paused';
        } else {
          statusText = 'running';
        }
      } else if (id === 'planner' && activeId !== 'planner') {
        statusText = 'waiting';
      }

      return {
        id,
        role,
        isMain,
        statusText,
        elapsedFormatted: isActive ? elapsedFormatted : undefined,
        needsYou,
      };
    });
  }

  // Build / Execution phase
  let activeId = 'orchestrator';
  if (activeRole) {
    if (activeRole.includes('implementer')) {
      activeId = 'implementer';
    } else if (activeRole.includes('reviewer') || activeRole.includes('code-reviewer')) {
      activeId = 'code-reviewer';
    } else if (activeRole.includes('verifier')) {
      activeId = 'verifier';
    }
  }

  const inProgressTask = tasks.find((t) => t.status === 'in_progress');
  const inProgressTaskNum =
    inProgressTask?.index ??
    (inProgressTask ? tasks.indexOf(inProgressTask) + 1 : undefined);

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const lastCompleted = completedTasks[completedTasks.length - 1];
  const lastCompletedNum =
    lastCompleted?.index ??
    (lastCompleted ? tasks.indexOf(lastCompleted) + 1 : undefined);

  const totalTasks = tasks.length;

  const roles: Array<{ id: string; role: string; isMain: boolean }> = [
    { id: 'orchestrator', role: 'orchestrator', isMain: true },
    { id: 'implementer', role: 'implementer', isMain: false },
    { id: 'code-reviewer', role: 'code-reviewer', isMain: false },
    { id: 'verifier', role: 'verifier', isMain: false },
  ];

  return roles.map(({ id, role, isMain }) => {
    const isActive = id === activeId;
    let statusText = 'idle';
    let needsYou = false;
    let taskNumber: number | undefined;

    if (isActive) {
      if (isWaiting) {
        statusText = 'paused, needs you';
        needsYou = true;
      } else if (isPaused) {
        statusText = 'paused';
      } else {
        statusText = 'running';
      }
      if (id === 'implementer') {
        taskNumber =
          inProgressTaskNum ??
          (lastCompletedNum !== undefined ? lastCompletedNum + 1 : (totalTasks > 0 ? 1 : undefined));
      } else if (id === 'code-reviewer') {
        taskNumber = inProgressTaskNum ?? lastCompletedNum;
      } else if (id === 'verifier') {
        taskNumber = inProgressTaskNum ?? (totalTasks > 0 ? totalTasks : undefined);
      }
    } else {
      if (id === 'orchestrator') {
        statusText = isPaused ? 'paused' : 'running';
      } else if (id === 'implementer') {
        const allDone = totalTasks > 0 && tasks.every((t) => t.status === 'completed');
        statusText = allDone ? 'idle' : 'waiting';
        if (inProgressTaskNum) {
          taskNumber = inProgressTaskNum;
        }
      } else if (id === 'code-reviewer') {
        if (lastCompletedNum !== undefined) {
          taskNumber = lastCompletedNum;
          statusText = 'approved';
        } else {
          statusText = 'waiting';
        }
      } else if (id === 'verifier') {
        if (totalTasks > 0) {
          statusText = `after Task ${totalTasks}`;
        } else {
          statusText = 'waiting';
        }
      }
    }

    return {
      id,
      role,
      isMain,
      taskNumber,
      statusText,
      elapsedFormatted: isActive ? elapsedFormatted : undefined,
      needsYou,
    };
  });
}

export const TeamRail: React.FC<TeamRailProps> = ({
  members,
  tasks,
  ledgerStatus,
  selectedMemberIndex,
  isFocused = false,
  zoomTask,
  handledCounts,
  width = 32,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  return (
    <Box flexDirection="column" width={width}>
      {/* Block 1: Team tree */}
      <Box flexDirection="column" width={width}>
        <Text color={activeTheme.colors.text}>Team</Text>
        {members.map((row, idx) => {
          const isSelected = Boolean(isFocused && selectedMemberIndex === idx);
          const isSubagent = !row.isMain;
          const isLastSubagent =
            isSubagent &&
            (idx === members.length - 1 ||
              !members.slice(idx + 1).some((m) => !m.isMain));
          const prefix = !isSubagent
            ? ''
            : isLastSubagent
            ? `${activeGlyphs.treeLast} `
            : `${activeGlyphs.treeBranch} `;
          const leftText = `${prefix}${row.role}`;

          const taskPart = row.taskNumber !== undefined ? `Task ${row.taskNumber}` : '';
          let statusPart = '';

          if (row.needsYou || row.statusText.includes('needs you')) {
            statusPart = row.statusText;
          } else if (row.statusText === 'paused') {
            statusPart = 'paused';
          } else if (row.statusText === 'running' && row.elapsedFormatted) {
            statusPart = row.elapsedFormatted;
          } else {
            statusPart = row.statusText;
          }

          const statusColor =
            row.needsYou ||
            row.statusText.includes('needs you') ||
            row.statusText === 'paused'
              ? activeTheme.colors.ask
              : activeTheme.colors.dim;

          let taskDetail = taskPart ? `${taskPart}  ` : '';
          if (leftText.length + taskDetail.length + statusPart.length > width) {
            taskDetail = '';
          }
          const fullDetailLen = taskDetail.length + statusPart.length;
          const padSpaces = Math.max(
            1,
            width - leftText.length - fullDetailLen
          );

          return (
            <Box key={row.id || idx} flexDirection="row" width={width}>
              <Text inverse={isSelected}>
                <Text color={activeTheme.colors.text}>{leftText}</Text>
                <Text>{' '.repeat(padSpaces)}</Text>
                {taskPart ? (
                  <Text color={activeTheme.colors.dim}>{taskDetail}</Text>
                ) : null}
                <Text color={statusColor}>{statusPart}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Block 2: Tasks or Zoom Checklist */}
      {zoomTask ? (
        <Box marginTop={1} flexDirection="column" width={width}>
          <Text color={activeTheme.colors.text}>
            {`Task ${zoomTask.index ?? 1} checklist from the plan`}
          </Text>
          {zoomTask.checklist && zoomTask.checklist.length > 0 ? (
            (() => {
              const firstUncheckedIdx = zoomTask.checklist.findIndex(
                (item) => !item.checked
              );
              const isAscii =
                activeGlyphs.running === '>' || activeGlyphs.done === '[x]';
              const ellipsis = isAscii ? '...' : '…';

              return zoomTask.checklist.map((item, cIdx) => {
                let icon = '';
                let iconColor = activeTheme.colors.dim;
                let textColor = activeTheme.colors.dim;

                if (item.checked) {
                  icon = activeGlyphs.done;
                  iconColor = activeTheme.colors.done;
                  textColor = activeTheme.colors.text;
                } else if (cIdx === firstUncheckedIdx) {
                  const padLen = Math.max(
                    0,
                    activeGlyphs.done.length - activeGlyphs.running.length
                  );
                  icon = `${activeGlyphs.running}${' '.repeat(padLen)}`;
                  iconColor = activeTheme.colors.active;
                  textColor = activeTheme.colors.text;
                } else {
                  icon = ' '.repeat(activeGlyphs.done.length);
                }

                const prefixStr = `${icon} `;
                const maxTextLen = width - prefixStr.length;
                let displayText = item.text;
                if (displayText.length > maxTextLen) {
                  displayText =
                    displayText.slice(
                      0,
                      Math.max(0, maxTextLen - ellipsis.length)
                    ) + ellipsis;
                }

                return (
                  <Box key={cIdx} flexDirection="row" width={width}>
                    <Text color={iconColor}>{prefixStr}</Text>
                    <Text color={textColor}>{displayText}</Text>
                  </Box>
                );
              });
            })()
          ) : null}
        </Box>
      ) : tasks.length === 0 && ledgerStatus !== 'COMPLETED' ? (
        <Box marginTop={1} flexDirection="column" width={width}>
          <Text color={activeTheme.colors.text}>Tasks</Text>
          <Text color={activeTheme.colors.dim}>
            Tasks appear once the plan is approved.
          </Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column" width={width}>
          <Text color={activeTheme.colors.text}>Tasks</Text>
          {tasks.map((task, tIdx) => {
            const taskNum = task.index ?? tIdx + 1;
            let icon = '';
            let iconColor = activeTheme.colors.dim;
            let textColor = activeTheme.colors.dim;

            if (task.status === 'completed') {
              icon = activeGlyphs.done;
              iconColor = activeTheme.colors.done;
              textColor = activeTheme.colors.text;
            } else if (task.status === 'in_progress') {
              const padLen = Math.max(
                0,
                activeGlyphs.done.length - activeGlyphs.running.length
              );
              icon = `${activeGlyphs.running}${' '.repeat(padLen)}`;
              iconColor = activeTheme.colors.active;
              textColor = activeTheme.colors.text;
            } else {
              icon = ' '.repeat(activeGlyphs.done.length);
            }

            const prefixStr = `${icon} ${taskNum} `;
            const isAscii =
              activeGlyphs.running === '>' || activeGlyphs.done === '[x]';
            const ellipsis = isAscii ? '...' : '…';
            const maxTitleLen = width - prefixStr.length;
            let displayTitle = task.title;
            if (displayTitle.length > maxTitleLen) {
              displayTitle =
                displayTitle.slice(
                  0,
                  Math.max(0, maxTitleLen - ellipsis.length)
                ) + ellipsis;
            }

            return (
              <Box key={task.id || tIdx} flexDirection="row" width={width}>
                <Text color={iconColor}>{prefixStr}</Text>
                <Text color={textColor}>{displayTitle}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Block 3: Handled for you */}
      {handledCounts && handledCounts.promptsApproved > 0 ? (
        <Box marginTop={1} flexDirection="column" width={width}>
          <Text color={activeTheme.colors.text}>Handled for you</Text>
          <Text color={activeTheme.colors.dim}>
            {`${handledCounts.promptsApproved} permission prompts approved`}
          </Text>
          {handledCounts.questionsAnswered &&
          handledCounts.questionsAnswered > 0 ? (
            <Text color={activeTheme.colors.dim}>
              {`${handledCounts.questionsAnswered} questions answered`}
            </Text>
          ) : null}
          {handledCounts.planFixes && handledCounts.planFixes > 0 ? (
            <Text color={activeTheme.colors.dim}>
              {`${handledCounts.planFixes} plan fixes applied`}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

export default TeamRail;
