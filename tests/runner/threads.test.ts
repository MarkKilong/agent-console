import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event } from '@agent-console/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileThreadStore, MemoryThreadStore } from '../../packages/runner/src/thread-store.js';
import { ThreadRegistry } from '../../packages/runner/src/threads.js';

describe('ThreadRegistry', () => {
  it('stamps seq, threadId and ts on appended events', () => {
    const registry = new ThreadRegistry();
    const first = registry.append('t1', { type: 'turn_started' });
    const second = registry.append('t1', { type: 'assistant_delta', text: 'hi' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.threadId).toBe('t1');
    expect(typeof second.ts).toBe('number');
  });

  it('numbers each thread independently', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    expect(registry.append('t2', { type: 'turn_started' }).seq).toBe(1);
  });

  it('replays events after a cursor, then live-tails', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    registry.append('t1', { type: 'assistant_delta', text: 'a' });
    registry.append('t1', { type: 'assistant_delta', text: 'b' });

    const seen: Event[] = [];
    const unsubscribe = registry.subscribe('t1', 1, (event) => seen.push(event));
    expect(seen.map((event) => event.seq)).toEqual([2, 3]);

    registry.append('t1', { type: 'turn_finished', stopReason: 'end_turn' });
    expect(seen.map((event) => event.seq)).toEqual([2, 3, 4]);

    unsubscribe();
    registry.append('t1', { type: 'turn_started' });
    expect(seen).toHaveLength(3);
  });

  it('tracks the active turn and resume cursor', () => {
    const registry = new ThreadRegistry();
    expect(registry.activeTurn('t1')).toBeUndefined();

    const turn = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    registry.setActiveTurn('t1', turn);
    expect(registry.activeTurn('t1')).toBe(turn);

    registry.setActiveTurn('t1', undefined);
    expect(registry.activeTurn('t1')).toBeUndefined();

    registry.setSessionId('t1', 'session-1');
    expect(registry.sessionId('t1')).toBe('session-1');
  });

  it('stops every running turn, so shutdown leaves no agent behind', () => {
    const registry = new ThreadRegistry();
    const first = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    const second = { answerPermission: vi.fn(() => true), stop: vi.fn() };
    registry.setActiveTurn('t1', first);
    registry.setActiveTurn('t2', second);
    registry.setActiveTurn('t3', undefined);

    registry.stopActiveTurns();

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('returns only events after the requested seq', () => {
    const registry = new ThreadRegistry();
    registry.append('t1', { type: 'turn_started' });
    registry.append('t1', { type: 'turn_finished', stopReason: 'end_turn' });
    expect(registry.eventsAfter('t1', 1).map((event) => event.type)).toEqual(['turn_finished']);
    expect(registry.eventsAfter('t1').map((event) => event.type)).toHaveLength(2);
  });
});

describe('ThreadRegistry persistence', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'agent-console-threads-'));
    dirs.push(dir);
    return dir;
  }

  it('rebuilds from the store it wrote to', () => {
    const store = new MemoryThreadStore();
    const registry = new ThreadRegistry(store, 'fake');
    registry.notePrompt('t1', 'ship the thing');
    registry.append('t1', { type: 'turn_started' });
    registry.append('t1', { type: 'assistant_message', text: 'done' });
    registry.setSessionId('t1', 'session-1');

    const reloaded = new ThreadRegistry(store, 'fake');
    expect(reloaded.eventsAfter('t1').map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_message',
    ]);
    expect(reloaded.sessionId('t1')).toBe('session-1');
    expect(reloaded.list()).toEqual([
      { id: 't1', title: 'ship the thing', agent: 'fake', updatedAt: expect.any(Number) },
    ]);
    // seq carries on from the restored log rather than restarting.
    expect(reloaded.append('t1', { type: 'turn_finished', stopReason: 'end_turn' }).seq).toBe(3);
  });

  it('reloads from disk and skips a torn final line', async () => {
    const dir = await tempDir();
    const registry = new ThreadRegistry(new FileThreadStore(dir), 'fake');
    registry.notePrompt('t1', `${'long prompt '.repeat(10)}tail`);
    registry.append('t1', { type: 'turn_started' });
    registry.setSessionId('t1', 'session-1');

    // What a crash mid-append leaves behind.
    await appendFile(join(dir, 't1.jsonl'), '{"type":"turn_fini');

    const reloaded = new ThreadRegistry(new FileThreadStore(dir), 'fake');
    expect(reloaded.eventsAfter('t1').map((event) => event.type)).toEqual(['turn_started']);
    expect(reloaded.sessionId('t1')).toBe('session-1');
    expect(reloaded.list()[0]?.title).toHaveLength(60);
  });

  it('keeps the branch on the meta line, so a reloaded thread still lists it', async () => {
    const dir = await tempDir();
    const registry = new ThreadRegistry(new FileThreadStore(dir), 'fake');
    registry.notePrompt('t1', 'ship it');
    registry.setBranch('t1', 'feat/app-shell');
    registry.append('t1', { type: 'turn_started', branch: 'feat/app-shell' });

    const reloaded = new ThreadRegistry(new FileThreadStore(dir), 'fake');
    expect(reloaded.list()).toEqual([
      {
        id: 't1',
        title: 'ship it',
        agent: 'fake',
        branch: 'feat/app-shell',
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it('keeps going when the log cannot be written', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'blocker'), '');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A file where the directory should be: every mkdir and append fails.
    const registry = new ThreadRegistry(new FileThreadStore(join(dir, 'blocker', 'threads')));
    expect(registry.append('t1', { type: 'turn_started' }).seq).toBe(1);
    expect(errors).toHaveBeenCalled();
  });
});
