import type { Event, EventBody, PermissionDecision } from '@agent-console/contracts';

export type EventListener = (event: Event) => void;

/** The turn currently running on a thread, as far as the transport layer cares. */
export interface ActiveTurn {
  answerPermission(requestId: string, decision: PermissionDecision, message?: string): boolean;
  stop(): void;
}

type ThreadState = {
  events: Event[];
  listeners: Set<EventListener>;
  sessionId?: string;
  turn?: ActiveTurn;
  baseTree?: string;
};

/** In-memory event log per thread. One active turn at a time. */
export class ThreadRegistry {
  private readonly threads = new Map<string, ThreadState>();

  append(threadId: string, body: EventBody): Event {
    const thread = this.thread(threadId);
    const event = { ...body, seq: thread.events.length + 1, threadId, ts: Date.now() } as Event;
    thread.events.push(event);
    for (const listener of thread.listeners) {
      listener(event);
    }
    return event;
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

  sessionId(threadId: string): string | undefined {
    return this.thread(threadId).sessionId;
  }

  setSessionId(threadId: string, sessionId: string): void {
    this.thread(threadId).sessionId = sessionId;
  }

  /** Tree snapshot taken when the thread's latest turn started; the anchor for its diff. */
  baseTree(threadId: string): string | undefined {
    return this.thread(threadId).baseTree;
  }

  setBaseTree(threadId: string, tree: string | undefined): void {
    this.thread(threadId).baseTree = tree;
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
      thread = { events: [], listeners: new Set() };
      this.threads.set(threadId, thread);
    }
    return thread;
  }
}
