import type { AuthStatusData, ModelInfo } from '@agent-console/contracts';
import { create } from 'zustand';
import {
  captureCredentials,
  claudeStatusOf,
  disconnectCredentials,
  type CredentialSummary,
} from '@/lib/credentials-api';
import { sessionCredentials } from '@/lib/deployment';
import { RunnerClient } from '@/lib/runner-client';

export type AuthEnvironment = { id: string; url: string; token: string };

type AuthStore = {
  environment: AuthEnvironment | null;
  status: 'idle' | 'opening' | 'open' | 'error';
  error?: string;
  auth?: AuthStatusData;
  /** A login waiting for the code the user pastes back. */
  login?: { authUrl: string };
  /** What the CLI reports it can run; empty until it has answered once. */
  models: ModelInfo[];
  /** Whether listing has been tried, so an empty list can be told from a pending one. */
  modelsLoaded: boolean;
  /** Never rendered, so nothing subscribes to it; here so tests can stand it in. */
  client: RunnerClient | null;
  /** A sign-in being lifted into the session: closing the environment now would lose it. */
  capturing: boolean;

  ensure(): Promise<void>;
  connect(): Promise<void>;
  reset(): void;
  seed(summary: CredentialSummary): void;
  refresh(): Promise<void>;
  loadModels(): Promise<void>;
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

/** Sandbox mode keeps no runner between sign-ins, so a card opens one when it needs one. */
export async function ensureAuthRunner(): Promise<void> {
  if (sessionCredentials) await useAuthStore.getState().connect();
}

/** One open per page load; a failed one is cleared so the next `ensure` retries. */
let opening: Promise<void> | undefined;

export const useAuthStore = create<AuthStore>((set, get) => ({
  environment: null,
  status: 'idle',
  models: [],
  modelsLoaded: false,
  client: null,
  capturing: false,

  // Assigned before the first await, so a double mount cannot open two environments.
  ensure: () => (opening ??= open()),

  // A sign-in needs the socket, not just the environment record.
  connect: async () => {
    await get().ensure();
    if (get().status === 'open') return;
    // `open` reports a failed create by setting the status, so a subscriber would never hear it.
    if (get().status === 'error') {
      throw new Error(get().error ?? 'The settings runner could not start');
    }
    await new Promise<void>((resolve, reject) => {
      const stop = useAuthStore.subscribe((state) => {
        if (state.status === 'open') {
          stop();
          resolve();
        } else if (state.status === 'error') {
          stop();
          reject(new Error(state.error ?? 'The settings runner could not start'));
        }
      });
    });
  },

  // Forgets the runner without destroying it: the caller has already deleted the sandbox.
  reset: () => {
    opening = undefined;
    get().client?.dispose();
    set({ environment: null, client: null, status: 'idle', error: undefined, login: undefined });
  },

  seed: (summary) => set({ auth: claudeStatusOf(summary.claude) }),

  // Status is advisory: a runner that cannot answer leaves the last one in place.
  refresh: async () => {
    const client = get().client;
    if (!client) return;
    try {
      const data = await client.request({ type: 'auth_status' });
      // `apiKey`, not `loggedIn`: the Codex status answers with one of those too.
      if ('apiKey' in data) set({ auth: data });
    } catch {
      // Left to the next refresh.
    }
  },

  // An unauthenticated CLI answers with an error, so keep the last list it did give.
  loadModels: async () => {
    const client = get().client;
    if (!client) return;
    try {
      const data = await client.request({ type: 'list_models' });
      if ('models' in data && data.models.length > 0) set({ models: data.models });
    } catch {
      // Left to the next login or key save.
    } finally {
      set({ modelsLoaded: true });
    }
  },

  startLogin: async () => {
    await ensureAuthRunner();
    const data = await requireClient(get()).request({ type: 'auth_login_start' });
    if (!('authUrl' in data)) throw new Error('The runner did not return an authorization URL');
    set({ login: { authUrl: data.authUrl } });
  },

  submitCode: async (code) => {
    await requireClient(get()).request({ type: 'auth_login_code', code });
    set({ login: undefined });
    await get().refresh();
    await get().loadModels();
    await capture(get);
  },

  // `auth_logout` is what kills the login the CLI is holding open on its stdin.
  cancelLogin: async () => {
    await requireClient(get()).request({ type: 'auth_logout' });
    set({ login: undefined });
    await get().refresh();
  },

  // Sandbox mode has no CLI to log out of: dropping the session's copy is the sign-out.
  logout: async () => {
    if (sessionCredentials) return get().seed(await disconnectCredentials('claude'));
    await get().cancelLogin();
  },

  setApiKey: async (key) => {
    await ensureAuthRunner();
    await requireClient(get()).request({ type: 'auth_set_api_key', key });
    await get().refresh();
    await get().loadModels();
    await capture(get);
  },

  clearApiKey: async () => {
    // One slot holds both the login and the key, so either Clear signs Claude out entirely.
    if (sessionCredentials) return get().seed(await disconnectCredentials('claude'));
    await requireClient(get()).request({ type: 'auth_clear_api_key' });
    await get().refresh();
  },
}));

/** Sandbox mode: the sandbox is about to go, so the sign-in it holds moves into the session. */
async function capture(get: () => AuthStore): Promise<void> {
  const { environment, auth } = get();
  if (!sessionCredentials || !environment) return;
  useAuthStore.setState({ capturing: true });
  try {
    const summary = await captureCredentials(environment.id, 'claude', {
      email: auth?.email,
      plan: auth?.subscriptionType,
      authMethod: auth?.authMethod,
      apiKey: auth?.apiKey,
    });
    get().reset();
    get().seed(summary);
  } finally {
    useAuthStore.setState({ capturing: false });
  }
}

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
        if (connection !== 'open') return;
        // Listing takes seconds, so it waits for the status the card renders first.
        void useAuthStore
          .getState()
          .refresh()
          .then(() => useAuthStore.getState().loadModels());
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
