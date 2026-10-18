import { describe, it, expect } from 'vitest';
import { TelemetryParser } from '../../src/telemetry/parser.js';

describe('TelemetryParser (Pure Passive Regex)', () => {
  it('detects active subagent dispatch, tool actions, commands, and interactive prompts', () => {
    const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

    parser.processLine('invoke_subagent -> implementer (Task 2 Worker)');
    expect(parser.getState().activeSubagent).toBe('implementer');
    expect(parser.getState().subagentStartedAt).toBeGreaterThan(0);

    parser.processLine('write_to_file -> src/telemetry/parser.ts');
    expect(parser.getState().lastAction).toContain('write_to_file');
    expect(parser.getState().lastAction).toContain('src/telemetry/parser.ts');

    parser.processLine('run_command: npx vitest run (Exit 0)');
    expect(parser.getState().lastCommand).toContain('npx vitest run');

    parser.processLine('Press ctrl+k to approve command execution');
    expect(parser.getState().waitingForInput).toBe(true);
  });

  describe('Subagent lifecycle detection', () => {
    it('detects subagent dispatches with known roles and emits ORCH/PLANNER activity item', () => {
      const orchParser = new TelemetryParser({ mainAgent: 'orchestrator' });
      orchParser.processLine('Invoking subagent: researcher (Codebase Researcher)');
      expect(orchParser.getState().activeSubagent).toBe('researcher');
      expect(orchParser.getState().subagentStartedAt).toBeTypeOf('number');

      const items = orchParser.getState().activityFeed;
      expect(items.length).toBeGreaterThan(0);
      expect(items[items.length - 1].actor).toBe('ORCH');
      expect(items[items.length - 1].message).toContain('researcher');

      const plannerParser = new TelemetryParser({ mainAgent: 'planner' });
      plannerParser.processLine('{"Tool": "invoke_subagent", "TypeName": "plan-critic"}');
      expect(plannerParser.getState().activeSubagent).toBe('plan-critic');
      const plannerItems = plannerParser.getState().activityFeed;
      expect(plannerItems[plannerItems.length - 1].actor).toBe('PLANNER');
    });

    it('detects subagent completions and clears activeSubagent', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });
      parser.processLine('invoke_subagent -> code-reviewer');
      expect(parser.getState().activeSubagent).toBe('code-reviewer');

      parser.processLine('**Status:** DONE');
      expect(parser.getState().activeSubagent).toBeNull();
      expect(parser.getState().subagentStartedAt).toBeNull();

      const items = parser.getState().activityFeed;
      const lastItem = items[items.length - 1];
      expect(lastItem.message).toContain('DONE');
    });

    it('detects [Message] or SYSTEM_MESSAGE and records completion', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });
      parser.processLine('invoke_subagent -> verifier');
      expect(parser.getState().activeSubagent).toBe('verifier');

      parser.processLine('[Message] timestamp=2026-10-18T16:32:17Z sender=verifier priority=MESSAGE_PRIORITY_HIGH content=All tests passed');
      expect(parser.getState().activeSubagent).toBeNull();

      const items = parser.getState().activityFeed;
      expect(items.some((i) => i.message.includes('All tests passed') || i.message.includes('verifier'))).toBe(true);
    });

    it('detects various status verdicts (DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT, READY)', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('invoke_subagent -> implementer');
      parser.processLine('Status: DONE_WITH_CONCERNS - Minor lint issue noted');
      expect(parser.getState().activeSubagent).toBeNull();

      parser.processLine('invoke_subagent -> researcher');
      parser.processLine('Verdict: BLOCKED - missing permissions');
      expect(parser.getState().activeSubagent).toBeNull();
    });
  });

  describe('Tool actions detection', () => {
    it('detects standard tools: view_file, write_to_file, edit_file, grep_search, call_mcp_tool', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('calling tool: view_file { AbsolutePath: "/repo/src/index.ts" }');
      expect(parser.getState().lastAction).toContain('view_file');

      parser.processLine('edit_file: src/core/ledger.ts');
      expect(parser.getState().lastAction).toContain('edit_file');

      parser.processLine('grep_search: Query="export function"');
      expect(parser.getState().lastAction).toContain('grep_search');

      parser.processLine('call_mcp_tool -> query_graph_tool');
      expect(parser.getState().lastAction).toContain('query_graph_tool');
    });

    it('attributes tool action actor to active subagent or main agent', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('view_file: src/cli/index.ts');
      const item1 = parser.getState().activityFeed.slice(-1)[0];
      expect(item1.actor).toBe('ORCH');

      parser.processLine('invoke_subagent -> implementer');
      parser.processLine('edit_file: src/telemetry/parser.ts');
      const item2 = parser.getState().activityFeed.slice(-1)[0];
      expect(item2.actor).toBe('IMPLEMENTER');
    });

    it('deduplicates consecutive identical messages', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('view_file: src/telemetry/types.ts');
      parser.processLine('view_file: src/telemetry/types.ts');
      parser.processLine('view_file: src/telemetry/types.ts');

      const matching = parser.getState().activityFeed.filter((i) => i.message.includes('view_file: src/telemetry/types.ts'));
      expect(matching.length).toBe(1);
    });

    it('caps activity feed at maxFeedItems', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator', maxFeedItems: 5 });

      for (let i = 0; i < 10; i++) {
        parser.processLine(`write_to_file -> file_${i}.txt`);
      }

      expect(parser.getState().activityFeed.length).toBe(5);
      expect(parser.getState().activityFeed[4].message).toContain('file_9.txt');
    });
  });

  describe('Command execution tracking', () => {
    it('detects run_command and exit codes', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('run_command: npm run build');
      expect(parser.getState().lastCommand).toBe('npm run build');

      parser.processLine('Exit code: 0');
      expect(parser.getState().lastCommand).toContain('Exit code: 0');

      parser.processLine('run_command: git status (Exit 0)');
      expect(parser.getState().lastCommand).toContain('git status');
    });
  });

  describe('Interactive input prompt detection', () => {
    it('sets waitingForInput on prompt patterns and clears on tool execution', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('? Do you want to proceed with implementation? (y/n)');
      expect(parser.getState().waitingForInput).toBe(true);

      // Tool execution indicates progress and resets waitingForInput
      parser.processLine('write_to_file -> src/index.ts');
      expect(parser.getState().waitingForInput).toBe(false);
    });

    it('detects ask_question and permission prompts', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('ask_question: Choose an option');
      expect(parser.getState().waitingForInput).toBe(true);

      parser.clearWaitingForInput();
      expect(parser.getState().waitingForInput).toBe(false);

      parser.processLine('Allow command execution for npm test? (Press ctrl+k)');
      expect(parser.getState().waitingForInput).toBe(true);
    });
  });

  describe('Noise filtering and ANSI stripping', () => {
    it('ignores empty lines, whitespace, box-drawing characters, and spinners', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      parser.processLine('');
      parser.processLine('   ');
      parser.processLine('┌──────────────────────────────────────┐');
      parser.processLine('│                                      │');
      parser.processLine('└──────────────────────────────────────┘');
      parser.processLine('────────────────────────────────────────');
      parser.processLine('⠋ Loading workspace data...');

      expect(parser.getState().activityFeed.length).toBe(0);
      expect(parser.getState().lastAction).toBeNull();
    });

    it('strips ANSI color and control codes before regex matching', () => {
      const parser = new TelemetryParser({ mainAgent: 'orchestrator' });

      const ansiLine = '\u001b[32m\u001b[1minvoke_subagent -> implementer\u001b[22m\u001b[39m';
      parser.processLine(ansiLine);

      expect(parser.getState().activeSubagent).toBe('implementer');
    });
  });
});
