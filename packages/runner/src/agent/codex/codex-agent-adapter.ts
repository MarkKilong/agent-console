import { spawn, type ChildProcess } from 'node:child_process';
import type { Usage } from '@agent-console/contracts';
import type { AgentAdapter, StartTurnParams, TurnCallbacks, TurnResult } from '../agent-adapter.js';
import { JsonRpcClient, RpcError } from './json-rpc-client.js';

export type CodexAgentAdapterOptions = {
  command: string;
  args?: string[];
  /** Extra variables layered onto process.env for the app-server subprocess. */
  env?: Record<string, string>;
  model?: string;
};

/** Codex only asks us for approvals when the reviewer is the client, not itself. */
const THREAD_OPTIONS = {
  approvalPolicy: 'on-request',
  sandbox: 'workspace-write',
  approvalsReviewer: 'user',
} as const;

const NOT_AUTHENTICATED = 'Codex CLI is not authenticated. Run `codex login` and try again.';
const UNKNOWN_THREAD =
  /not found|missing thread|no such thread|unknown thread|does not exist|no rollout found/i;
const STOP_REASONS: Record<string, string> = {
  completed: 'end_turn',
  interrupted: 'stopped',
  failed: 'error',
};

type Turn = {
  codexThreadId: string;
  turnId: string | undefined;
  callbacks: TurnCallbacks;
  /** Command output accumulated from outputDelta, keyed by item id. */
  outputs: Map<string, string>;
  usage: Usage | undefined;
  finish(error?: Error): void;
};

type Item = {
  id: string;
  type: string;
  text?: string;
  status?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  aggregatedOutput?: string;
  changes?: unknown;
  server?: string;
  tool?: string;
  arguments?: unknown;
  name?: string;
  input?: unknown;
  query?: string;
};

/**
 * Drives `codex app-server` over newline-delimited JSON-RPC. One child process
 * serves every thread, so notifications are routed by the codex thread id and
 * anything belonging to a sub-agent thread is dropped.
 */
export class CodexAgentAdapter implements AgentAdapter {
  private session: Promise<JsonRpcClient> | undefined;
  private readonly turns = new Map<string, Turn>();
  private readonly byThread = new Map<string, Turn>();

  constructor(private readonly options: CodexAgentAdapterOptions) {}

  async startTurn(params: StartTurnParams, callbacks: TurnCallbacks): Promise<TurnResult> {
    const client = await this.connect();
    const codexThreadId = await this.openThread(client, params);

    let finish!: (error?: Error) => void;
    const completed = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve());
    });
    const turn: Turn = {
      codexThreadId,
      turnId: undefined,
      callbacks,
      outputs: new Map(),
      usage: undefined,
      finish,
    };
    this.turns.set(codexThreadId, turn);
    this.byThread.set(params.threadId, turn);

    try {
      const started = (await client.request('turn/start', {
        threadId: codexThreadId,
        input: [{ type: 'text', text: params.prompt }],
        approvalPolicy: THREAD_OPTIONS.approvalPolicy,
        approvalsReviewer: THREAD_OPTIONS.approvalsReviewer,
        sandboxPolicy: { type: 'workspaceWrite' },
      })) as { turn?: { id?: string } };
      turn.turnId ??= started.turn?.id;
      await completed;
    } finally {
      this.turns.delete(codexThreadId);
      this.byThread.delete(params.threadId);
    }

    return { sessionId: codexThreadId };
  }

  stop(threadId: string): void {
    const turn = this.byThread.get(threadId);
    if (!turn?.turnId || !this.session) return;
    const { codexThreadId, turnId } = turn;
    void this.session
      .then((client) => client.request('turn/interrupt', { threadId: codexThreadId, turnId }))
      .catch(() => {});
  }

  /** Kills the app-server; the next turn starts a fresh one. */
  close(): void {
    void this.session?.then((client) => client.close()).catch(() => {});
    this.session = undefined;
  }

  private connect(): Promise<JsonRpcClient> {
    this.session ??= this.start().catch((error: unknown) => {
      this.session = undefined; // a failed handshake must not poison later turns
      throw error;
    });
    return this.session;
  }

  private async start(): Promise<JsonRpcClient> {
    const client = new JsonRpcClient(this.spawnServer());
    client.onNotification((method, params) => this.onNotification(method, params));
    client.onServerRequest((method, params) => this.onServerRequest(method, params));

    try {
      await client.request('initialize', {
        clientInfo: { name: 'agent-console', title: 'agent-console', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      client.notify('initialized');
      const account = (await client.request('account/read', {})) as {
        account?: unknown;
        requiresOpenaiAuth?: boolean;
      };
      // The server answers happily when logged out, so check rather than wait for a failure.
      if (!account.account && account.requiresOpenaiAuth) throw new Error(NOT_AUTHENTICATED);
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private spawnServer(): ChildProcess {
    const { command, args = [], env } = this.options;
    // npm installs @openai/codex as a `codex.cmd` shim on Windows, which needs a shell.
    const shell = /\.(cmd|bat)$/i.test(command);
    const child = spawn(shell ? `"${command}"` : command, args, {
      shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...env },
    });
    child.once('exit', () => {
      this.session = undefined;
      for (const turn of this.turns.values()) turn.finish(new Error('codex app-server exited'));
      this.turns.clear();
      this.byThread.clear();
    });
    return child;
  }

  private async openThread(client: JsonRpcClient, params: StartTurnParams): Promise<string> {
    if (params.resumeSessionId) {
      try {
        const resumed = await client.request('thread/resume', {
          threadId: params.resumeSessionId,
          cwd: params.cwd,
          ...THREAD_OPTIONS,
          excludeTurns: true,
        });
        return threadIdOf(resumed);
      } catch (error) {
        // A thread the server has forgotten is not fatal: start a fresh one instead.
        if (!UNKNOWN_THREAD.test(describe(error))) throw error;
      }
    }
    const started = await client.request('thread/start', {
      cwd: params.cwd,
      ...THREAD_OPTIONS,
      ...(this.options.model ? { model: this.options.model } : {}),
    });
    return threadIdOf(started);
  }

  private onNotification(method: string, params: unknown): void {
    const payload = (params ?? {}) as Record<string, unknown>;
    const turn = this.turns.get(String(payload.threadId));
    // TODO(plan 06): sub-agent threads are dropped here; tag them with parentToolCallId instead.
    if (!turn) return;

    switch (method) {
      case 'turn/started':
        turn.turnId = (payload.turn as { id?: string } | undefined)?.id;
        return; // the turn runner already emitted turn_started

      case 'item/agentMessage/delta': {
        const delta = payload.delta;
        if (typeof delta === 'string' && delta) {
          turn.callbacks.onEvent({ type: 'assistant_delta', text: delta });
        }
        return;
      }

      case 'item/commandExecution/outputDelta': {
        const { itemId, chunk } = payload as { itemId?: string; chunk?: string };
        if (itemId && typeof chunk === 'string') {
          turn.outputs.set(itemId, (turn.outputs.get(itemId) ?? '') + chunk);
        }
        return;
      }

      case 'item/started': {
        const item = payload.item as Item | undefined;
        const tool = item && describeTool(item);
        if (item && tool) {
          turn.callbacks.onEvent({
            type: 'tool_call_started',
            toolCallId: item.id,
            name: tool.name,
            input: tool.input,
          });
        }
        return;
      }

      case 'item/completed':
        this.onItemCompleted(turn, payload.item as Item | undefined);
        return;

      case 'thread/tokenUsage/updated':
        turn.usage = usageOf(payload.tokenUsage) ?? turn.usage;
        return;

      case 'turn/completed': {
        const completed = (payload.turn ?? {}) as { status?: string; error?: unknown };
        if (completed.status === 'failed') {
          turn.callbacks.onEvent({ type: 'error', message: messageOf(completed.error) });
        }
        turn.callbacks.onEvent({
          type: 'turn_finished',
          stopReason: STOP_REASONS[completed.status ?? ''] ?? 'end_turn',
          usage: turn.usage,
        });
        turn.finish();
        return;
      }

      case 'error': {
        const { error, willRetry } = payload as { error?: unknown; willRetry?: boolean };
        if (!willRetry) turn.callbacks.onEvent({ type: 'error', message: messageOf(error) });
        return;
      }

      // TODO(plan 06): map reasoning items to thinking_delta/thinking_finished once a real
      // app-server has confirmed their field names.
      default:
        return;
    }
  }

  private onItemCompleted(turn: Turn, item: Item | undefined): void {
    if (!item) return;
    if (item.type === 'agentMessage') {
      if (item.text) turn.callbacks.onEvent({ type: 'assistant_message', text: item.text });
      return;
    }
    if (!describeTool(item)) return;

    const buffered = turn.outputs.get(item.id);
    turn.outputs.delete(item.id);
    turn.callbacks.onEvent({
      type: 'tool_call_finished',
      toolCallId: item.id,
      output: item.aggregatedOutput ?? buffered,
      isError:
        item.status === 'failed' ||
        item.status === 'declined' ||
        (item.exitCode !== undefined && item.exitCode !== 0),
    });
  }

  private async onServerRequest(method: string, params: unknown): Promise<unknown> {
    const isCommand = method === 'item/commandExecution/requestApproval';
    if (!isCommand && method !== 'item/fileChange/requestApproval') {
      throw new RpcError(-32601, `Unsupported request: ${method}`);
    }

    const payload = (params ?? {}) as {
      threadId?: string;
      itemId?: string;
      command?: string;
      cwd?: string;
      grantRoot?: string;
      reason?: string;
    };
    const turn = this.turns.get(String(payload.threadId));
    // An approval for a sub-agent thread is declined rather than answered by us.
    if (!turn) return { decision: 'decline' };

    const decision = await turn.callbacks.requestPermission({
      toolName: isCommand ? 'Bash' : 'Edit',
      input: isCommand
        ? { command: payload.command, cwd: payload.cwd }
        : { itemId: payload.itemId, grantRoot: payload.grantRoot },
      description: payload.reason,
    });
    return { decision: decision === 'allow' ? 'accept' : 'decline' };
  }
}

function describeTool(item: Item): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'Bash', input: { command: item.command, cwd: item.cwd } };
    case 'fileChange':
      return { name: 'Edit', input: { changes: item.changes } };
    case 'mcpToolCall':
      return {
        name: item.tool ?? 'mcpToolCall',
        input: { server: item.server, arguments: item.arguments },
      };
    case 'dynamicToolCall':
      return { name: item.name ?? 'dynamicToolCall', input: item.input };
    case 'webSearch':
      return { name: 'WebSearch', input: { query: item.query } };
    default:
      return undefined; // reasoning and agentMessage items are not tool calls
  }
}

function threadIdOf(result: unknown): string {
  const id = (result as { thread?: { id?: unknown } } | undefined)?.thread?.id;
  if (typeof id !== 'string' || !id) throw new Error('codex app-server returned no thread id');
  return id;
}

function usageOf(tokenUsage: unknown): Usage | undefined {
  type Tokens = { inputTokens?: number; outputTokens?: number };
  const last = (tokenUsage as { last?: Tokens } | undefined)?.last;
  if (!last) return undefined;
  return { inputTokens: last.inputTokens, outputTokens: last.outputTokens };
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'The codex app-server reported an error';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
