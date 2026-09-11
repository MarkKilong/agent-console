import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  CommandSchema,
  EnvSpecSchema,
  EventSchema,
  PROTOCOL_VERSION,
  ResponseSchema,
  ServerMessageSchema,
} from '../../packages/contracts/src/index.js';

describe('commands', () => {
  it('round-trips send_prompt', () => {
    const command = { type: 'send_prompt', threadId: 't1', text: 'hello' };
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('round-trips send_prompt with the composer settings', () => {
    const command = {
      type: 'send_prompt',
      threadId: 't1',
      text: 'hello',
      model: 'claude-sonnet-5',
      effort: 'low',
      permissionMode: 'bypassPermissions',
    };
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('round-trips send_prompt with a thread-naming model', () => {
    const command = { type: 'send_prompt', threadId: 't1', text: 'hello', titleModel: 'haiku' };
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('rejects send_prompt with an unknown effort or permission mode', () => {
    const base = { type: 'send_prompt', threadId: 't1', text: 'hello' };
    expect(CommandSchema.safeParse({ ...base, effort: 'turbo' }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...base, permissionMode: 'plan' }).success).toBe(false);
  });

  it('round-trips list_threads', () => {
    const command = { type: 'list_threads', requestId: 'r1' };
    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it('round-trips the auth commands', () => {
    for (const command of [
      { type: 'auth_status', requestId: 'r1' },
      { type: 'auth_login_start', requestId: 'r1' },
      { type: 'auth_login_code', requestId: 'r1', code: 'abc' },
      { type: 'auth_logout', requestId: 'r1' },
      { type: 'auth_set_api_key', requestId: 'r1', key: 'sk-ant' },
      { type: 'auth_clear_api_key', requestId: 'r1' },
    ]) {
      expect(CommandSchema.parse(command)).toEqual(command);
    }
  });

  it('round-trips the terminal commands', () => {
    for (const command of [
      { type: 'terminal_open', requestId: 'r1', shell: 'powershell', cols: 80, rows: 24 },
      { type: 'terminal_open', requestId: 'r1', cols: 80, rows: 24 },
      { type: 'terminal_input', terminalId: 'tm1', data: 'ls\r' },
      { type: 'terminal_resize', terminalId: 'tm1', cols: 100, rows: 30 },
      { type: 'terminal_close', terminalId: 'tm1' },
    ]) {
      expect(CommandSchema.parse(command)).toEqual(command);
    }
  });

  it('rejects terminal_open with an unknown shell or a zero size', () => {
    const base = { type: 'terminal_open', requestId: 'r1', cols: 80, rows: 24 };
    expect(CommandSchema.safeParse({ ...base, shell: 'fish' }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...base, cols: 0 }).success).toBe(false);
  });

  it('rejects an unknown command type', () => {
    expect(CommandSchema.safeParse({ type: 'nope', threadId: 't1' }).success).toBe(false);
  });

  it('rejects answer_permission with an invalid decision', () => {
    const result = CommandSchema.safeParse({
      type: 'answer_permission',
      threadId: 't1',
      requestId: 'r1',
      decision: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});

describe('events', () => {
  it('round-trips turn_finished with usage', () => {
    const event = {
      type: 'turn_finished',
      seq: 7,
      threadId: 't1',
      ts: 1700000000000,
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 },
    };
    expect(EventSchema.parse(event)).toEqual(event);
  });

  it('round-trips user_message and the thinking pair', () => {
    const envelope = { seq: 1, threadId: 't1', ts: 1700000000000 };
    for (const body of [
      { type: 'user_message', text: 'do the thing' },
      { type: 'thinking_delta', text: 'weighing options' },
      { type: 'thinking_finished' },
    ]) {
      const event = { ...envelope, ...body };
      expect(EventSchema.parse(event)).toEqual(event);
    }
  });

  it('round-trips thread_titled', () => {
    const event = {
      type: 'thread_titled',
      seq: 2,
      threadId: 't1',
      ts: 1700000000000,
      title: 'Fix the flaky test',
    };
    expect(EventSchema.parse(event)).toEqual(event);
  });

  it('round-trips a sub-agent tool call tagged with its parent', () => {
    const started = {
      type: 'tool_call_started',
      seq: 4,
      threadId: 't1',
      ts: 1700000000000,
      toolCallId: 'child',
      name: 'Read',
      input: { file_path: 'a.ts' },
      parentToolCallId: 'task-1',
    };
    expect(EventSchema.parse(started)).toEqual(started);

    const finished = {
      type: 'tool_call_finished',
      seq: 5,
      threadId: 't1',
      ts: 1700000000000,
      toolCallId: 'child',
      isError: false,
      parentToolCallId: 'task-1',
    };
    expect(EventSchema.parse(finished)).toEqual(finished);
  });

  it('leaves parentToolCallId off a top-level tool call', () => {
    const event = {
      type: 'tool_call_finished',
      seq: 6,
      threadId: 't1',
      ts: 1700000000000,
      toolCallId: 'top',
      isError: false,
    };
    expect(EventSchema.parse(event)).toEqual(event);
  });

  it('round-trips turn_started with and without a branch', () => {
    const started = { type: 'turn_started', seq: 1, threadId: 't1', ts: 1700000000000 };
    expect(EventSchema.parse(started)).toEqual(started);

    const onBranch = { ...started, branch: 'feat/app-shell' };
    expect(EventSchema.parse(onBranch)).toEqual(onBranch);
  });

  it('rejects an event without seq', () => {
    const result = EventSchema.safeParse({ type: 'turn_started', threadId: 't1', ts: 0 });
    expect(result.success).toBe(false);
  });
});

describe('responses', () => {
  it('round-trips an ok get_diff response', () => {
    const response = {
      requestId: 'r1',
      ok: true,
      data: { files: [{ path: 'a.ts', status: 'modified', patch: '@@' }] },
    };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips an ok list_threads response', () => {
    const response = {
      requestId: 'r1',
      ok: true,
      data: {
        threads: [
          { id: 't1', title: 'ship it', agent: 'claude', updatedAt: 1700000000000 },
          {
            id: 't2',
            title: 'on a branch',
            agent: 'claude',
            branch: 'feat/app-shell',
            updatedAt: 1700000000001,
          },
        ],
      },
    };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips an auth_status response', () => {
    const response = {
      requestId: 'r1',
      ok: true,
      data: {
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'dev@example.com',
        apiKey: false,
        loginPending: false,
      },
    };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips an ok-only auth response', () => {
    const response = { requestId: 'r1', ok: true, data: { ok: true } };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips a terminal_open response', () => {
    const response = {
      requestId: 'r1',
      ok: true,
      data: { terminalId: 'tm1', shell: 'powershell', title: 'PowerShell' },
    };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });

  it('round-trips an error response', () => {
    const response = { requestId: 'r1', ok: false, error: 'boom' };
    expect(ResponseSchema.parse(response)).toEqual(response);
  });
});

describe('wire messages', () => {
  it('parses a hello carrying the runner platform and its installed shells', () => {
    const hello = {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      runnerVersion: '0.1.0',
      platform: 'win32',
      shells: [
        { kind: 'powershell', title: 'PowerShell' },
        { kind: 'cmd', title: 'cmd' },
      ],
    };
    expect(ServerMessageSchema.parse(hello)).toEqual(hello);
  });

  it('rejects a hello without a platform', () => {
    const hello = {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      runnerVersion: '0.1.0',
      shells: [],
    };
    expect(ServerMessageSchema.safeParse(hello).success).toBe(false);
  });

  it('rejects a hello without shells', () => {
    const hello = {
      kind: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      runnerVersion: '0.1.0',
      platform: 'linux',
    };
    expect(ServerMessageSchema.safeParse(hello).success).toBe(false);
  });

  it('parses the terminal message kinds', () => {
    for (const message of [
      { kind: 'terminal_output', terminalId: 'tm1', data: '$ ' },
      { kind: 'terminal_exit', terminalId: 'tm1', exitCode: 0 },
    ]) {
      expect(ServerMessageSchema.parse(message)).toEqual(message);
    }
  });

  it('rejects a command sent as a server message', () => {
    const message = { kind: 'command', command: { type: 'stop_turn', threadId: 't1' } };
    expect(ServerMessageSchema.safeParse(message).success).toBe(false);
    expect(ClientMessageSchema.parse(message)).toEqual(message);
  });
});

describe('env spec', () => {
  it('accepts a local repo path', () => {
    expect(EnvSpecSchema.parse({ repoPath: '/repo' })).toEqual({ repoPath: '/repo' });
  });

  it('rejects both repoPath and repoUrl', () => {
    const result = EnvSpecSchema.safeParse({
      repoPath: '/repo',
      repoUrl: 'https://example.com/r.git',
    });
    expect(result.success).toBe(false);
  });
});
