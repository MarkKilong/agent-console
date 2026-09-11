import type { Event, EventBody, PermissionDecision, ThreadSummary } from '@agent-console/contracts';
import type { AgentKind } from './config.js';
import type { Snapshot } from './git/workspace.js';
import { MemoryThreadStore, type ThreadMeta, type ThreadStore } from './thread-store.js';
import { capTitle, titleFromPrompt } from './title.js';

export type EventListener = (event: Event) => void;

/** The turn currently running on a thread, as far as the transport layer cares. */
export interface ActiveTurn {
  answerPermission(requestId: string, decision: PermissionDecision, message?: string): boolean;
  stop(): void;
}

type ThreadState = {
  events: Event[];
  listeners: Set<EventListener>;
  meta: ThreadMeta;
  turn?: ActiveTurn;
  baseSnapshot?: Snapshot;
};

/** Event log per thread, mirrored to a store. One active turn at a time. */
export class ThreadRegistry {
  private readonly threads = new Map<string, ThreadState>();

  constructor(
    private readonly store: ThreadStore = new MemoryThreadStore(),
    private readonly agent: AgentKind = 'claude',
  ) {
    for (const stored of store.load()) {
      this.threads.set(stored.id, {
        events: stored.events,
        listeners: new Set(),
        meta: stored.meta,
      });
    }
  }

  append(threadId: string, body: EventBody): Event {
    const thread = this.thread(threadId);
    const event = { ...body, seq: thread.events.length + 1, threadId, ts: Date.now() } as Event;
    thread.events.push(event);
    thread.meta.updatedAt = event.ts;
    this.store.appendEvent(threadId, event);
    for (const listener of thread.listeners) {
      listener(event);
    }
    return event;
  }

  /** Threads with something in them, newest activity first. */
  list(): ThreadSummary[] {
    return [...this.threads]
      .filter(([, thread]) => thread.events.length > 0)
      .map(([id, thread]) => ({
        id,
        title: thread.meta.title,
        agent: thread.meta.agent,
        ...(thread.meta.branch ? { branch: thread.meta.branch } : {}),
        updatedAt: thread.meta.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The first prompt names the thread, until a model says otherwise. */
  notePrompt(threadId: string, prompt: string): void {
    const thread = this.thread(threadId);
    if (thread.meta.title) return;
    thread.meta.title = titleFromPrompt(prompt);
    thread.meta.titleSource = 'prompt';
    this.store.writeMeta(threadId, thread.meta);
  }

  titleSource(threadId: string): ThreadMeta['titleSource'] {
    return this.thread(threadId).meta.titleSource;
  }

  /** Renames the thread and tells open clients. A model's title outranks a prompt's. */
  setTitle(threadId: string, title: string, source: 'prompt' | 'model'): void {
    const thread = this.thread(threadId);
    if (source !== 'model' && thread.meta.titleSource === 'model') return;
    const capped = capTitle(title);
    if (!capped) return;
    thread.meta.title = capped;
    thread.meta.titleSource = source;
    this.store.writeMeta(threadId, thread.meta);
    this.append(threadId, { type: 'thread_titled', title: capped });
  }

  eventsAfter(threadId: string, afterSeq = 0): Event[] {
    return this.thread(threadId).events.filter((event) => event.seq > afterSeq);
  }

  /** Replays everything after `afterSeq`, then live-tails. */
  subscribe(threadId: string, afterSeq: number, listener: EventListener): () => void {
    const thread = this.thread(threadId);
    for (const event of thread.events) {
      if (event.seq > afterSeq) listener(event);
    }
    thread.listeners.add(listener);
    return () => {
      thread.listeners.delete(listener);
    };
  }

  activeTurn(threadId: string): ActiveTurn | undefined {
    return this.thread(threadId).turn;
  }

  setActiveTurn(threadId: string, turn: ActiveTurn | undefined): void {
    this.thread(threadId).turn = turn;
  }

  /** The workspace branch the thread's latest turn started on. */
  setBranch(threadId: string, branch: string): void {
    const thread = this.thread(threadId);
    if (thread.meta.branch === branch) return;
    thread.meta.branch = branch;
    this.store.writeMeta(threadId, thread.meta);
  }

  sessionId(threadId: string): string | undefined {
    return this.thread(threadId).meta.sessionId;
  }

  setSessionId(threadId: string, sessionId: string): void {
    const thread = this.thread(threadId);
    thread.meta.sessionId = sessionId;
    this.store.writeMeta(threadId, thread.meta);
  }

  /**
   * Snapshot taken when the thread's latest turn started; the anchor for its diff.
   * Deliberately not persisted: a git object id only means something within one run.
   */
  baseSnapshot(threadId: string): Snapshot | undefined {
    return this.thread(threadId).baseSnapshot;
  }

  setBaseSnapshot(threadId: string, snapshot: Snapshot | undefined): void {
    this.thread(threadId).baseSnapshot = snapshot;
  }

  /** Aborts every running turn, so no agent subprocess outlives the runner. */
  stopActiveTurns(): void {
    for (const thread of this.threads.values()) {
      thread.turn?.stop();
    }
  }

  private thread(threadId: string): ThreadState {
    let thread = this.threads.get(threadId);
    if (!thread) {
      const now = Date.now();
      thread = {
        events: [],
        listeners: new Set(),
        meta: { title: '', agent: this.agent, createdAt: now, updatedAt: now },
      };
      this.threads.set(threadId, thread);
    }
    return thread;
  }
}
