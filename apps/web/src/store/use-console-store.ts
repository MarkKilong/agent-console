import type { AuthLoginMode, AuthStatusData, Event, ThreadSummary } from '@agent-console/contracts';
import { create } from 'zustand';
import type { ConnectionStatus, RunnerClient } from '@/lib/runner-client';
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

/** Claude's login inside the open environment, plus a login waiting for its code. */
export type AuthState = {
  status?: AuthStatusData;
  login?: { mode: AuthLoginMode; authUrl: string };
};

type ConsoleStore = {
  environment: EnvironmentInfo | null;
  auth: AuthState;
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

  refreshAuth(client: RunnerClient): Promise<void>;
  startLogin(client: RunnerClient, mode: AuthLoginMode): Promise<void>;
  submitCode(client: RunnerClient, code: string): Promise<void>;
  logout(client: RunnerClient): Promise<void>;
  setApiKey(client: RunnerClient, key: string): Promise<void>;
  clearApiKey(client: RunnerClient): Promise<void>;
};

export const useConsoleStore = create<ConsoleStore>((set, get) => ({
  environment: null,
  auth: {},
  threadOrder: [],
  threadMeta: {},
  threads: {},
  activeThreadId: null,

  openEnvironment: (environment) =>
    set({ environment: { ...environment, status: 'idle' }, auth: {}, ...freshThread() }),

  closeEnvironment: () =>
    set({
      environment: null,
      auth: {},
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
      threadMeta:
        event.type === 'turn_started' && event.branch
          ? branched(state.threadMeta, event.threadId, event.branch)
          : state.threadMeta,
    })),

  // The prompt itself renders from the runner's `user_message` event, not from here.
  notePrompt: (threadId, text) =>
    set((state) => ({ threadMeta: titled(state.threadMeta, threadId, text) })),

  // Status is advisory: a runner that cannot answer just leaves the card as it was.
  refreshAuth: async (client) => {
    try {
      const data = await client.request({ type: 'auth_status' });
      if ('loggedIn' in data) set((state) => ({ auth: { ...state.auth, status: data } }));
    } catch {
      // Left to the next refresh.
    }
  },

  startLogin: async (client, mode) => {
    const data = await client.request({ type: 'auth_login_start', mode });
    if (!('authUrl' in data)) throw new Error('The runner did not return an authorization URL');
    set((state) => ({ auth: { ...state.auth, login: { mode, authUrl: data.authUrl } } }));
  },

  submitCode: async (client, code) => {
    await client.request({ type: 'auth_login_code', code });
    set((state) => ({ auth: { ...state.auth, login: undefined } }));
    await get().refreshAuth(client);
  },

  logout: async (client) => {
    await client.request({ type: 'auth_logout' });
    set({ auth: {} });
    await get().refreshAuth(client);
  },

  setApiKey: async (client, key) => {
    await client.request({ type: 'auth_set_api_key', key });
    await get().refreshAuth(client);
  },

  clearApiKey: async (client) => {
    await client.request({ type: 'auth_clear_api_key' });
    await get().refreshAuth(client);
  },
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
