import type { DiffFile, Event } from '@agent-console/contracts';
import { parseUnifiedDiff } from '@/lib/parseUnifiedDiff';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      output: string | undefined;
      isError: boolean;
      done: boolean;
    }
  | { kind: 'summary'; id: string; turnIndex: number; files: number; added: number; removed: number }
  | { kind: 'error'; id: string; message: string; code: string | undefined };

export type PendingPermission = {
  requestId: string;
  toolName: string;
  input: unknown;
  description: string | undefined;
};

export type Turn = {
  index: number;
  startedAt: number;
  files: DiffFile[];
  added: number;
  removed: number;
};

export type ThreadState = {
  events: Event[];
  lastSeq: number;
  items: ChatItem[];
  permissions: PendingPermission[];
  turns: Turn[];
  turnActive: boolean;
};

export type ThreadStatus = 'idle' | 'working' | 'needs-permission';

export function emptyThread(): ThreadState {
  return { events: [], lastSeq: 0, items: [], permissions: [], turns: [], turnActive: false };
}

export function threadStatus(thread: ThreadState | undefined): ThreadStatus {
  if (!thread) return 'idle';
  if (thread.permissions.length > 0) return 'needs-permission';
  return thread.turnActive ? 'working' : 'idle';
}

export function withUserMessage(thread: ThreadState, text: string): ThreadState {
  return {
    ...thread,
    items: [...thread.items, { kind: 'user', id: `user-${thread.items.length}`, text }],
  };
}

/** Folds one event into the view state. Replaying an old seq is a no-op. */
export function foldEvent(thread: ThreadState, event: Event): ThreadState {
  if (event.seq <= thread.lastSeq) return thread;

  const next: ThreadState = {
    ...thread,
    events: [...thread.events, event],
    lastSeq: event.seq,
    items: [...thread.items],
  };

  switch (event.type) {
    case 'turn_started':
      next.turnActive = true;
      next.turns = [
        ...thread.turns,
        { index: thread.turns.length, startedAt: event.ts, files: [], added: 0, removed: 0 },
      ];
      break;

    case 'assistant_delta':
      appendDelta(next.items, event.text, event.seq);
      break;

    case 'assistant_message':
      finishAssistant(next.items, event.text, event.seq);
      break;

    case 'tool_call_started':
      next.items.push({
        kind: 'tool',
        id: event.toolCallId,
        name: event.name,
        input: event.input,
        output: undefined,
        isError: false,
        done: false,
      });
      break;

    case 'tool_call_finished':
      finishTool(next.items, event.toolCallId, event.output, event.isError);
      break;

    case 'permission_requested':
      next.permissions = [
        ...thread.permissions,
        {
          requestId: event.requestId,
          toolName: event.toolName,
          input: event.input,
          description: event.description,
        },
      ];
      break;

    case 'permission_resolved':
      next.permissions = thread.permissions.filter((p) => p.requestId !== event.requestId);
      break;

    case 'diff_ready':
      next.turns = attachDiff(thread.turns, event.files, event.ts);
      pushSummary(next.items, next.turns.at(-1), event.seq);
      break;

    case 'turn_finished':
      next.turnActive = false;
      closeStreaming(next.items);
      break;

    case 'error':
      next.items.push({
        kind: 'error',
        id: `error-${event.seq}`,
        message: event.message,
        code: event.code,
      });
      break;
  }

  return next;
}

function attachDiff(turns: Turn[], files: DiffFile[], ts: number): Turn[] {
  const totals = files.reduce(
    (sum, file) => {
      const { added, removed } = parseUnifiedDiff(file.patch);
      return { added: sum.added + added, removed: sum.removed + removed };
    },
    { added: 0, removed: 0 },
  );

  const last = turns.at(-1);
  const updated: Turn = last
    ? { ...last, files, ...totals }
    : { index: 0, startedAt: ts, files, ...totals };
  return last ? [...turns.slice(0, -1), updated] : [updated];
}

function pushSummary(items: ChatItem[], turn: Turn | undefined, seq: number): void {
  if (!turn || turn.files.length === 0) return;
  items.push({
    kind: 'summary',
    id: `summary-${seq}`,
    turnIndex: turn.index,
    files: turn.files.length,
    added: turn.added,
    removed: turn.removed,
  });
}

function openAssistantIndex(items: ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === 'assistant' && item.streaming) return i;
  }
  return -1;
}

function appendDelta(items: ChatItem[], text: string, seq: number): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') {
    items[index] = { ...open, text: open.text + text };
    return;
  }
  items.push({ kind: 'assistant', id: `assistant-${seq}`, text, streaming: true });
}

/** The final text supersedes the deltas that streamed the same block. */
function finishAssistant(items: ChatItem[], text: string, seq: number): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') {
    items[index] = { ...open, text, streaming: false };
    return;
  }
  items.push({ kind: 'assistant', id: `assistant-${seq}`, text, streaming: false });
}

function closeStreaming(items: ChatItem[]): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') items[index] = { ...open, streaming: false };
}

function finishTool(
  items: ChatItem[],
  toolCallId: string,
  output: string | undefined,
  isError: boolean,
): void {
  const index = items.findIndex((item) => item.kind === 'tool' && item.id === toolCallId);
  const tool = index >= 0 ? items[index] : undefined;
  if (tool?.kind === 'tool') items[index] = { ...tool, output, isError, done: true };
}
