import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Config } from '../../packages/runner/src/config.js';
import { startServer, type RunnerServer } from '../../packages/runner/src/server.js';
import { connect, makeRepo, testConfig, type TestClient } from './helpers.js';

let repo: string;
let config: Config;
let server: RunnerServer;

beforeEach(async () => {
  repo = await makeRepo();
  config = testConfig(repo);
  server = await startServer(config);
});

afterEach(async () => {
  await server.close();
  await rm(config.threadsDir, { recursive: true, force: true });
});

describe('healthz', () => {
  it('answers without auth', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    await expect(response.json()).resolves.toEqual({ ok: true, protocolVersion: 1 });
  });
});

describe('auth', () => {
  it('closes connections with a bad token using 4401', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/?token=wrong`);
    const code = await new Promise<number>((resolve) => socket.on('close', resolve));
    expect(code).toBe(4401);
  });
});

describe('a full turn', () => {
  it('streams the scripted sequence and ends with turn_finished then diff_ready', async () => {
    const client = await connect(server.port, 'test-token');
    client.send({ type: 'subscribe', threadId: 't1' });
    client.send({ type: 'send_prompt', threadId: 't1', text: 'build it' });

    const permission = await client.waitForEvent((event) => event.type === 'permission_requested');
    if (permission.type !== 'permission_requested') throw new Error('unreachable');

    // The turn is parked on the permission prompt, so this lands inside the turn.
    await writeFile(join(repo, 'during-turn.txt'), 'written mid-turn\n');

    client.send({
      type: 'answer_permission',
      threadId: 't1',
      requestId: permission.requestId,
      decision: 'allow',
    });

    const diffReady = await client.waitForEvent((event) => event.type === 'diff_ready');

    expect(client.events.map((event) => event.type)).toEqual([
      'user_message',
      'turn_started',
      'thinking_delta',
      'thinking_finished',
      'assistant_delta',
      'assistant_delta',
      'tool_call_started',
      'permission_requested',
      'permission_resolved',
      'tool_call_finished',
      'tool_call_started',
      'tool_call_started',
      'tool_call_finished',
      'tool_call_finished',
      'assistant_message',
      'turn_finished',
      'diff_ready',
    ]);
    expect(client.events.map((event) => event.seq)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    );

    // The sub-agent's own call is tagged with the Task call that spawned it.
    const task = client.events.find(
      (event) => event.type === 'tool_call_started' && event.name === 'Task',
    );
    if (task?.type !== 'tool_call_started') throw new Error('unreachable');
    const nested = client.events.filter(
      (event) => 'parentToolCallId' in event && event.parentToolCallId === task.toolCallId,
    );
    expect(nested.map((event) => event.type)).toEqual(['tool_call_started', 'tool_call_finished']);

    if (diffReady.type !== 'diff_ready') throw new Error('unreachable');
    // untracked.txt predates the turn, so only the mid-turn write is reported.
    expect(diffReady.files).toEqual([
      expect.objectContaining({ path: 'during-turn.txt', status: 'added' }),
    ]);

    // get_diff with a threadId is anchored to the same snapshot.
    client.send({ type: 'get_diff', requestId: 'r-thread', threadId: 't1' });
    const scoped = await client.waitForResponse('r-thread');
    expect(scoped.ok && 'files' in scoped.data && scoped.data.files).toEqual([
      expect.objectContaining({ path: 'during-turn.txt', status: 'added' }),
    ]);

    client.close();
  }, 15000);

  it('reports an adapter failure as error then turn_finished', async () => {
    const client = await connect(server.port, 'test-token');
    client.send({ type: 'subscribe', threadId: 't1' });
    client.send({ type: 'send_prompt', threadId: 't1', text: 'fail-turn please' });

    await client.waitForEvent((event) => event.type === 'diff_ready');
    expect(client.events.map((event) => event.type)).toEqual([
      'user_message',
      'turn_started',
      'error',
      'turn_finished',
      'diff_ready',
    ]);
    expect(client.events.find((event) => event.type === 'turn_finished')).toMatchObject({
      stopReason: 'error',
    });

    client.close();
  }, 15000);

  it('stops a turn that is stopped in the same tick it was started', async () => {
    const client = await connect(server.port, 'test-token');
    client.send({ type: 'subscribe', threadId: 't1' });
    client.send({ type: 'send_prompt', threadId: 't1', text: 'stop me' });
    client.send({ type: 'stop_turn', threadId: 't1' });

    const finished = await client.waitForEvent((event) => event.type === 'turn_finished');
    expect(finished).toMatchObject({ stopReason: 'stopped' });
    // The adapter never ran, so it never asked for anything.
    expect(client.events.some((event) => event.type === 'permission_requested')).toBe(false);

    client.close();
  }, 15000);

  it('rejects a second prompt while a turn is running', async () => {
    const client = await connect(server.port, 'test-token');
    client.send({ type: 'subscribe', threadId: 't1' });
    client.send({ type: 'send_prompt', threadId: 't1', text: 'first' });

    const permission = await client.waitForEvent((event) => event.type === 'permission_requested');
    if (permission.type !== 'permission_requested') throw new Error('unreachable');

    client.send({ type: 'send_prompt', threadId: 't1', text: 'second' });
    const error = await client.waitForEvent((event) => event.type === 'error');
    if (error.type !== 'error') throw new Error('unreachable');
    expect(error.code).toBe('turn_active');

    client.send({
      type: 'answer_permission',
      threadId: 't1',
      requestId: permission.requestId,
      decision: 'deny',
    });
    await client.waitForEvent((event) => event.type === 'diff_ready');
    client.close();
  }, 15000);
});

describe('request/response commands', () => {
  it('lists files, reads one, and refuses to escape the workspace', async () => {
    const client = await connect(server.port, 'test-token');

    client.send({ type: 'list_files', requestId: 'r1' });
    const list = await client.waitForResponse('r1');
    expect(list.ok && 'files' in list.data && list.data.files).toContain('untracked.txt');

    client.send({ type: 'read_file', requestId: 'r2', path: 'untracked.txt' });
    const read = await client.waitForResponse('r2');
    expect(read.ok && 'content' in read.data && read.data.content).toBe('hello\n');

    client.send({ type: 'read_file', requestId: 'r3', path: '../../etc/hosts' });
    const escaped = await client.waitForResponse('r3');
    expect(escaped.ok).toBe(false);

    client.send({ type: 'get_diff', requestId: 'r4' });
    const diff = await client.waitForResponse('r4');
    expect(diff.ok && 'files' in diff.data && diff.data.files).toHaveLength(1);

    client.close();
  }, 15000);

  it('lists threads a previous runner persisted, newest first', async () => {
    const client = await connect(server.port, 'test-token');
    await runTurn(client, 't1', 'first prompt');
    await runTurn(client, 't2', 'second prompt');
    client.close();

    // A second runner over the same log directory, as if the first had been killed.
    await server.close();
    server = await startServer(config);

    const reopened = await connect(server.port, 'test-token');
    reopened.send({ type: 'list_threads', requestId: 'r5' });
    const listed = await reopened.waitForResponse('r5');
    expect(listed.ok && 'threads' in listed.data && listed.data.threads).toEqual([
      { id: 't2', title: 'second prompt', agent: 'fake', updatedAt: expect.any(Number) },
      { id: 't1', title: 'first prompt', agent: 'fake', updatedAt: expect.any(Number) },
    ]);

    reopened.close();
  }, 15000);

  it('replays the user prompt after a restart, so reopened history is complete', async () => {
    const client = await connect(server.port, 'test-token');
    await runTurn(client, 't1', 'remember me');
    client.close();

    await server.close();
    server = await startServer(config);

    const reopened = await connect(server.port, 'test-token');
    reopened.send({ type: 'subscribe', threadId: 't1' });
    const replayed = await reopened.waitForEvent((event) => event.type === 'diff_ready');
    expect(replayed.threadId).toBe('t1');

    const prompt = reopened.events.find((event) => event.type === 'user_message');
    expect(prompt).toMatchObject({ seq: 1, text: 'remember me' });

    reopened.close();
  }, 15000);
});

async function runTurn(client: TestClient, threadId: string, text: string): Promise<void> {
  client.send({ type: 'subscribe', threadId });
  client.send({ type: 'send_prompt', threadId, text });

  const permission = await client.waitForEvent(
    (event) => event.type === 'permission_requested' && event.threadId === threadId,
  );
  if (permission.type !== 'permission_requested') throw new Error('unreachable');

  client.send({
    type: 'answer_permission',
    threadId,
    requestId: permission.requestId,
    decision: 'allow',
  });
  await client.waitForEvent((event) => event.type === 'diff_ready' && event.threadId === threadId);
}
