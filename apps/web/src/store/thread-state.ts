import type { Commit, DiffFile, Event, Usage } from '@agent-console/contracts';
import { parseUnifiedDiff } from '@/lib/parse-unified-diff';

/** `ts` is the timestamp of the event that created the item, for timestamps and elapsed times. */
export type ChatItem =
  | { kind: 'user'; id: string; ts: number; text: string }
  | {
      kind: 'assistant';
      id: string;
      ts: number;
      text: string;
      streaming: boolean;
      thinking?: string;
    }
  | {
      kind: 'tool';
      id: string;
      ts: number;
      name: string;
      input: unknown;
      output: string | undefined;
      isError: boolean;
      done: boolean;
      finishedAt?: number;
      outputTruncated?: boolean;
      parentToolCallId: string | undefined;
    }
  | {
      kind: 'summary';
      id: string;
      ts: number;
      turnIndex: number;
      files: number;
      added: number;
      removed: number;
      commits: Commit[];
      commitsTotal: number;
    }
  | { kind: 'error'; id: string; ts: number; message: string; code: string | undefined };

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
  commits: Commit[];
  /** Commits before the runner's cap; more than `commits.length` means the list was cut. */
  commitsTotal: number;
  finishedAt?: number;
  stopReason?: string;
  usage?: Usage;
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
    case 'user_message':
      next.items.push({ kind: 'user', id: `user-${event.seq}`, ts: event.ts, text: event.text });
      break;

    case 'turn_started':
      next.turnActive = true;
      next.turns = [
        ...thread.turns,
        {
          index: thread.turns.length,
          startedAt: event.ts,
          files: [],
          added: 0,
          removed: 0,
          commits: [],
          commitsTotal: 0,
        },
      ];
      break;

    case 'thinking_delta':
      appendThinking(next.items, event.text, event.seq, event.ts);
      break;

    case 'assistant_delta':
      appendDelta(next.items, event.text, event.seq, event.ts);
      break;

    case 'assistant_message':
      finishAssistant(next.items, event.text, event.seq, event.ts);
      break;

    case 'tool_call_started':
      next.items.push({
        kind: 'tool',
        id: event.toolCallId,
        ts: event.ts,
        name: event.name,
        input: event.input,
        output: undefined,
        isError: false,
        done: false,
        parentToolCallId: event.parentToolCallId,
      });
      break;

    case 'tool_call_finished':
      finishTool(next.items, event);
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
      next.turns = attachDiff(
        thread.turns,
        event.files,
        event.commits ?? [],
        event.commitsTotal ?? event.commits?.length ?? 0,
        event.ts,
      );
      pushSummary(next.items, next.turns.at(-1), event.seq, event.ts);
      break;

    case 'turn_finished': {
      next.turnActive = false;
      closeStreaming(next.items);
      const last = thread.turns.at(-1);
      if (last) {
        next.turns = [
          ...thread.turns.slice(0, -1),
          { ...last, finishedAt: event.ts, stopReason: event.stopReason, usage: event.usage },
        ];
      }
      break;
    }

    // Nothing to render inline: the console store takes the new name off it.
    case 'thread_titled':
      break;

    case 'error':
      next.items.push({
        kind: 'error',
        id: `error-${event.seq}`,
        ts: event.ts,
        message: event.message,
        code: event.code,
      });
      break;
  }

  return next;
}

function attachDiff(
  turns: Turn[],
  files: DiffFile[],
  commits: Commit[],
  commitsTotal: number,
  ts: number,
): Turn[] {
  const totals = files.reduce(
    (sum, file) => {
      const { added, removed } = parseUnifiedDiff(file.patch);
      return { added: sum.added + added, removed: sum.removed + removed };
    },
    { added: 0, removed: 0 },
  );

  const last = turns.at(-1);
  const updated: Turn = last
    ? { ...last, files, commits, commitsTotal, ...totals }
    : { index: 0, startedAt: ts, files, commits, commitsTotal, ...totals };
  return last ? [...turns.slice(0, -1), updated] : [updated];
}

/** A turn that touched no file but committed still did something worth a row. */
function pushSummary(items: ChatItem[], turn: Turn | undefined, seq: number, ts: number): void {
  if (!turn || (turn.files.length === 0 && turn.commits.length === 0)) return;
  items.push({
    kind: 'summary',
    id: `summary-${seq}`,
    ts,
    turnIndex: turn.index,
    files: turn.files.length,
    added: turn.added,
    removed: turn.removed,
    commits: turn.commits,
    commitsTotal: turn.commitsTotal,
  });
}

/**
 * Only the newest item can still be streaming. Text that arrives after a tool call
 * belongs to a new message, so an earlier open item (typically one that only holds
 * thinking) is closed instead of being appended to.
 */
function openAssistantIndex(items: ChatItem[]): number {
  const last = items.at(-1);
  if (last?.kind === 'assistant' && last.streaming) return items.length - 1;
  closeStreaming(items);
  return -1;
}

function appendDelta(items: ChatItem[], text: string, seq: number, ts: number): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') {
    items[index] = { ...open, text: open.text + text };
    return;
  }
  items.push({ kind: 'assistant', id: `assistant-${seq}`, ts, text, streaming: true });
}

/** Reasoning belongs to the answer it precedes, so it folds onto the same item. */
function appendThinking(items: ChatItem[], text: string, seq: number, ts: number): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') {
    items[index] = { ...open, thinking: (open.thinking ?? '') + text };
    return;
  }
  items.push({
    kind: 'assistant',
    id: `assistant-${seq}`,
    ts,
    text: '',
    streaming: true,
    thinking: text,
  });
}

/** The final text supersedes the deltas that streamed the same block. */
function finishAssistant(items: ChatItem[], text: string, seq: number, ts: number): void {
  const index = openAssistantIndex(items);
  const open = index >= 0 ? items[index] : undefined;
  if (open?.kind === 'assistant') {
    items[index] = { ...open, text, streaming: false };
    return;
  }
  items.push({ kind: 'assistant', id: `assistant-${seq}`, ts, text, streaming: false });
}

function closeStreaming(items: ChatItem[]): void {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === 'assistant' && item.streaming) items[i] = { ...item, streaming: false };
  }
}

function finishTool(
  items: ChatItem[],
  event: Extract<Event, { type: 'tool_call_finished' }>,
): void {
  const index = items.findIndex((item) => item.kind === 'tool' && item.id === event.toolCallId);
  const tool = index >= 0 ? items[index] : undefined;
  if (tool?.kind !== 'tool') return;
  items[index] = {
    ...tool,
    output: event.output,
    isError: event.isError,
    done: true,
    finishedAt: event.ts,
    outputTruncated: event.outputTruncated,
  };
}
