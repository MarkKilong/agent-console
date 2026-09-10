import type { Event, EventBody } from '@agent-console/contracts';
import { describe, expect, it } from 'vitest';
import {
  countTools,
  groupTurns,
  nestTools,
  type WorkRow,
} from '../../apps/web/src/lib/turn-groups.js';
import { emptyThread, foldEvent } from '../../apps/web/src/store/thread-state.js';
import type { ChatItem, ThreadState } from '../../apps/web/src/store/thread-state.js';

function fold(...bodies: EventBody[]): ThreadState {
  return bodies.reduce<ThreadState>(
    (thread, body, index) =>
      foldEvent(thread, { ...body, seq: index + 1, threadId: 't1', ts: index } as Event),
    emptyThread(),
  );
}

function groupsOf(thread: ThreadState) {
  return groupTurns(thread.items, thread.turns);
}

function tool(toolCallId: string, parentToolCallId?: string): ChatItem {
  return {
    kind: 'tool',
    id: toolCallId,
    ts: 0,
    name: 'Read',
    input: {},
    output: undefined,
    isError: false,
    done: true,
    parentToolCallId,
  };
}

describe('groupTurns', () => {
  it('takes the last assistant message as the answer and leaves the tools as work', () => {
    const thread = fold(
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      { type: 'tool_call_started', toolCallId: 'a', name: 'Read', input: {} },
      { type: 'tool_call_finished', toolCallId: 'a', output: 'ok', isError: false },
      { type: 'assistant_message', text: 'done' },
      { type: 'turn_finished', stopReason: 'end_turn' },
    );

    const [group] = groupsOf(thread);
    expect(group?.prompt?.text).toBe('go');
    expect(group?.answer?.text).toBe('done');
    expect(group?.work.map((item) => item.kind)).toEqual(['tool']);
    expect(group?.turn?.index).toBe(0);
  });

  it('keeps an assistant message inside the work when a tool ran after it', () => {
    const thread = fold(
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      { type: 'assistant_message', text: 'let me look' },
      { type: 'tool_call_started', toolCallId: 'a', name: 'Read', input: {} },
      { type: 'tool_call_finished', toolCallId: 'a', output: 'ok', isError: false },
      { type: 'turn_finished', stopReason: 'end_turn' },
    );

    const [group] = groupsOf(thread);
    expect(group?.answer).toBeUndefined();
    expect(group?.work.map((item) => item.kind)).toEqual(['assistant', 'tool']);
  });

  it('answers with no work when the turn called no tools', () => {
    const thread = fold(
      { type: 'user_message', text: 'hi' },
      { type: 'turn_started' },
      { type: 'assistant_message', text: 'hello' },
      { type: 'turn_finished', stopReason: 'end_turn' },
    );

    const [group] = groupsOf(thread);
    expect(group?.work).toEqual([]);
    expect(group?.answer?.text).toBe('hello');
  });

  it('treats a streaming message as the answer so it renders while it arrives', () => {
    const thread = fold(
      { type: 'user_message', text: 'hi' },
      { type: 'turn_started' },
      { type: 'assistant_delta', text: 'hel' },
    );

    const [group] = groupsOf(thread);
    expect(group?.answer).toMatchObject({ text: 'hel', streaming: true });
    expect(group?.turn?.finishedAt).toBeUndefined();
  });

  it('collects the diff summary and errors beside the work', () => {
    const thread = fold(
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      { type: 'error', message: 'boom', code: 'nope' },
      { type: 'diff_ready', files: [{ path: 'a.ts', status: 'modified', patch: '' }] },
      { type: 'turn_finished', stopReason: 'error' },
    );

    const [group] = groupsOf(thread);
    expect(group?.errors.map((error) => error.message)).toEqual(['boom']);
    expect(group?.summary?.files).toBe(1);
    expect(group?.work).toEqual([]);
  });

  it('puts items logged before the first turn in a group of their own', () => {
    const thread = fold(
      { type: 'assistant_message', text: 'legacy' },
      { type: 'user_message', text: 'go' },
      { type: 'turn_started' },
      { type: 'assistant_message', text: 'new' },
    );

    const groups = groupsOf(thread);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.turn).toBeUndefined();
    expect(groups[0]?.prompt).toBeUndefined();
    expect(groups[0]?.answer?.text).toBe('legacy');
    expect(groups[1]?.turn?.index).toBe(0);
    expect(groups[1]?.answer?.text).toBe('new');
  });
});

describe('nestTools', () => {
  it('hangs a sub-agent call under the parent that spawned it', () => {
    const rows = nestTools([tool('task'), tool('child', 'task'), tool('after')]);

    expect(rows).toHaveLength(2);
    expect(ids(rows)).toEqual(['task', 'after']);
    expect(rows[0]?.kind === 'tool' && rows[0].node.children.map((n) => n.item.id)).toEqual([
      'child',
    ]);
    expect(countTools(rows)).toBe(3);
  });

  it('keeps a child whose parent is not in this turn at the top level', () => {
    const rows = nestTools([tool('child', 'elsewhere')]);

    expect(ids(rows)).toEqual(['child']);
    expect(countTools(rows)).toBe(1);
  });

  it('keeps non-tool items in order among the rows', () => {
    const assistant: ChatItem = {
      kind: 'assistant',
      id: 'a1',
      ts: 0,
      text: 'thinking out loud',
      streaming: false,
    };
    const rows = nestTools([tool('one'), assistant, tool('two')]);

    expect(rows.map((row) => (row.kind === 'tool' ? row.node.item.id : row.item.id))).toEqual([
      'one',
      'a1',
      'two',
    ]);
    expect(countTools(rows)).toBe(2);
  });
});

function ids(rows: WorkRow[]): string[] {
  return rows.flatMap((row) => (row.kind === 'tool' ? [row.node.item.id] : []));
}
