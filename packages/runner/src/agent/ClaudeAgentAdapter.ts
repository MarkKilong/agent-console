import { query, type Options, type PermissionMode, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Usage } from '@agent-console/contracts';
import type { AgentAdapter, StartTurnParams, TurnCallbacks, TurnResult } from './AgentAdapter.js';

export type ClaudeAgentAdapterOptions = {
  pathToClaudeCodeExecutable: string;
  permissionMode?: PermissionMode;
  /** Extra variables layered onto process.env for the Claude Code subprocess. */
  env?: Record<string, string>;
};

export class ClaudeAgentAdapter implements AgentAdapter {
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly options: ClaudeAgentAdapterOptions) {}

  async startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult> {
    const abortController = new AbortController();
    this.aborts.set(params.threadId, abortController);

    const options: Options = {
      abortController,
      cwd: params.cwd,
      pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
      permissionMode: this.options.permissionMode ?? 'default',
      includePartialMessages: true,
      env: { ...process.env, ...this.options.env },
      canUseTool: async (toolName, input) => {
        const decision = await callbacks.requestPermission({ toolName, input });
        return decision === 'allow'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Denied by the user' };
      },
    };
    if (params.resumeSessionId) {
      options.resume = params.resumeSessionId;
    }

    let sessionId: string | undefined;
    try {
      for await (const message of query({ prompt: params.prompt, options })) {
        sessionId = sessionIdOf(message) ?? sessionId;
        emit(message, callbacks);
      }
    } finally {
      this.aborts.delete(params.threadId);
    }

    return sessionId ? { sessionId } : {};
  }

  stop(threadId: string): void {
    this.aborts.get(threadId)?.abort();
  }
}

function sessionIdOf(message: SDKMessage): string | undefined {
  return 'session_id' in message ? message.session_id : undefined;
}

function emit(message: SDKMessage, callbacks: TurnCallbacks): void {
  switch (message.type) {
    case 'stream_event': {
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        callbacks.onEvent({ type: 'assistant_delta', text: event.delta.text });
      }
      return;
    }

    case 'assistant': {
      const text = message.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text) {
        callbacks.onEvent({ type: 'assistant_message', text });
      }
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          callbacks.onEvent({
            type: 'tool_call_started',
            toolCallId: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return;
    }

    case 'user': {
      const content = message.message.content;
      if (typeof content === 'string') return;
      for (const block of content) {
        if (block.type === 'tool_result') {
          callbacks.onEvent({
            type: 'tool_call_finished',
            toolCallId: block.tool_use_id,
            output: toolResultText(block.content),
            isError: block.is_error ?? false,
          });
        }
      }
      return;
    }

    case 'result': {
      callbacks.onEvent({
        type: 'turn_finished',
        stopReason: message.subtype === 'success' ? (message.stop_reason ?? 'end_turn') : message.subtype,
        usage: usageOf(message),
      });
      return;
    }

    default:
      // Everything else (status, hooks, task chatter) is not part of our stream yet.
      return;
  }
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block) =>
      typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : '',
    )
    .join('');
  return text || undefined;
}

function usageOf(message: Extract<SDKMessage, { type: 'result' }>): Usage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    costUsd: message.total_cost_usd,
  };
}
