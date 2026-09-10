import type { AuthStatusData } from '@agent-console/contracts';
import { create } from 'zustand';
import { RunnerClient } from '@/lib/runner-client';

export type AuthEnvironment = { id: string; url: string; token: string };

type AuthStore = {
  environment: AuthEnvironment | null;
  status: 'idle' | 'opening' | 'open' | 'error';
  error?: string;
  auth?: AuthStatusData;
  /** A login waiting for the code the user pastes back. */
  login?: { authUrl: string };
  /** Never rendered, so nothing subscribes to it; here so tests can stand it in. */
  client: RunnerClient | null;

  ensure(): Promise<void>;
  refresh(): Promise<void>;
  startLogin(): Promise<void>;
  submitCode(code: string): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
};

/** Claude is usable when the CLI is logged in, or when a stored API key stands in. */
export function isClaudeConnected(state: Pick<AuthStore, 'auth'>): boolean {
  const auth = state.auth;
  if (!auth) return false;
  return (auth.loggedIn && auth.authMethod !== 'none') || auth.apiKey;
}

/** One open per page load; a failed one is cleared so the next `ensure` retries. */
let opening: Promise<void> | undefined;

export const useAuthStore = create<AuthStore>((set, get) => ({
  environment: null,
  status: 'idle',
  client: null,

  // Assigned before the first await, so a double mount cannot open two environments.
  ensure: () => (opening ??= open()),

  // Status is advisory: a runner that cannot answer leaves the last one in place.
  refresh: async () => {
    const client = get().client;
    if (!client) return;
    try {
      const data = await client.request({ type: 'auth_status' });
      if ('loggedIn' in data) set({ auth: data });
    } catch {
      // Left to the next refresh.
    }
  },

  startLogin: async () => {
    const data = await requireClient(get()).request({ type: 'auth_login_start' });
    if (!('authUrl' in data)) throw new Error('The runner did not return an authorization URL');
    set({ login: { authUrl: data.authUrl } });
  },

  submitCode: async (code) => {
    await requireClient(get()).request({ type: 'auth_login_code', code });
    set({ login: undefined });
    await get().refresh();
  },

  // `auth_logout` is what kills the login the CLI is holding open on its stdin.
  cancelLogin: () => get().logout(),

  logout: async () => {
    await requireClient(get()).request({ type: 'auth_logout' });
    set({ login: undefined });
    await get().refresh();
  },

  setApiKey: async (key) => {
    await requireClient(get()).request({ type: 'auth_set_api_key', key });
    await get().refresh();
  },

  clearApiKey: async () => {
    await requireClient(get()).request({ type: 'auth_clear_api_key' });
    await get().refresh();
  },
}));

/** Opens the auth environment — a runner at the shared data root — and connects to it. */
async function open(): Promise<void> {
  const set = useAuthStore.setState;
  set({ status: 'opening', error: undefined });
  try {
    const environment = await createEnvironment();
    const client = new RunnerClient({
      url: environment.url,
      token: environment.token,
      // The auth environment never runs a turn, so there are no events to fold.
      onEvent: () => {},
      onStatus: (connection) => {
        set({ status: connection === 'open' ? 'open' : 'opening' });
        if (connection === 'open') void useAuthStore.getState().refresh();
      },
    });
    set({ environment, client });
    client.connect();
  } catch (error) {
    opening = undefined;
    set({ status: 'error', error: messageOf(error) });
  }
}

async function createEnvironment(): Promise<AuthEnvironment> {
  const response = await fetch('/api/environments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = (await response.json()) as AuthEnvironment | { error: string };
  if (!response.ok || !('id' in body)) {
    throw new Error('error' in body ? body.error : 'Could not open the settings environment');
  }
  return body;
}

function requireClient(state: AuthStore): RunnerClient {
  if (!state.client) throw new Error('Not connected to the settings runner yet');
  return state.client;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
