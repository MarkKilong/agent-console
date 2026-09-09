import { fileURLToPath } from 'node:url';
import type { EventBody, PermissionDecision } from '@agent-console/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  PermissionRequest,
  TurnCallbacks,
} from '../../packages/runner/src/agent/agent-adapter.js';
import { CodexAgentAdapter } from '../../packages/runner/src/agent/codex/codex-agent-adapter.js';

const SERVER = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url));
const CWD = process.cwd();

const adapters: CodexAgentAdapter[] = [];

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
});

function makeAdapter(env?: Record<string, string>): CodexAgentAdapter {
  const adapter = new CodexAgentAdapter({ command: process.execPath, args: [SERVER], env });
  adapters.push(adapter);
  return adapter;
}

function recorder(decision: PermissionDecision = 'allow') {
  const events: EventBody[] = [];
  const permissions: PermissionRequest[] = [];
  const callbacks: TurnCallbacks = {
    onEvent: (body) => events.push(body),
    requestPermission: async (request) => {
      permissions.push(request);
      return decision;
    },
  };
  return { events, permissions, callbacks };
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (ready()) return;
    await new Promise((next) => setTimeout(next, 10));
  }
  throw new Error('timed out waiting for the fake app-server');
}

describe('CodexAgentAdapter', () => {
  it('normalizes a turn into our event stream', async () => {
    const { events, permissions, callbacks } = recorder();

    const result = await makeAdapter().startTurn(
      { threadId: 't1', prompt: 'say hello', cwd: CWD },
      callbacks,
    );

    expect(events.map((event) => event.type)).toEqual([
      'assistant_delta',
      'assistant_message',
      'tool_call_started',
      'tool_call_finished',
      'turn_finished',
    ]);
    expect(events[1]).toEqual({ type: 'assistant_message', text: 'Hello from fake codex' });
    expect(events[2]).toMatchObject({
      type: 'tool_call_started',
      name: 'Bash',
      input: { command: 'echo hi', cwd: '/repo' },
    });
    expect(events[3]).toMatchObject({ type: 'tool_call_finished', output: 'hi\n', isError: false });
    expect(events[4]).toEqual({
      type: 'turn_finished',
      stopReason: 'end_turn',
      usage: { inputTokens: 11, outputTokens: 22 },
    });
    expect(permissions).toEqual([
      {
        toolName: 'Bash',
        input: { command: 'echo hi', cwd: '/repo' },
        description: 'Run echo hi',
      },
    ]);
    expect(result.sessionId).toMatch(/^codex-thread-/);
  });

  it('ignores notifications from sub-agent threads', async () => {
    const { events, callbacks } = recorder();

    await makeAdapter().startTurn({ threadId: 't1', prompt: 'say hello', cwd: CWD }, callbacks);

    expect(JSON.stringify(events)).not.toContain('sub-agent');
  });

  it('declines the tool call when the user denies it', async () => {
    const { events, callbacks } = recorder('deny');

    await makeAdapter().startTurn({ threadId: 't1', prompt: 'say hello', cwd: CWD }, callbacks);

    expect(events.find((event) => event.type === 'tool_call_finished')).toMatchObject({
      isError: true,
    });
  });

  it('fails the turn when the CLI is not authenticated', async () => {
    const adapter = makeAdapter({ FAKE_CODEX_UNAUTHENTICATED: '1' });

    await expect(
      adapter.startTurn({ threadId: 't1', prompt: 'say hello', cwd: CWD }, recorder().callbacks),
    ).rejects.toThrow(/codex login/);
  });

  it('resumes the same codex thread on the next turn', async () => {
    const adapter = makeAdapter();

    const first = await adapter.startTurn(
      { threadId: 't1', prompt: 'say hello', cwd: CWD },
      recorder().callbacks,
    );
    const second = await adapter.startTurn(
      { threadId: 't1', prompt: 'again', cwd: CWD, resumeSessionId: first.sessionId },
      recorder().callbacks,
    );

    expect(second.sessionId).toBe(first.sessionId);
  });

  it('starts a new thread when the one to resume is gone', async () => {
    const adapter = makeAdapter({ FAKE_CODEX_UNKNOWN_THREAD: '1' });

    const result = await adapter.startTurn(
      { threadId: 't1', prompt: 'say hello', cwd: CWD, resumeSessionId: 'codex-thread-gone' },
      recorder().callbacks,
    );

    expect(result.sessionId).toMatch(/^codex-thread-/);
    expect(result.sessionId).not.toBe('codex-thread-gone');
  });

  it('interrupts a running turn on stop', async () => {
    const adapter = makeAdapter();
    const { events, callbacks } = recorder();

    const turn = adapter.startTurn({ threadId: 't1', prompt: 'hang around', cwd: CWD }, callbacks);
    await waitFor(() => events.length > 0);
    adapter.stop('t1');
    await turn;

    expect(events.at(-1)).toMatchObject({ type: 'turn_finished', stopReason: 'stopped' });
  });
});
