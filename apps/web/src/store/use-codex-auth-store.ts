import type { CodexAuthStatusData } from '@agent-console/contracts';
import { create } from 'zustand';
import type { RunnerClient } from '@/lib/runner-client';
import { useAuthStore } from '@/store/use-auth-store';

/** How often a login waiting for approval asks the runner whether it landed. */
const POLL_MS = 3000;

type CodexAuthStore = {
  status?: CodexAuthStatusData;
  error?: string;
  refresh(): Promise<void>;
  startLogin(): Promise<void>;
  cancel(): Promise<void>;
  logout(): Promise<void>;
  setApiKey(key: string): Promise<void>;
  /** Drops the pending-login poll; the page calls it on unmount. */
  stop(): void;
};

let pollTimer: ReturnType<typeof setTimeout> | undefined;

/** The CLI does the waiting; this only asks again while a login is still pending. */
function schedulePoll(status: CodexAuthStatusData): void {
  clearTimeout(pollTimer);
  pollTimer = status.pending
    ? setTimeout(() => void useCodexAuthStore.getState().refresh(), POLL_MS)
    : undefined;
}

export const useCodexAuthStore = create<CodexAuthStore>((set, get) => ({
  // Status is advisory: a runner that cannot answer leaves the last one in place.
  refresh: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;
    try {
      const data = await client.request({ type: 'codex_auth_status' });
      if (!('installed' in data)) return;
      set({ status: data, error: data.error });
      schedulePoll(data);
    } catch (cause) {
      set({ error: messageOf(cause) });
    }
  },

  // The code shows before the first status arrives, so nothing waits three seconds.
  startLogin: async () => {
    const data = await requireClient().request({ type: 'codex_login_start' });
    if (!('verificationUrl' in data)) throw new Error('The runner did not start a Codex login');
    const status: CodexAuthStatusData = {
      installed: true,
      loggedIn: false,
      authMethod: 'none',
      loginPending: true,
      pending: { userCode: data.userCode, verificationUrl: data.verificationUrl },
      version: get().status?.version,
    };
    set({ status, error: undefined });
    schedulePoll(status);
  },

  cancel: async () => {
    await requireClient().request({ type: 'codex_login_cancel' });
    await get().refresh();
  },

  logout: async () => {
    await requireClient().request({ type: 'codex_logout' });
    await get().refresh();
  },

  setApiKey: async (key) => {
    await requireClient().request({ type: 'codex_set_api_key', key });
    await get().refresh();
  },

  stop: () => {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  },
}));

function requireClient(): RunnerClient {
  const client = useAuthStore.getState().client;
  if (!client) throw new Error('Not connected to the settings runner yet');
  return client;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
