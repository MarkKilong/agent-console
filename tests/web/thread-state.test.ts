import type { Event, EventBody } from '@agent-console/contracts';
import { describe, expect, it } from 'vitest';
import { emptyThread, foldEvent } from '../../apps/web/src/store/thread-state.js';
import type { ChatItem, ThreadState } from '../../apps/web/src/store/thread-state.js';

function fold(...bodies: EventBody[]): ThreadState {
  return bodies.reduce<ThreadState>(
    (thread, body, index) =>
      foldEvent(thread, { ...body, seq: index + 1, threadId: 't1', ts: index } as Event),
    emptyThread(),
  );
}

function assistant(thread: ThreadState): Extract<ChatItem, { kind: 'assistant' }> {
  const item = thread.items.find((entry) => entry.kind === 'assistant');
  if (item?.kind !== 'assistant') throw new Error('no assistant item');
  return item;
}

describe('foldEvent', () => {
  it('renders the prompt once, from the event alone', () => {
    const thread = fold(
      { type: 'user_message', text: 'do the thing' },
      { type: 'turn_started' },
      { type: 'assistant_delta', text: 'ok' },
    );

    expect(thread.items.filter((item) => item.kind === 'user')).toEqual([
      { kind: 'user', id: 'user-1', text: 'do the thing' },
    ]);
  });

  it('ignores a replayed prompt, so a reconnect does not duplicate it', () => {
    const once = fold({ type: 'user_message', text: 'hello' });
    const again = foldEvent(once, {
      type: 'user_message',
      text: 'hello',
      seq: 1,
      threadId: 't1',
      ts: 0,
    });

    expect(again).toBe(once);
    expect(again.items).toHaveLength(1);
  });

  it('accumulates thinking onto the assistant message it precedes', () => {
    const thread = fold(
      { type: 'turn_started' },
      { type: 'thinking_delta', text: 'first ' },
      { type: 'thinking_delta', text: 'second' },
      { type: 'thinking_finished' },
      { type: 'assistant_delta', text: 'answer' },
      { type: 'assistant_message', text: 'answer.' },
    );

    expect(thread.items.filter((item) => item.kind === 'assistant')).toHaveLength(1);
    expect(assistant(thread)).toMatchObject({
      thinking: 'first second',
      text: 'answer.',
      streaming: false,
    });
  });

  it('keeps the sub-agent tag on a nested tool call', () => {
    const thread = fold({
      type: 'tool_call_started',
      toolCallId: 'child',
      name: 'Read',
      input: {},
      parentToolCallId: 'task-1',
    });

    expect(thread.items[0]).toMatchObject({ kind: 'tool', parentToolCallId: 'task-1' });
  });
});
