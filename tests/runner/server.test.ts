import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type RunnerServer } from '../../packages/runner/src/server.js';
import { connect, makeRepo, testConfig } from './helpers.js';

let repo: string;
let server: RunnerServer;

beforeEach(async () => {
  repo = await makeRepo();
  server = await startServer(testConfig(repo));
});

afterEach(async () => {
  await server.close();
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
      'turn_started',
      'assistant_delta',
      'assistant_delta',
      'tool_call_started',
      'permission_requested',
      'permission_resolved',
      'tool_call_finished',
      'assistant_message',
      'turn_finished',
      'diff_ready',
    ]);
    expect(client.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

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
});
