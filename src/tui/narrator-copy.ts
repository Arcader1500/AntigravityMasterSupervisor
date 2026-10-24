export const FIRST_LAUNCH_NOTE =
  'What do you want built? Describe it in your own words. I will ask you only about decisions the repo cannot answer.';

export const CONTEXT_RESET_NOTE =
  'Ledger phase changed to EXECUTING; a fresh orchestrator handoff and conversation reset are unconfirmed.';

export const COMPLETION_NEXT_STEPS_NOTE =
  'Review and verification are unconfirmed.';

export const HELP_TEXT_NOTE =
  `Keyboard shortcuts:
  Tab           Toggle Team rail
  Enter         Open agent in Zoom view
  Esc           Back to chat / defer decision
  Ctrl+T        Take over terminal (/raw)
  Ctrl+C twice  Quit supervisor
  PgUp / PgDn   Scroll transcript
  End           Reset scroll to bottom

Slash commands:
  /spec         View specification
  /plan         View implementation plan
  /audit        View audit log
  /raw          Take over terminal
  /pause        Pause input (Windows queues; POSIX child signal attempted)
  /resume       Resume work
  /decide       Jump to next decision
  /help         Show this help message
  /quit         Quit supervisor`;

export const TOOL_VERB_MAP: Record<string, string> = {
  view_file: 'reading',
  read_file: 'reading',
  write_to_file: 'writing',
  edit_file: 'writing',
  replace_file_content: 'writing',
  multi_replace_file_content: 'writing',
  semantic_search_nodes_tool: 'looking up in the code graph',
  query_graph_tool: 'looking up in the code graph',
  get_impact_radius_tool: 'looking up in the code graph',
  detect_changes_tool: 'looking up in the code graph',
  get_affected_flows_tool: 'looking up in the code graph',
  call_mcp_tool: 'looking up in the code graph',
  run_command: 'running command',
};

export function formatNowSentence(
  role: string,
  toolName?: string,
  target?: string,
  elapsedFormatted?: string
): string {
  const normRole = role.toLowerCase();
  let action: string;

  if (toolName === 'view_file' || toolName === 'read_file') {
    action = target ? `reading ${target}` : 'reading';
  } else if (
    toolName === 'write_to_file' ||
    toolName === 'edit_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content'
  ) {
    action = target ? `writing ${target}` : 'writing';
  } else if (
    toolName === 'run_command' ||
    (!toolName && target && (/\b(test|vitest|jest|tsc|typecheck)\b/i.test(target)))
  ) {
    const cmd = target || '';
    if (/\b(test|vitest|jest)\b/i.test(cmd)) {
      action = 'running tests';
    } else if (/\b(tsc|typecheck)\b/i.test(cmd)) {
      action = 'running the typecheck';
    } else if (cmd) {
      action = `running ${cmd}`;
    } else {
      action = 'running a command';
    }
  } else if (
    toolName &&
    [
      'semantic_search_nodes_tool',
      'query_graph_tool',
      'get_impact_radius_tool',
      'detect_changes_tool',
      'get_affected_flows_tool',
      'call_mcp_tool',
    ].includes(toolName)
  ) {
    action = target ? `looking up ${target} in the code graph` : 'looking up in the code graph';
  } else if (!toolName || !(toolName in TOOL_VERB_MAP)) {
    if (normRole.includes('reviewer') || normRole === 'code-reviewer') {
      action = 'reviewing';
    } else if (normRole.includes('verifier') || normRole === 'verifier') {
      action = 'verifying';
    } else if (normRole.includes('researcher') || normRole === 'researcher') {
      action = 'looking through the codebase';
    } else if (normRole.includes('planner') || normRole === 'planner') {
      action = 'planning the tasks';
    } else if (normRole.includes('plan-critic') || normRole === 'plan-critic') {
      action = 'checking the plan';
    } else {
      action = 'working';
    }
  } else {
    const mapped = TOOL_VERB_MAP[toolName];
    action = target ? `${mapped} ${target}` : mapped;
  }

  if (elapsedFormatted && elapsedFormatted.trim().length > 0) {
    return `The ${role} is ${action}, ${elapsedFormatted} in.`;
  }
  return `The ${role} is ${action}.`;
}

function reportSourceLabel(source?: 'agent_output' | 'artifacts' | 'ledger'): string {
  if (source === 'artifacts') return 'artifacts';
  if (source === 'ledger') return 'recorded ledger';
  return 'agent output';
}

export function formatTestSummarySentence(role: string, passed: number, failed: number, source?: 'agent_output' | 'artifacts' | 'ledger'): string {
  if (failed === 0) {
    return `${passed} of ${passed} tests pass so far, as reported by ${reportSourceLabel(source)}.`;
  }
  return `${failed} ${failed === 1 ? 'test' : 'tests'} reported failing by ${reportSourceLabel(source)}; repair status is unconfirmed.`;
}

export function formatBlockedFallbackReason(role: string): string {
  return `The ${role} reported it is blocked and did not say why. Open the agent to read its last output.`;
}

export function formatPhaseChangeNote(
  prevStatus: string,
  nextStatus: string,
  _specApprovedAt?: string,
  taskCount?: number,
  waveCount?: number
): string {
  if (nextStatus === 'PLANNING') {
    return 'Ledger phase is PLANNING.';
  }
  if (nextStatus === 'CHECKPOINT_SPEC') {
    return 'Spec draft ready for your review.';
  }
  if (nextStatus === 'EXECUTING') {
    if (waveCount && waveCount > 0) {
      return `Ledger phase is EXECUTING; ${taskCount ?? 0} tasks across ${waveCount} waves are recorded.`;
    }
    if (taskCount && taskCount > 0) {
      return `Ledger phase is EXECUTING; ${taskCount} tasks are recorded.`;
    }
    return 'Ledger phase is EXECUTING.';
  }
  if (nextStatus === 'COMPLETED') {
    return 'Legacy ledger status COMPLETED; review and verification are unconfirmed.';
  }
  if (nextStatus === 'FAILED') {
    return 'Ledger status FAILED was recorded; process outcome details may be unavailable.';
  }
  return `Phase changed from ${prevStatus} to ${nextStatus}.`;
}
