import React from 'react';
import { Box, Text } from 'ink';

export interface SpecPlanViewProps {
  specPath: string | null;
  specContent: string | null;
  planPath: string | null;
  planContent: string | null;
  activeDoc: 'spec' | 'plan';
  scrollOffset: number;
  maxRows?: number;
}

export const SpecPlanView: React.FC<SpecPlanViewProps> = ({
  specPath,
  specContent,
  planPath,
  planContent,
  activeDoc,
  scrollOffset,
  maxRows = 20,
}) => {
  const isSpec = activeDoc === 'spec';
  const currentPath = isSpec ? specPath : planPath;
  const currentContent = isSpec ? specContent : planContent;
  const fallbackDir = isSpec ? 'docs/superpowers/specs/' : 'docs/superpowers/plans/';

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Tab Header & Path */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Box flexDirection="row" gap={2}>
          <Text
            bold={isSpec}
            color={isSpec ? 'cyan' : 'gray'}
            inverse={isSpec}
          >
            [s] Spec
          </Text>
          <Text
            bold={!isSpec}
            color={!isSpec ? 'cyan' : 'gray'}
            inverse={!isSpec}
          >
            [p] Plan
          </Text>
        </Box>
        <Text color="gray">
          File: <Text color="white">{currentPath || `${fallbackDir} (not found)`}</Text>
        </Text>
      </Box>

      {/* Document Content or Empty State */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
      >
        {!currentContent ? (
          <Box flexDirection="column" paddingY={2} alignItems="center">
            <Text bold color="yellow">
              No active {isSpec ? 'spec' : 'plan'} document found.
            </Text>
            <Text color="gray">
              Looking for markdown documents in {fallbackDir}
            </Text>
          </Box>
        ) : (
          (() => {
            const lines = currentContent.split('\n');
            const visible = lines.slice(scrollOffset, scrollOffset + maxRows);
            const startLine = lines.length > 0 ? scrollOffset + 1 : 0;
            const endLine = Math.min(scrollOffset + maxRows, lines.length);

            return (
              <Box flexDirection="column">
                <Box flexDirection="row" justifyContent="flex-end" marginBottom={1}>
                  <Text color="gray">
                    Lines {startLine}-{endLine} of {lines.length} (Scroll with [↑/↓] or [k/j])
                  </Text>
                </Box>
                {visible.map((line, idx) => (
                  <Box key={scrollOffset + idx} flexDirection="row">
                    <Text color="gray">
                      {String(scrollOffset + idx + 1).padStart(4, ' ')} │{' '}
                    </Text>
                    <Text>{line}</Text>
                  </Box>
                ))}
              </Box>
            );
          })()
        )}
      </Box>
    </Box>
  );
};
