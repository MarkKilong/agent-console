import {
  query,
  type ModelInfo as SdkModelInfo,
  type Options,
  type PermissionMode,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Effort, ModelInfo, Usage } from '@agent-console/contracts';
import type { AgentAdapter, StartTurnParams, TurnCallbacks, TurnResult } from './agent-adapter.js';

export type ClaudeAgentAdapterOptions = {
  pathToClaudeCodeExecutable: string;
  /** Where a model probe runs; turns use the cwd their thread was started with. */
  cwd: string;
  permissionMode?: PermissionMode;
  /** Extra variables layered onto process.env for the Claude Code subprocess. */
  env?: Record<string, string>;
  /** Read per turn: the key can be set or cleared while the runner is up. */
  apiKey?: () => string | undefined;
};

export class ClaudeAgentAdapter implements AgentAdapter {
  private readonly aborts = new Map<string, AbortController>();
  private models: Promise<ModelInfo[]> | undefined;

  constructor(private readonly options: ClaudeAgentAdapterOptions) {}

  async startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult> {
    const abortController = new AbortController();
    this.aborts.set(params.threadId, abortController);

    const options: Options = {
      abortController,
      cwd: params.cwd,
      pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
      permissionMode: this.options.permissionMode ?? 'default',
      // SDK default is a minimal prompt; use the CLI's so sessions behave like the terminal.
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      // The CLI omits thinking text by default on Claude 5; 'summarized' streams it back.
      thinking: { type: 'adaptive', display: 'summarized' },
      env: this.env(),
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
    if (params.model) {
      options.model = params.model;
    }
    if (params.effort) {
      options.effort = params.effort;
    }
    if (params.permissionMode) {
      options.permissionMode = params.permissionMode;
      // The SDK refuses bypassPermissions without this opt-in.
      if (params.permissionMode === 'bypassPermissions') {
        options.allowDangerouslySkipPermissions = true;
      }
    }

    let sessionId: string | undefined;
    const state: EmitState = { thinkingOpen: false, thinkingStreamed: false };
    try {
      for await (const message of query({ prompt: params.prompt, options })) {
        sessionId = sessionIdOf(message) ?? sessionId;
        emit(message, callbacks, state);
      }
    } finally {
      this.aborts.delete(params.threadId);
    }

    return sessionId ? { sessionId } : {};
  }

  /**
   * The CLI is the catalogue. Cached for the process lifetime — the list only moves
   * with the CLI version, and the runner is restarted for that. A failure is not
   * cached, so asking again after a login can succeed.
   */
  async listModels(): Promise<ModelInfo[]> {
    this.models ??= this.probeModels();
    try {
      return await this.models;
    } catch (error) {
      this.models = undefined;
      throw error;
    }
  }

  stop(threadId: string): void {
    this.aborts.get(threadId)?.abort();
  }

  private async probeModels(): Promise<ModelInfo[]> {
    // Streaming-input mode with a prompt that never yields: the session comes up and
    // answers control requests without ever running a turn.
    const session = query({
      prompt: IDLE_PROMPT,
      options: {
        cwd: this.options.cwd,
        pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
        env: this.env(),
      },
    });
    try {
      return (await session.supportedModels()).map(toModelInfo);
    } finally {
      session.close();
    }
  }

  /** Read per call: the key can be set or cleared while the runner is up. */
  private env(): Record<string, string | undefined> {
    const apiKey = this.options.apiKey?.();
    return {
      ...process.env,
      ...this.options.env,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    };
  }
}

/** Streaming input that never produces a message, so the probe session starts no turn. */
const IDLE_PROMPT: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
    return: async () => ({ done: true, value: undefined }),
  }),
};

function toModelInfo(model: SdkModelInfo): ModelInfo {
  return {
    id: model.value,
    resolvedId: model.resolvedModel,
    name: model.displayName,
    description: model.description,
    effortLevels: model.supportedEffortLevels as Effort[] | undefined,
    fastMode: model.supportsFastMode,
  };
}

function sessionIdOf(message: SDKMessage): string | undefined {
  return 'session_id' in message ? message.session_id : undefined;
}

/** Per-turn scratch: `content_block_stop` does not say which block it closed. */
type EmitState = { thinkingOpen: boolean; thinkingStreamed: boolean };

function emit(message: SDKMessage, callbacks: TurnCallbacks, state: EmitState): void {
  switch (message.type) {
    case 'stream_event': {
      // A sub-agent's prose is its own; folding it in would corrupt the parent's answer.
      if (message.parent_tool_use_id) return;
      const event = message.event;
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          callbacks.onEvent({ type: 'assistant_delta', text: event.delta.text });
        } else if (event.delta.type === 'thinking_delta') {
          state.thinkingOpen = true;
          state.thinkingStreamed = true;
          callbacks.onEvent({ type: 'thinking_delta', text: event.delta.thinking });
        }
        return;
      }
      if (event.type === 'content_block_stop' && state.thinkingOpen) {
        state.thinkingOpen = false;
        callbacks.onEvent({ type: 'thinking_finished' });
      }
      return;
    }

    case 'assistant': {
      const parentToolCallId = message.parent_tool_use_id ?? undefined;
      const content = message.message.content;

      if (!parentToolCallId) {
        // Only when partial messages were off, or the block streamed before we cared.
        const thinking = content
          .filter((block) => block.type === 'thinking')
          .map((block) => block.thinking)
          .join('');
        if (thinking && !state.thinkingStreamed) {
          callbacks.onEvent({ type: 'thinking_delta', text: thinking });
          callbacks.onEvent({ type: 'thinking_finished' });
        }
        state.thinkingStreamed = false;

        const text = content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
        if (text) {
          callbacks.onEvent({ type: 'assistant_message', text });
        }
      }

      for (const block of content) {
        if (block.type === 'tool_use') {
          callbacks.onEvent({
            type: 'tool_call_started',
            toolCallId: block.id,
            name: block.name,
            input: block.input,
            parentToolCallId,
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
          const capped = capToolOutput(toolResultText(block.content));
          callbacks.onEvent({
            type: 'tool_call_finished',
            toolCallId: block.tool_use_id,
            output: capped.output,
            ...(capped.truncated ? { outputTruncated: true } : {}),
            isError: block.is_error ?? false,
            parentToolCallId: message.parent_tool_use_id ?? undefined,
          });
        }
      }
      return;
    }

    case 'result': {
      callbacks.onEvent({
        type: 'turn_finished',
        stopReason:
          message.subtype === 'success' ? (message.stop_reason ?? 'end_turn') : message.subtype,
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

/** Ceiling on one tool result in the thread log; a `cat` of a huge file must not bloat it. */
export const TOOL_OUTPUT_LIMIT = 64 * 1024;
const HEAD_KEPT = 48 * 1024;
const TAIL_KEPT = 16 * 1024;

/** Keeps the head and the tail, which is where a long output says what happened. */
export function capToolOutput(text: string | undefined): {
  output: string | undefined;
  truncated: boolean;
} {
  if (text === undefined || text.length <= TOOL_OUTPUT_LIMIT)
    return { output: text, truncated: false };
  const dropped = Math.round((text.length - HEAD_KEPT - TAIL_KEPT) / 1024);
  const output = `${text.slice(0, HEAD_KEPT)}\n… [truncated ${dropped} KB] …\n${text.slice(-TAIL_KEPT)}`;
  return { output, truncated: true };
}

function usageOf(message: Extract<SDKMessage, { type: 'result' }>): Usage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    costUsd: message.total_cost_usd,
  };
}
