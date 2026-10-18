import {
  ActivityFeedItem,
  ParserState,
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
const SYSTEM_MSG_REGEX = /<?SYSTEM_MESSAGE>?/i;
const VERDICT_REGEX =
  /(?:\*\*Status:\*\*|\bStatus:|\bVerdict:)\s*(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED|READY)\b/i;
const STANDALONE_VERDICT_REGEX =
  /^\s*(?:[-*]\s*)?(DONE_WITH_CONCERNS|DONE|NEEDS_CONTEXT|BLOCKED|READY)\b/i;

const PROMPT_REGEX = /(?:ask_question|ctrl\+k|allow\s+command|\?\s+)/i;

const COMMAND_LINE_REGEX = /run_command/i;
const EXIT_CODE_REGEX =
  /(?:exit\s+code[:\s]+[0-9]+|\bexit\s+[0-9]+|command exited with code\s+[0-9]+)/i;

const TOOL_ACTION_REGEX =
  /(?:\b(?:view_file|write_to_file|edit_file|replace_file_content|multi_replace_file_content|grep_search|call_mcp_tool)\b|toolAction)/i;

export class TelemetryParser {
  private mainAgent: string;
  private maxFeedItems: number;
  private feedCounter = 0;
  private state: ParserState;

  constructor(options?: TelemetryParserOptions) {
    this.mainAgent = options?.mainAgent ?? 'agy';
    this.maxFeedItems = options?.maxFeedItems ?? 100;
    this.state = {
      mainAgent: this.mainAgent,
      activeSubagent: null,
      subagentStartedAt: null,
      lastAction: null,
      lastCommand: null,
      waitingForInput: false,
      activityFeed: [],
    };
  }

  public getState(): Readonly<ParserState> {
    return this.state;
  }

  public clearWaitingForInput(): void {
    this.state.waitingForInput = false;
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
      this.state.activeSubagent = subagentDispatched.toLowerCase();
      this.state.subagentStartedAt = Date.now();
      this.state.waitingForInput = false;
      this.state.lastAction = trimmed;

      const orchActor = this.mainAgent.toLowerCase().includes('planner')
        ? 'PLANNER'
        : 'ORCH';
      this.pushFeedItem(orchActor, trimmed);
      return;
    }

    // 2. Subagent completion
    const messageMatch = trimmed.match(MESSAGE_REGEX);
    const isMessage = messageMatch !== null;
    const isSystemMsg = SYSTEM_MSG_REGEX.test(trimmed);
    const isVerdict =
      VERDICT_REGEX.test(trimmed) ||
      (this.state.activeSubagent !== null &&
        STANDALONE_VERDICT_REGEX.test(trimmed));

    if (isMessage || isSystemMsg || isVerdict) {
      const actor = this.state.activeSubagent
        ? this.state.activeSubagent.toUpperCase()
        : (messageMatch?.[1]?.toUpperCase() ?? this.getMainActorTag());

      this.state.activeSubagent = null;
      this.state.subagentStartedAt = null;
      this.state.waitingForInput = false;
      this.pushFeedItem(actor, trimmed);
      return;
    }

    // 3. Interactive prompt
    const isPrompt = PROMPT_REGEX.test(trimmed);
    if (isPrompt) {
      this.state.waitingForInput = true;
      if (/ask_question/i.test(trimmed)) {
        this.state.lastAction = trimmed;
      }
      const actor = this.getCurrentActorTag();
      this.pushFeedItem(actor, trimmed);
      return;
    }

    // 4. Command execution
    const isRunCmd = COMMAND_LINE_REGEX.test(trimmed);
    const isExitCode = EXIT_CODE_REGEX.test(trimmed);
    if (isRunCmd || isExitCode) {
      if (isRunCmd) {
        const cmdMatch = trimmed.match(/run_command[:\s->]+(.*)/i);
        this.state.lastCommand = cmdMatch ? cmdMatch[1].trim() : trimmed;
        this.state.lastAction = trimmed;
      } else {
        this.state.lastCommand = trimmed;
      }
      this.state.waitingForInput = false;
      const actor = this.getCurrentActorTag();
      this.pushFeedItem(actor, trimmed);
      return;
    }

    // 5. Tool actions
    if (TOOL_ACTION_REGEX.test(trimmed)) {
      this.state.lastAction = trimmed;
      this.state.waitingForInput = false;
      const actor = this.getCurrentActorTag();
      this.pushFeedItem(actor, trimmed);
      return;
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
