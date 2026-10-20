import {
  ActivityFeedItem,
  AgentStepItem,
  ParserState,
  TelemetryEvent,
  TelemetryParserOptions,
} from './types.js';

const ANSI_PATTERN =
  /[\u001B\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))|\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const BOX_CHARS_ONLY_REGEX =
  /^[\s─│┌┐└┘├┤┬┴┼═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳━┃┏┓┗┛┣┫┳┻╋\-_=|+*~`]+$/;

const SPINNER_LINE_REGEX = /^[\u2800-\u28FF⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

const SUBAGENT_DISPATCH_REGEX =
  /(?:invoke_subagent|invoking\s+subagent|dispatch(?:ing)?\s+subagent|"Tool":\s*"invoke_subagent")/i;

const SUBAGENT_TYPENAME_REGEX =
  /"(?:TypeName|subagent_type)":\s*"([a-zA-Z0-9_-]+)"/i;

const KNOWN_ROLES = [
  'researcher',
  'plan-critic',
  'implementer',
  'code-reviewer',
  'verifier',
];

const MESSAGE_REGEX = /\[Message\]\s+timestamp=.*?sender=([^\s]+)/i;
const VERDICT_REGEX =
  /(?:\*\*Status:\*\*|\bStatus:|\bVerdict:)\s*(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED|READY|APPROVE|REQUEST_CHANGES|PASS|FAIL)\b/i;
const STANDALONE_VERDICT_REGEX =
  /^\s*(?:[-*]\s*)?(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED|READY|APPROVE|REQUEST_CHANGES|PASS|FAIL)\b/i;

const PROMPT_REGEX = /(?:ask_question|ctrl\+k|allow\s+command|\?\s+)/i;

const COMMAND_LINE_REGEX = /run_command/i;
const EXIT_CODE_REGEX =
  /(?:exit\s+code[:\s]+(\d+)|\bexit\s+(\d+)|\(Exit\s+(\d+)\)|command exited with code\s+(\d+))/i;

const TEST_SUMMARY_REGEX =
  /(?:Tests?:?\s*)?(?:(\d+)\s+failed,\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i;

const ERROR_LINE_REGEX =
  /(?:^Error:|\bFAIL\b|ECONNREFUSED|connection refused|Command failed)/i;

const DIFF_LINES_REGEX = /\(\+(\d+)\s+lines?\)/i;

const MCP_KNOWN_TOOLS = [
  'semantic_search_nodes_tool',
  'query_graph_tool',
  'get_impact_radius_tool',
  'detect_changes_tool',
  'get_affected_flows_tool',
  'call_mcp_tool',
];

const TOOL_ACTION_REGEX =
  /(?:\b(?:view_file|read_file|read_resource|write_to_file|edit_file|replace_file_content|multi_replace_file_content|grep_search|call_mcp_tool|apply_refactor_tool|semantic_search_nodes_tool|query_graph_tool|get_impact_radius_tool|detect_changes_tool|get_affected_flows_tool)\b|toolAction)/i;

function parseToolCall(line: string): {
  toolName: string;
  target?: string;
  addedLines?: number;
  mcpQuery?: string;
} | null {
  const addedMatch = line.match(DIFF_LINES_REGEX);
  const addedLines = addedMatch ? parseInt(addedMatch[1], 10) : undefined;
  const lineWithoutDiff = line.replace(DIFF_LINES_REGEX, '').trim();

  // Check specific MCP tools
  for (const mcp of MCP_KNOWN_TOOLS) {
    if (mcp !== 'call_mcp_tool') {
      const idx = lineWithoutDiff.indexOf(mcp);
      if (idx !== -1) {
        const rest = lineWithoutDiff.slice(idx + mcp.length).replace(/^[:\s->]+/, '').trim();
        return {
          toolName: mcp,
          mcpQuery: rest || undefined,
          addedLines,
        };
      }
    }
  }

  // Check standard tools
  const standardTools = [
    'view_file',
    'read_file',
    'read_resource',
    'write_to_file',
    'edit_file',
    'replace_file_content',
    'multi_replace_file_content',
    'grep_search',
    'apply_refactor_tool',
    'call_mcp_tool',
  ];

  for (const tool of standardTools) {
    const regex = new RegExp(`\\b${tool}\\b[:\\s->]+(.*)`, 'i');
    const match = lineWithoutDiff.match(regex);
    if (match) {
      let rawTarget = match[1].trim();
      const absMatch = rawTarget.match(/(?:AbsolutePath|TargetFile|Path)[:\s]*["']?([^"',}\s]+)/i);
      let target: string | undefined = absMatch ? absMatch[1] : undefined;
      if (!target && rawTarget) {
        target = rawTarget.replace(/^[{"'\s]+|[}"'\s]+$/g, '').trim();
        if (/^Query=/i.test(target)) {
          return {
            toolName: tool,
            mcpQuery: target.replace(/^Query=["']?/i, '').replace(/["']$/, ''),
            addedLines,
          };
        }
      }
      return {
        toolName: tool,
        target: target || undefined,
        addedLines,
      };
    }
  }

  const callingMatch = lineWithoutDiff.match(/calling tool:\s*([a-zA-Z0-9_-]+)(.*)/i);
  if (callingMatch) {
    const toolName = callingMatch[1];
    const rest = callingMatch[2];
    const absMatch = rest.match(/(?:AbsolutePath|TargetFile|Path)[:\s]*["']?([^"',}\s]+)/i);
    return {
      toolName,
      target: absMatch ? absMatch[1] : undefined,
      addedLines,
    };
  }

  return null;
}

export class TelemetryParser {
  private mainAgent: string;
  private maxFeedItems: number;
  private feedCounter = 0;
  private stepCounter = 0;
  private state: ParserState;
  private eventListeners = new Set<(event: TelemetryEvent) => void>();
  private activePrompt: {
    promptKind: 'ask_question' | 'permission' | 'checkpoint_spec';
    headline: string;
    question: string;
    contextLine?: string;
    command?: string;
    options: Array<{ index: number; label: string; recommended?: boolean }>;
  } | null = null;
  private lastTestSummary?: { passed: number; failed: number };

  constructor(options?: TelemetryParserOptions) {
    this.mainAgent = options?.mainAgent ?? 'agy';
    this.maxFeedItems = options?.maxFeedItems ?? 100;
    this.state = {
      mainAgent: this.mainAgent,
      activeSubagent: null,
      subagentStartedAt: null,
      lastAction: null,
      lastCommand: null,
      lastErrorLine: null,
      agentSteps: {},
      waitingForInput: false,
      activityFeed: [],
    };
  }

  public getState(): Readonly<ParserState> {
    return this.state;
  }

  public onEvent(listener: (event: TelemetryEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private emitEvent(event: TelemetryEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in TelemetryParser event listener:', err);
      }
    }
  }

  public clearWaitingForInput(): void {
    this.state.waitingForInput = false;
    this.activePrompt = null;
  }

  public reset(): void {
    this.feedCounter = 0;
    this.stepCounter = 0;
    this.activePrompt = null;
    this.lastTestSummary = undefined;
    this.state = {
      mainAgent: this.mainAgent,
      activeSubagent: null,
      subagentStartedAt: null,
      lastAction: null,
      lastCommand: null,
      lastErrorLine: null,
      agentSteps: {},
      waitingForInput: false,
      activityFeed: [],
    };
  }

  public processLine(rawLine: string): void {
    const cleanLine = rawLine.replace(ANSI_PATTERN, '').replace(/\r/g, '');
    const trimmed = cleanLine.trim();

    if (!trimmed) {
      return;
    }

    if (BOX_CHARS_ONLY_REGEX.test(trimmed)) {
      return;
    }

    if (SPINNER_LINE_REGEX.test(trimmed)) {
      return;
    }

    // Numbered option lines for buffered activePrompt (e.g. ask_question)
    if (this.state.waitingForInput && this.activePrompt) {
      const optionMatch = trimmed.match(/^\s*(?:\[?(\d+)\]?[.)]?)\s*(.+)$/);
      if (optionMatch) {
        const optIndex = parseInt(optionMatch[1], 10);
        const rawOpt = optionMatch[2].trim();
        const isRecommended = /\(recommended\)/i.test(rawOpt);
        const cleanLabel =
          rawOpt.replace(/\(recommended\)/i, '').replace(/^[-:\s]+/, '').trim() || rawOpt;

        this.activePrompt.options.push({
          index: optIndex,
          label: cleanLabel,
          ...(isRecommended ? { recommended: true } : {}),
        });

        this.emitEvent({
          type: 'DECISION_PROMPT',
          promptKind: this.activePrompt.promptKind,
          headline: this.activePrompt.headline,
          question: this.activePrompt.question,
          options: [...this.activePrompt.options],
          timestamp: new Date().toISOString(),
        });

        const actor = this.getCurrentActorTag();
        this.pushFeedItem(actor, trimmed);
        return;
      }
    }

    // 1. Subagent dispatches
    let subagentDispatched: string | null = null;
    const typeNameMatch = trimmed.match(SUBAGENT_TYPENAME_REGEX);
    if (typeNameMatch) {
      subagentDispatched = typeNameMatch[1];
    } else if (SUBAGENT_DISPATCH_REGEX.test(trimmed)) {
      const foundRole = KNOWN_ROLES.find((role) =>
        new RegExp(`\\b${role}\\b`, 'i').test(trimmed)
      );
      if (foundRole) {
        subagentDispatched = foundRole;
      } else {
        const namedMatch = trimmed.match(
          /(?:invoking\s+subagent|invoke_subagent|dispatch(?:ing)?\s+subagent)[\s:->]+([a-zA-Z0-9_-]+)/i
        );
        if (namedMatch) {
          subagentDispatched = namedMatch[1];
        }
      }
    }

    if (subagentDispatched) {
      const role = subagentDispatched.toLowerCase();
      this.state.activeSubagent = role;
      this.state.subagentStartedAt = Date.now();
      this.state.waitingForInput = false;
      this.activePrompt = null;
      this.state.lastAction = trimmed;

      if (!this.state.agentSteps[role]) {
        this.state.agentSteps[role] = [];
      }

      this.emitEvent({
        type: 'SUBAGENT_DISPATCHED',
        role,
        rawLine: trimmed,
        timestamp: new Date().toISOString(),
      });

      const orchActor = this.mainAgent.toLowerCase().includes('planner')
        ? 'PLANNER'
        : 'ORCH';
      this.pushFeedItem(orchActor, trimmed);
      return;
    }

    // 2. Subagent completion
    const messageMatch = trimmed.match(MESSAGE_REGEX);
    const isMessage = messageMatch !== null;
    const verdictMatch = trimmed.match(VERDICT_REGEX);
    const standaloneVerdictMatch =
      this.state.activeSubagent !== null ? trimmed.match(STANDALONE_VERDICT_REGEX) : null;
    const isVerdict = verdictMatch !== null || standaloneVerdictMatch !== null;

    if (isMessage || isVerdict) {
      const role = this.state.activeSubagent
        ? this.state.activeSubagent.toLowerCase()
        : (messageMatch?.[1]?.toLowerCase() ?? this.mainAgent.toLowerCase());

      const rawVerdictMatched = (
        verdictMatch ? verdictMatch[1] : (standaloneVerdictMatch ? standaloneVerdictMatch[1] : 'DONE')
      ).toUpperCase();

      const verdict = (
        rawVerdictMatched === 'READY' ? 'DONE' : rawVerdictMatched
      ) as
        | 'DONE'
        | 'DONE_WITH_CONCERNS'
        | 'NEEDS_CONTEXT'
        | 'BLOCKED'
        | 'APPROVE'
        | 'REQUEST_CHANGES'
        | 'PASS'
        | 'FAIL';

      const reasonMatch = trimmed.match(
        /(?:DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED|APPROVE|REQUEST_CHANGES|PASS|FAIL|READY)\s*[:-]\s*(.+)/i
      );
      const reason = reasonMatch ? reasonMatch[1].trim() : undefined;

      const elapsedMs = this.state.subagentStartedAt
        ? Math.max(0, Date.now() - this.state.subagentStartedAt)
        : 0;

      this.emitEvent({
        type: 'SUBAGENT_COMPLETED',
        role,
        verdict,
        ...(reason ? { reason } : {}),
        elapsedMs,
        timestamp: new Date().toISOString(),
      });

      this.completeRunningStep(role, verdict !== 'FAIL' && verdict !== 'BLOCKED');

      const actorTag = this.state.activeSubagent
        ? this.state.activeSubagent.toUpperCase()
        : (messageMatch?.[1]?.toUpperCase() ?? this.getMainActorTag());

      this.state.activeSubagent = null;
      this.state.subagentStartedAt = null;
      this.state.waitingForInput = false;
      this.activePrompt = null;
      this.pushFeedItem(actorTag, trimmed);
      return;
    }

    // 3. Error lines
    if (ERROR_LINE_REGEX.test(trimmed)) {
      this.state.lastErrorLine = trimmed;
      const currentActor = this.getCurrentActorTag().toLowerCase();
      this.emitEvent({
        type: 'ERROR_LINE',
        agent: currentActor,
        message: trimmed,
        timestamp: new Date().toISOString(),
      });

      const steps = this.getOrCreateActorSteps(currentActor);
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.status === 'running') {
        lastStep.status = 'failed';
      }

      this.pushFeedItem(this.getCurrentActorTag(), trimmed);
      return;
    }

    // 4. Interactive prompt
    const isPermission = /(?:ctrl\+k|allow\s+command)/i.test(trimmed);
    if (isPermission) {
      this.state.waitingForInput = true;
      this.activePrompt = null;
      const cmdMatch = trimmed.match(
        /(?:allow\s+command[:\s]+|command execution for\s+)([^?()]+)/i
      );
      const command = cmdMatch ? cmdMatch[1].trim() : (this.state.lastCommand ?? undefined);

      this.emitEvent({
        type: 'DECISION_PROMPT',
        promptKind: 'permission',
        headline: 'Permission Required',
        question: trimmed,
        ...(command ? { command } : {}),
        options: [
          { index: 1, label: 'Allow', recommended: true },
          { index: 2, label: "Don't allow" },
        ],
        timestamp: new Date().toISOString(),
      });

      const actor = this.getCurrentActorTag();
      this.pushFeedItem(actor, trimmed);
      return;
    }

    const isPrompt = PROMPT_REGEX.test(trimmed);
    if (isPrompt) {
      this.state.waitingForInput = true;
      if (/ask_question/i.test(trimmed)) {
        this.state.lastAction = trimmed;
      }
      const question = trimmed
        .replace(/^ask_question[:\s->]*/i, '')
        .replace(/^\?\s*/, '')
        .trim();

      this.activePrompt = {
        promptKind: 'ask_question',
        headline: 'Decision Required',
        question,
        options: [],
      };

      this.emitEvent({
        type: 'DECISION_PROMPT',
        promptKind: 'ask_question',
        headline: 'Decision Required',
        question,
        options: [],
        timestamp: new Date().toISOString(),
      });

      const actor = this.getCurrentActorTag();
      this.pushFeedItem(actor, trimmed);
      return;
    }

    // 5. Test summary lines
    const testSummaryMatch = trimmed.match(TEST_SUMMARY_REGEX);
    if (testSummaryMatch && testSummaryMatch[2]) {
      const passed = parseInt(testSummaryMatch[2], 10);
      const failed = testSummaryMatch[1]
        ? parseInt(testSummaryMatch[1], 10)
        : (testSummaryMatch[3] ? parseInt(testSummaryMatch[3], 10) : 0);

      this.lastTestSummary = { passed, failed };
      const currentActor = this.getCurrentActorTag().toLowerCase();
      this.emitEvent({
        type: 'TEST_SUMMARY',
        agent: currentActor,
        passed,
        failed,
        timestamp: new Date().toISOString(),
      });

      const steps = this.getOrCreateActorSteps(currentActor);
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.kind === 'command') {
        lastStep.testSummary = { passed, failed };
      }
    }

    // 6. Command execution
    const isRunCmd = COMMAND_LINE_REGEX.test(trimmed);
    const exitMatch = trimmed.match(EXIT_CODE_REGEX);
    const isExitCode = exitMatch !== null;

    if (isRunCmd || isExitCode) {
      const currentActor = this.getCurrentActorTag().toLowerCase();

      if (isRunCmd) {
        const cmdMatch = trimmed.match(/run_command[:\s->]+(.*)/i);
        const rawCmd = cmdMatch ? cmdMatch[1].trim() : trimmed;
        const command = rawCmd.replace(/\s*\(\s*Exit\s+\d+\s*\)\s*$/i, '').trim();
        this.state.lastCommand = command;
        this.state.lastAction = trimmed;
        this.lastTestSummary = undefined;

        this.emitEvent({
          type: 'COMMAND_STARTED',
          agent: currentActor,
          command,
          timestamp: new Date().toISOString(),
        });

        this.completeRunningStep(currentActor, true);
        const steps = this.getOrCreateActorSteps(currentActor);
        steps.push({
          id: `step-${Date.now()}-${this.stepCounter++}`,
          timestamp: new Date().toISOString(),
          agent: currentActor,
          kind: 'command',
          command,
          status: 'running',
        });
      }

      if (isExitCode) {
        const exitCode = parseInt(
          exitMatch[1] ?? exitMatch[2] ?? exitMatch[3] ?? exitMatch[4],
          10
        );
        const command = this.state.lastCommand ?? trimmed;
        if (!isRunCmd) {
          this.state.lastCommand = trimmed;
        }

        this.emitEvent({
          type: 'COMMAND_FINISHED',
          agent: currentActor,
          command,
          exitCode,
          ...(this.lastTestSummary ? { testSummary: this.lastTestSummary } : {}),
          timestamp: new Date().toISOString(),
        });

        const steps = this.getOrCreateActorSteps(currentActor);
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.kind === 'command') {
          lastStep.exitCode = exitCode;
          if (this.lastTestSummary) {
            lastStep.testSummary = this.lastTestSummary;
          }
          lastStep.status = exitCode === 0 ? 'ok' : 'failed';
        }

        if (exitCode === 0) {
          for (const s of steps) {
            if (s.status === 'failed') {
              s.status = 'failed_recovered';
            }
          }
        }
      }

      this.state.waitingForInput = false;
      this.activePrompt = null;
      const actorTag = this.getCurrentActorTag();
      this.pushFeedItem(actorTag, trimmed);
      return;
    }

    // 7. Tool actions
    if (TOOL_ACTION_REGEX.test(trimmed)) {
      this.state.lastAction = trimmed;
      this.state.waitingForInput = false;
      this.activePrompt = null;
      const actor = this.getCurrentActorTag().toLowerCase();
      const toolCall = parseToolCall(trimmed);

      if (toolCall) {
        this.emitEvent({
          type: 'TOOL_CALLED',
          agent: actor,
          toolName: toolCall.toolName,
          ...(toolCall.target ? { target: toolCall.target } : {}),
          ...(toolCall.addedLines !== undefined ? { addedLines: toolCall.addedLines } : {}),
          ...(toolCall.mcpQuery ? { mcpQuery: toolCall.mcpQuery } : {}),
          timestamp: new Date().toISOString(),
        });

        if (
          toolCall.toolName === 'view_file' ||
          toolCall.toolName === 'read_file' ||
          toolCall.toolName === 'read_resource'
        ) {
          this.recordReadStep(actor, toolCall.target);
        } else if (
          toolCall.toolName === 'write_to_file' ||
          toolCall.toolName === 'edit_file' ||
          toolCall.toolName === 'replace_file_content' ||
          toolCall.toolName === 'multi_replace_file_content' ||
          toolCall.toolName === 'apply_refactor_tool'
        ) {
          this.completeRunningStep(actor, true);
          const steps = this.getOrCreateActorSteps(actor);
          steps.push({
            id: `step-${Date.now()}-${this.stepCounter++}`,
            timestamp: new Date().toISOString(),
            agent: actor,
            kind: 'write',
            targets: toolCall.target ? [toolCall.target] : undefined,
            addedLines: toolCall.addedLines,
            status: 'running',
          });
        } else if (
          MCP_KNOWN_TOOLS.includes(toolCall.toolName) ||
          toolCall.toolName === 'call_mcp_tool'
        ) {
          this.completeRunningStep(actor, true);
          const steps = this.getOrCreateActorSteps(actor);
          steps.push({
            id: `step-${Date.now()}-${this.stepCounter++}`,
            timestamp: new Date().toISOString(),
            agent: actor,
            kind: 'mcp',
            mcpQuery: toolCall.mcpQuery,
            status: 'running',
          });
        } else {
          this.completeRunningStep(actor, true);
          const steps = this.getOrCreateActorSteps(actor);
          steps.push({
            id: `step-${Date.now()}-${this.stepCounter++}`,
            timestamp: new Date().toISOString(),
            agent: actor,
            kind: 'work',
            targets: toolCall.target ? [toolCall.target] : undefined,
            status: 'running',
          });
        }
      }

      const actorTag = this.getCurrentActorTag();
      this.pushFeedItem(actorTag, trimmed);
      return;
    }
  }

  private getOrCreateActorSteps(actor: string): AgentStepItem[] {
    const key = actor.toLowerCase();
    if (!this.state.agentSteps[key]) {
      this.state.agentSteps[key] = [];
    }
    return this.state.agentSteps[key];
  }

  private recordReadStep(actor: string, target?: string): void {
    const steps = this.getOrCreateActorSteps(actor);
    const lastStep = steps[steps.length - 1];

    if (lastStep && lastStep.kind === 'read') {
      if (target) {
        lastStep.targets = lastStep.targets ?? [];
        lastStep.targets.push(target);
      }
      lastStep.status = 'running';
      return;
    }

    this.completeRunningStep(actor, true);

    const step: AgentStepItem = {
      id: `step-${Date.now()}-${this.stepCounter++}`,
      timestamp: new Date().toISOString(),
      agent: actor.toLowerCase(),
      kind: 'read',
      targets: target ? [target] : [],
      status: 'running',
    };
    steps.push(step);
  }

  private completeRunningStep(actor: string, ok: boolean = true): void {
    const steps = this.getOrCreateActorSteps(actor);
    let hadOk = false;
    for (const step of steps) {
      if (step.status === 'running') {
        step.status = ok ? 'ok' : 'failed';
        if (ok) hadOk = true;
      }
    }
    if (hadOk) {
      for (const step of steps) {
        if (step.status === 'failed') {
          step.status = 'failed_recovered';
        }
      }
    }
  }

  private getCurrentActorTag(): string {
    if (this.state.activeSubagent) {
      return this.state.activeSubagent.toUpperCase();
    }
    return this.getMainActorTag();
  }

  private getMainActorTag(): string {
    const main = this.mainAgent.toLowerCase();
    if (main.includes('orchestrator') || main === 'orch') {
      return 'ORCH';
    }
    if (main.includes('planner')) {
      return 'PLANNER';
    }
    return this.mainAgent.toUpperCase();
  }

  private pushFeedItem(actor: string, message: string): void {
    const cleanMsg = message.trim();
    if (!cleanMsg) {
      return;
    }

    const lastItem =
      this.state.activityFeed[this.state.activityFeed.length - 1];
    if (lastItem && lastItem.message === cleanMsg && lastItem.actor === actor) {
      return;
    }

    const item: ActivityFeedItem = {
      id: `${Date.now()}-${this.feedCounter++}`,
      timestamp: new Date().toISOString(),
      actor,
      message: cleanMsg,
    };

    this.state.activityFeed.push(item);
    if (this.state.activityFeed.length > this.maxFeedItems) {
      this.state.activityFeed = this.state.activityFeed.slice(-this.maxFeedItems);
    }
  }
}
