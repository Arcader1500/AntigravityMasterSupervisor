import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box, Text, measureElement } from 'ink';

export interface SpecPlanViewProps {
  specPath: string | null;
  specContent: string | null;
  planPath: string | null;
  planContent: string | null;
  activeDoc: 'spec' | 'plan';
  scrollOffset: number;
  maxRows?: number;
  width?: number;
}

export const SpecPlanView: React.FC<SpecPlanViewProps> = ({
  specPath,
  specContent,
  planPath,
  planContent,
  activeDoc,
  scrollOffset,
  maxRows = 20,
  width,
}) => {
  const isSpec = activeDoc === 'spec';
  const currentPath = isSpec ? specPath : planPath;
  const currentContent = isSpec ? specContent : planContent;
  const fallbackDir = isSpec ? 'docs/superpowers/specs/' : 'docs/superpowers/plans/';

  const lines = currentContent?.split('\n') ?? [];
  const candidateLines = lines.slice(scrollOffset, scrollOffset + maxRows);
  const tabHeaderNode = useRef<React.ElementRef<typeof Box>>(null);
  const documentHeaderNode = useRef<React.ElementRef<typeof Box>>(null);
  const lineNodes = useRef(new Map<number, React.ElementRef<typeof Box>>());
  const [tabHeaderRows, setTabHeaderRows] = useState(0);
  const [documentHeaderRows, setDocumentHeaderRows] = useState(2);
  const [visibleLineCount, setVisibleLineCount] = useState(maxRows);

  const documentFrameRows = Math.max(0, maxRows - tabHeaderRows - 1);
  const visibleContentRows = Math.max(
    0,
    documentFrameRows - 2 - documentHeaderRows
  );

  useLayoutEffect(() => {
    const measuredTabHeader = tabHeaderNode.current
      ? measureElement(tabHeaderNode.current).height
      : 0;
    const measuredDocumentHeader = documentHeaderNode.current
      ? measureElement(documentHeaderNode.current).height
      : 0;
    if (measuredTabHeader !== tabHeaderRows) setTabHeaderRows(measuredTabHeader);
    const documentHeaderHeight = measuredDocumentHeader > 0
      ? measuredDocumentHeader + 1
      : 0;
    if (documentHeaderHeight > 0 && documentHeaderHeight !== documentHeaderRows) {
      setDocumentHeaderRows(documentHeaderHeight);
    }

    let usedRows = 0;
    let count = 0;
    for (let index = 0; index < candidateLines.length; index++) {
      const node = lineNodes.current.get(scrollOffset + index);
      const height = node ? measureElement(node).height : 0;
      if (height <= 0 || (usedRows + height > visibleContentRows && count > 0)) break;
      if (height > visibleContentRows) break;
      usedRows += height;
      count++;
    }
    if (count !== visibleLineCount) setVisibleLineCount(count);
  });

  const visibleLines = candidateLines.slice(0, visibleLineCount);
  const startLine = visibleLines.length > 0 ? scrollOffset + 1 : 0;
  const endLine = Math.min(scrollOffset + visibleLines.length, lines.length);

  return (
    <Box width={width} flexDirection="column" paddingX={1} height={maxRows} overflowY="hidden" flexShrink={0}>
      {/* Tab Header & Path */}
      <Box ref={tabHeaderNode} flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1} flexShrink={0}>
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
      {documentFrameRows > 0 && <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
        height={documentFrameRows}
        overflowY="hidden"
        flexShrink={0}
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
          (() => (
              <Box flexDirection="column" flexShrink={0}>
                <Box ref={documentHeaderNode} flexDirection="row" justifyContent="flex-end" marginBottom={1} flexShrink={0}>
                  <Text color="gray">
                    Lines {startLine}-{endLine} of {lines.length} (Scroll with [↑/↓] or [k/j])
                  </Text>
                </Box>
                <Box height={visibleContentRows} overflowY="hidden" flexShrink={0} flexDirection="column">
                {candidateLines.map((line, idx) => (
                  <Box key={scrollOffset + idx} ref={(node) => node ? lineNodes.current.set(scrollOffset + idx, node) : lineNodes.current.delete(scrollOffset + idx)} flexDirection="row" flexShrink={0}>
                    <Text color="gray">
                      {String(scrollOffset + idx + 1).padStart(4, ' ')} │{' '}
                    </Text>
                    <Text>{line}</Text>
                  </Box>
                ))}
                </Box>
              </Box>
            ))()
        )}
      </Box>}
    </Box>
  );
};
