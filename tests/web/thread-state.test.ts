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
  it('gives a turn that only committed a summary row, so the commit is visible', () => {
    const commit = { repo: '', sha: 'dc0c832abcdef', subject: 'Add version route', made: true };
    const thread = fold(
      { type: 'user_message', text: 'commit this' },
      { type: 'turn_started', branch: 'main' },
      { type: 'turn_finished', stopReason: 'end_turn' },
      { type: 'diff_ready', files: [], commits: [commit] },
    );

    expect(thread.turns[0]?.commits).toEqual([commit]);
    expect(thread.items.at(-1)).toMatchObject({ kind: 'summary', files: 0, commits: [commit] });
  });

  it('carries the total past the cap, so the row can say how many were left out', () => {
    const commits = Array.from({ length: 20 }, (_, i) => ({
      repo: '',
      sha: `sha${i}`,
      subject: `Pulled ${i}`,
      made: false,
    }));
    const thread = fold(
      { type: 'turn_started' },
      { type: 'diff_ready', files: [], commits, commitsTotal: 25 },
    );

    expect(thread.turns[0]?.commitsTotal).toBe(25);
    expect(thread.items.at(-1)).toMatchObject({ kind: 'summary', commitsTotal: 25 });
  });

  it('skips the summary row when a turn neither changed a file nor committed', () => {
    const thread = fold(
      { type: 'user_message', text: 'just talk' },
      { type: 'turn_started' },
      { type: 'turn_finished', stopReason: 'end_turn' },
      { type: 'diff_ready', files: [] },
    );
    expect(thread.items.some((item) => item.kind === 'summary')).toBe(false);
  });

  it('renders the prompt once, from the event alone', () => {
    const thread = fold(
      { type: 'user_message', text: 'do the thing' },
      { type: 'turn_started' },
      { type: 'assistant_delta', text: 'ok' },
    );

    expect(thread.items.filter((item) => item.kind === 'user')).toEqual([
      { kind: 'user', id: 'user-1', ts: 0, text: 'do the thing' },
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

  it('starts a new assistant message for text that arrives after a tool call', () => {
    const thread = fold(
      { type: 'turn_started' },
      { type: 'thinking_delta', text: 'plan' },
      { type: 'thinking_finished' },
      { type: 'tool_call_started', toolCallId: 'c1', name: 'Read', input: {} },
      { type: 'tool_call_finished', toolCallId: 'c1', isError: false },
      { type: 'assistant_delta', text: 'done' },
      { type: 'assistant_message', text: 'done.' },
    );

    const kinds = thread.items.map((item) => item.kind);
    expect(kinds).toEqual(['assistant', 'tool', 'assistant']);
    expect(thread.items[0]).toMatchObject({ thinking: 'plan', text: '', streaming: false });
    expect(thread.items[2]).toMatchObject({ text: 'done.', streaming: false });
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

  it('stamps every item with the timestamp of the event that made it', () => {
    const thread = fold(
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      { type: 'assistant_delta', text: 'ok' },
      { type: 'error', message: 'boom' },
    );

    expect(thread.items.map((item) => item.ts)).toEqual([0, 2, 3]);
  });

  it('times a tool call and records that its output was cut short', () => {
    const thread = fold(
      { type: 'tool_call_started', toolCallId: 'a', name: 'Bash', input: {} },
      {
        type: 'tool_call_finished',
        toolCallId: 'a',
        output: 'huge',
        isError: false,
        outputTruncated: true,
      },
    );

    expect(thread.items[0]).toMatchObject({
      kind: 'tool',
      ts: 0,
      finishedAt: 1,
      done: true,
      outputTruncated: true,
    });
  });

  it('closes the turn with how it ended and what it cost', () => {
    const thread = fold(
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      {
        type: 'turn_finished',
        stopReason: 'stopped',
        usage: { inputTokens: 120, outputTokens: 8, costUsd: 0.04 },
      },
    );

    expect(thread.turnActive).toBe(false);
    expect(thread.turns[0]).toMatchObject({
      startedAt: 1,
      finishedAt: 2,
      stopReason: 'stopped',
      usage: { inputTokens: 120, outputTokens: 8, costUsd: 0.04 },
    });
  });
});
