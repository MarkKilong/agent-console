import type { Event, ThreadSummary } from '@agent-console/contracts';
import { create } from 'zustand';
import type { ConnectionStatus } from '@/lib/runner-client';
// Aliased rather than relative so the tests' NodeNext resolution finds it too.
import { emptyThread, foldEvent, type ThreadState } from '@/store/thread-state';

export type EnvironmentInfo = {
  id: string;
  url: string;
  token: string;
  repoPath: string;
  status: ConnectionStatus | 'idle';
};

export type ThreadMeta = {
  id: string;
  title: string;
  agent: string;
  /** The workspace branch of the thread's latest turn, once one has started. */
  branch?: string;
  createdAt: number;
};

type ConsoleStore = {
  environment: EnvironmentInfo | null;
  /** Newest thread first. */
  threadOrder: string[];
  threadMeta: Record<string, ThreadMeta>;
  threads: Record<string, ThreadState>;
  activeThreadId: string | null;

  openEnvironment(environment: Omit<EnvironmentInfo, 'status'>): void;
  closeEnvironment(): void;
  setStatus(status: ConnectionStatus): void;
  newThread(): void;
  hydrateThreads(threads: ThreadSummary[]): void;
  selectThread(threadId: string): void;
  applyEvent(event: Event): void;
  notePrompt(threadId: string, text: string): void;
};

export const useConsoleStore = create<ConsoleStore>((set) => ({
  environment: null,
  threadOrder: [],
  threadMeta: {},
  threads: {},
  activeThreadId: null,

  openEnvironment: (environment) =>
    set({ environment: { ...environment, status: 'idle' }, ...freshThread() }),

  closeEnvironment: () =>
    set({
      environment: null,
      threadOrder: [],
      threadMeta: {},
      threads: {},
      activeThreadId: null,
    }),

  setStatus: (status) =>
    set((state) => ({
      environment: state.environment ? { ...state.environment, status } : null,
    })),

  newThread: () =>
    set((state) => {
      const meta = createMeta();
      return {
        threadOrder: [meta.id, ...state.threadOrder],
        threadMeta: { ...state.threadMeta, [meta.id]: meta },
        activeThreadId: meta.id,
      };
    }),

  // The runner's threads all predate this session's, so they go after them.
  hydrateThreads: (threads) =>
    set((state) => {
      const restored = threads.filter((thread) => !state.threadMeta[thread.id]);
      const metas = restored.map((thread) => ({
        id: thread.id,
        title: thread.title || 'New thread',
        agent: thread.agent,
        branch: thread.branch,
        // The list is ordered by last activity, so that is what the row should show.
        createdAt: thread.updatedAt,
      }));
      return {
        threadOrder: [...state.threadOrder, ...metas.map((meta) => meta.id)],
        threadMeta: {
          ...state.threadMeta,
          ...Object.fromEntries(metas.map((meta) => [meta.id, meta])),
        },
      };
    }),

  selectThread: (threadId) => set({ activeThreadId: threadId }),

  applyEvent: (event) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [event.threadId]: foldEvent(state.threads[event.threadId] ?? emptyThread(), event),
      },
      threadMeta: metaAfter(state.threadMeta, event),
    })),

  // The prompt itself renders from the runner's `user_message` event, not from here.
  notePrompt: (threadId, text) =>
    set((state) => ({ threadMeta: titled(state.threadMeta, threadId, text) })),
}));

export function useThread(threadId: string | null): ThreadState {
  const thread = useConsoleStore((state) => (threadId ? state.threads[threadId] : undefined));
  return thread ?? EMPTY_THREAD;
}

const EMPTY_THREAD = emptyThread();

function freshThread() {
  const meta = createMeta();
  return {
    threadOrder: [meta.id],
    threadMeta: { [meta.id]: meta },
    threads: {},
    activeThreadId: meta.id,
  };
}

function createMeta(): ThreadMeta {
  return { id: randomId(), title: 'New thread', agent: 'claude', createdAt: Date.now() };
}

/** The two events that change a thread's card in the sidebar: its branch and its name. */
function metaAfter(metas: Record<string, ThreadMeta>, event: Event): Record<string, ThreadMeta> {
  if (event.type === 'turn_started' && event.branch) {
    return branched(metas, event.threadId, event.branch);
  }
  // The runner titled the thread, from a model or otherwise; its name wins over ours.
  if (event.type === 'thread_titled') {
    const meta = metas[event.threadId];
    return meta ? { ...metas, [event.threadId]: { ...meta, title: event.title } } : metas;
  }
  return metas;
}

/** The runner reports the branch on every turn, so a checkout mid-thread shows up. */
function branched(
  metas: Record<string, ThreadMeta>,
  threadId: string,
  branch: string,
): Record<string, ThreadMeta> {
  const meta = metas[threadId];
  if (!meta || meta.branch === branch) return metas;
  return { ...metas, [threadId]: { ...meta, branch } };
}

/** The first prompt names the thread. */
function titled(
  metas: Record<string, ThreadMeta>,
  threadId: string,
  text: string,
): Record<string, ThreadMeta> {
  const meta = metas[threadId];
  if (!meta || meta.title !== 'New thread') return metas;
  return { ...metas, [threadId]: { ...meta, title: text } };
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `thread-${Math.random().toString(36).slice(2)}`;
}
