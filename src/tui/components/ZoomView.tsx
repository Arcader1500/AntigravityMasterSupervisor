import React from 'react';
import { Box, Text } from 'ink';
import type { AgentStepItem } from '../../telemetry/types.js';
import { resolveTheme, type ThemeConfig, type ThemeToken } from '../theme.js';
import { resolveGlyphs, type GlyphSet } from '../glyphs.js';

export interface ZoomViewProps {
  role: string;
  taskTitle?: string;
  taskNumber?: number;
  elapsedFormatted: string;
  steps: AgentStepItem[];
  ptyLines: string[];
  scrollOffset?: number;
  isSharedStream?: boolean;
  theme?: ThemeConfig;
  glyphs?: GlyphSet;
}

const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
];

export function toCapitalizedWord(n: number): string {
  if (n >= 0 && n < NUMBER_WORDS.length) {
    return NUMBER_WORDS[n];
  }
  return String(n);
}

function formatTargets(targets: string[]): string {
  if (targets.length === 0) return 'files';
  const basenames = targets.map((t) => t.split(/[/\\]/).pop() || t);
  if (basenames.length === 1) {
    return basenames[0];
  }
  if (basenames.length === 2) {
    return `${basenames[0]} and ${basenames[1]}`;
  }
  if (basenames.length === 3) {
    return `${basenames[0]}, ${basenames[1]} and ${basenames[2]}`;
  }
  const first3 = basenames.slice(0, 3).join(', ');
  const extra = basenames.length - 3;
  return `${first3} and ${extra} more`;
}

export function formatAgentStep(
  step: AgentStepItem,
  isLast: boolean
): { text: string; tone: ThemeToken } {
  if (step.kind === 'read') {
    const formattedTargets = formatTargets(step.targets ?? []);
    if (isLast && step.status === 'running') {
      return {
        text: `Reading ${formattedTargets}`,
        tone: 'active',
      };
    }
    return {
      text: `Read ${formattedTargets}`,
      tone: 'text',
    };
  }

  if (step.kind === 'write') {
    const target = step.targets?.[0] ?? 'file';
    const linesSuffix =
      step.addedLines !== undefined ? ` (+${step.addedLines} lines)` : '';
    if (isLast && step.status === 'running') {
      return {
        text: `Writing ${target}${linesSuffix}`,
        tone: 'active',
      };
    }
    return {
      text: `Wrote ${target}${linesSuffix}`,
      tone: 'text',
    };
  }

  if (step.kind === 'command') {
    const cmd = step.command ?? '';
    if (isLast && step.status === 'running') {
      if (/\b(tsc|typecheck)\b/i.test(cmd)) {
        return { text: 'Running the typecheck', tone: 'active' };
      }
      if (/\b(test|vitest|jest)\b/i.test(cmd)) {
        return { text: 'Running tests', tone: 'active' };
      }
      return { text: `Running ${cmd}`, tone: 'active' };
    }

    let outcome: string;
    if (step.testSummary) {
      outcome = `${step.testSummary.passed} passed, ${step.testSummary.failed} failed (summary reported by ${step.agent})`;
    } else if (step.exitCode === undefined) {
      outcome = 'outcome unknown';
    } else if (step.exitCode === 0) {
      outcome = 'exit code 0';
    } else {
      outcome = `failed (exit ${step.exitCode})`;
    }

    let tone: ThemeToken = 'text';
    if (step.status === 'failed') {
      tone = 'ask';
    } else if (step.status === 'failed_recovered') {
      tone = 'dim';
    }

    return {
      text: `Ran ${cmd}: ${outcome}`,
      tone,
    };
  }

  if (step.kind === 'mcp') {
    const query = step.mcpQuery ?? 'symbol';
    if (isLast && step.status === 'running') {
      return {
        text: `Looking up ${query} in the code graph`,
        tone: 'active',
      };
    }
    return {
      text: `Looked up ${query} in the code graph`,
      tone: 'text',
    };
  }

  // Fallback for work or generic tools
  if (isLast && step.status === 'running') {
    return { text: 'Working', tone: 'active' };
  }
  return { text: 'Worked', tone: 'text' };
}

export const ZoomView: React.FC<ZoomViewProps> = ({
  role,
  taskTitle,
  taskNumber,
  elapsedFormatted,
  steps,
  ptyLines,
  scrollOffset = 0,
  isSharedStream = false,
  theme,
  glyphs,
}) => {
  const activeTheme = theme ?? resolveTheme();
  const activeGlyphs = glyphs ?? resolveGlyphs();

  const stepCountWord = toCapitalizedWord(steps.length);
  const stepNoun = steps.length === 1 ? 'step' : 'steps';
  const failedCount = steps.filter((s) => s.status === 'failed' || s.status === 'failed_recovered').length;
  const failedPart = failedCount === 0 ? 'no failures reported' : `${failedCount} failure${failedCount === 1 ? '' : 's'} reported`;

  const headerTitle = taskTitle ?? (taskNumber ? `Task ${taskNumber}` : role);

  const maxScroll = Math.max(0, steps.length - 1);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const visibleSteps = steps.slice(safeOffset);
  const settledLines = ptyLines.filter((l) => l.trim().length > 0).slice(-3);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Top summary card */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={activeTheme.colors.line}
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color={activeTheme.colors.text}>
          <Text color={activeTheme.colors.active}>{activeGlyphs.running} </Text>
          {headerTitle}
        </Text>
        <Text color={activeTheme.colors.text}>
          {`Started ${elapsedFormatted} ago. ${stepCountWord} ${stepNoun} so far, ${failedPart}.`}
        </Text>
        {isSharedStream && (
          <Text color={activeTheme.colors.dim}>Main agent steps are shown.</Text>
        )}
      </Box>

      {/* Grouped steps with timestamps */}
      <Box flexDirection="column" marginBottom={1}>
        {visibleSteps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const timeStr = step.timestamp.includes('T')
            ? step.timestamp.slice(11, 19)
            : step.timestamp;
          const { text, tone } = formatAgentStep(step, isLast);

          return (
            <Box key={step.id || idx} flexDirection="row" gap={2}>
              <Text color={activeTheme.colors.dim}>{timeStr}</Text>
              <Text color={activeTheme.colors[tone]}>{text}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Bottom raw output box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={activeTheme.colors.line}
        paddingX={1}
      >
        <Text color={activeTheme.colors.dim}>Raw output, last lines</Text>
        {settledLines.length === 0 ? (
          <Text color={activeTheme.colors.dim}>(No output)</Text>
        ) : (
          settledLines.map((line, idx) => (
            <Text key={idx} color={activeTheme.colors.dim}>
              {line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
};

export default ZoomView;
