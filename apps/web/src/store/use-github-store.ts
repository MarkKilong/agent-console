import type { GithubStatusData } from '@agent-console/contracts';
import { create } from 'zustand';
import {
  captureCredentials,
  disconnectCredentials,
  githubStatusOf,
  type CredentialSummary,
} from '@/lib/credentials-api';
import { sessionCredentials } from '@/lib/deployment';
import type { RunnerClient } from '@/lib/runner-client';
import { ensureAuthRunner, pushToOpenProject, useAuthStore } from '@/store/use-auth-store';

/** How often a login waiting for approval asks the runner whether it landed. */
const POLL_MS = 3000;

type GithubStore = {
  status?: GithubStatusData;
  error?: string;
  seed(summary: CredentialSummary): void;
  refresh(): Promise<void>;
  startLogin(): Promise<void>;
  cancel(): Promise<void>;
  logout(): Promise<void>;
  /** Drops the pending-login poll; the page calls it on unmount. */
  stop(): void;
};

let pollTimer: ReturnType<typeof setTimeout> | undefined;

/** The runner does the waiting; this only asks again while a login is still pending. */
function schedulePoll(status: GithubStatusData): void {
  clearTimeout(pollTimer);
  pollTimer = status.pending
    ? setTimeout(() => void useGithubStore.getState().refresh(), POLL_MS)
    : undefined;
}

export const useGithubStore = create<GithubStore>((set, get) => ({
  seed: (summary) => {
    clearTimeout(pollTimer);
    set({ status: githubStatusOf(summary.github), error: undefined });
  },

  // Status is advisory: a runner that cannot answer leaves the last one in place.
  refresh: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;
    try {
      const data = await client.request({ type: 'github_status' });
      if (!('connected' in data)) return;
      set({ status: data, error: data.error });
      // A landed device login is the moment to lift it out of the sandbox.
      if (sessionCredentials && data.connected) return capture(data);
      schedulePoll(data);
    } catch (cause) {
      set({ error: messageOf(cause) });
    }
  },

  // The code shows before the first status arrives, so nothing waits three seconds.
  startLogin: async () => {
    await ensureAuthRunner();
    const data = await requireClient().request({ type: 'github_login_start' });
    // `verificationUri`, not `userCode`: the Codex login start answers with one of those too.
    if (!('verificationUri' in data)) throw new Error('The runner did not start a GitHub login');
    const status: GithubStatusData = {
      connected: false,
      pending: { userCode: data.userCode, verificationUri: data.verificationUri },
    };
    set({ status, error: undefined });
    schedulePoll(status);
  },

  cancel: async () => {
    await requireClient().request({ type: 'github_login_cancel' });
    await get().refresh();
  },

  // Sandbox mode has no machine token to delete: dropping the session's copy is the sign-out.
  logout: async () => {
    if (sessionCredentials) return get().seed(await disconnectCredentials('github'));
    await requireClient().request({ type: 'github_logout' });
    await get().refresh();
  },

  stop: () => {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  },
}));

/** Sandbox mode: the sandbox is about to go, so the sign-in it holds moves into the session. */
async function capture(status: GithubStatusData): Promise<void> {
  const environment = useAuthStore.getState().environment;
  if (!environment) return;
  useAuthStore.setState({ capturing: true });
  try {
    const summary = await captureCredentials(environment.id, 'github', {
      login: status.login,
      scopes: status.scopes,
    });
    useAuthStore.getState().reset();
    useAuthStore.getState().seed(summary);
    useGithubStore.getState().seed(summary);
    await pushToOpenProject();
  } finally {
    useAuthStore.setState({ capturing: false });
  }
}

function requireClient(): RunnerClient {
  const client = useAuthStore.getState().client;
  if (!client) throw new Error('Not connected to the settings runner yet');
  return client;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
