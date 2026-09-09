import type { Event } from '@agent-console/contracts';
import { create } from 'zustand';
import type { ConnectionStatus } from '@/lib/runner-client';
import { emptyThread, foldEvent, withUserMessage, type ThreadState } from './thread-state';

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
  selectThread(threadId: string): void;
  applyEvent(event: Event): void;
  addUserMessage(threadId: string, text: string): void;
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
    set({ environment: null, threadOrder: [], threadMeta: {}, threads: {}, activeThreadId: null }),

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

  selectThread: (threadId) => set({ activeThreadId: threadId }),

  applyEvent: (event) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [event.threadId]: foldEvent(state.threads[event.threadId] ?? emptyThread(), event),
      },
    })),

  addUserMessage: (threadId, text) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [threadId]: withUserMessage(state.threads[threadId] ?? emptyThread(), text),
      },
      threadMeta: titled(state.threadMeta, threadId, text),
    })),
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
  return { id: randomId(), title: 'New thread', createdAt: Date.now() };
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
