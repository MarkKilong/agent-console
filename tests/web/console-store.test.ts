import type { Event } from '@agent-console/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConsoleStore } from '../../apps/web/src/store/use-console-store.js';

beforeEach(() => {
  useConsoleStore.setState({ threadOrder: [], threadMeta: {}, threads: {}, activeThreadId: null });
});

function newThreadId(): string {
  useConsoleStore.getState().newThread();
  const id = useConsoleStore.getState().activeThreadId;
  if (!id) throw new Error('no active thread');
  return id;
}

describe('thread meta', () => {
  it('copies the agent and branch off a restored summary', () => {
    useConsoleStore
      .getState()
      .hydrateThreads([
        { id: 't1', title: 'ship it', agent: 'codex', branch: 'main', updatedAt: 5 },
      ]);

    expect(useConsoleStore.getState().threadMeta.t1).toEqual({
      id: 't1',
      title: 'ship it',
      agent: 'codex',
      branch: 'main',
      createdAt: 5,
    });
  });

  it('defaults a new thread to claude with no branch yet', () => {
    const id = newThreadId();
    expect(useConsoleStore.getState().threadMeta[id]?.agent).toBe('claude');
    expect(useConsoleStore.getState().threadMeta[id]?.branch).toBeUndefined();
  });

  it('renames the thread on thread_titled, over the name the prompt gave it', () => {
    const id = newThreadId();
    useConsoleStore.getState().notePrompt(id, 'fix this');

    const titled = {
      type: 'thread_titled',
      title: 'Fixing the flaky test',
      seq: 1,
      threadId: id,
      ts: 0,
    } as Event;

    useConsoleStore.getState().applyEvent(titled);
    expect(useConsoleStore.getState().threadMeta[id]?.title).toBe('Fixing the flaky test');
  });

  it('takes the branch off turn_started', () => {
    const id = newThreadId();
    const started = {
      type: 'turn_started',
      branch: 'feat/app-shell',
      seq: 1,
      threadId: id,
      ts: 0,
    } as Event;

    useConsoleStore.getState().applyEvent(started);
    expect(useConsoleStore.getState().threadMeta[id]?.branch).toBe('feat/app-shell');
  });
});
