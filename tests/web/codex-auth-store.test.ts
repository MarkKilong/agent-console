import type { CodexAuthStatusData, ResponseData } from '@agent-console/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunnerClient } from '../../apps/web/src/lib/runner-client.js';
import { useAuthStore } from '../../apps/web/src/store/use-auth-store.js';
import { useCodexAuthStore } from '../../apps/web/src/store/use-codex-auth-store.js';

const CONNECTED: CodexAuthStatusData = {
  installed: true,
  loggedIn: true,
  authMethod: 'chatgpt',
  loginPending: false,
  version: '0.154.0',
};

/** Answers `request` from a table, so the store can be driven with no socket. */
function fakeClient(answers: Record<string, ResponseData>): RunnerClient {
  return {
    request: (command: { type: string }) =>
      Promise.resolve(answers[command.type] ?? { ok: true as const }),
  } as unknown as RunnerClient;
}

beforeEach(() => {
  useAuthStore.setState({ client: null });
  useCodexAuthStore.setState({ status: undefined, error: undefined });
});

// The pending-login poll is a live timer; leaving one behind outlives the test.
afterEach(() => useCodexAuthStore.getState().stop());

describe('refresh', () => {
  it('stores the status the runner reports', async () => {
    useAuthStore.setState({ client: fakeClient({ codex_auth_status: CONNECTED }) });

    await useCodexAuthStore.getState().refresh();

    expect(useCodexAuthStore.getState().status).toEqual(CONNECTED);
    expect(useCodexAuthStore.getState().error).toBeUndefined();
  });

  it('keeps the not-installed answer, so the card can offer the install line', async () => {
    const missing: CodexAuthStatusData = {
      installed: false,
      loggedIn: false,
      authMethod: 'none',
      loginPending: false,
    };
    useAuthStore.setState({ client: fakeClient({ codex_auth_status: missing }) });

    await useCodexAuthStore.getState().refresh();

    expect(useCodexAuthStore.getState().status).toEqual(missing);
  });

  it('surfaces the error a finished login left behind', async () => {
    const denied: CodexAuthStatusData = {
      installed: true,
      loggedIn: false,
      authMethod: 'none',
      loginPending: false,
      error: 'Login failed: denied',
    };
    useAuthStore.setState({ client: fakeClient({ codex_auth_status: denied }) });

    await useCodexAuthStore.getState().refresh();

    expect(useCodexAuthStore.getState().error).toBe('Login failed: denied');
  });

  it('does nothing while nothing is connected', async () => {
    await useCodexAuthStore.getState().refresh();

    expect(useCodexAuthStore.getState().status).toBeUndefined();
  });
});

describe('startLogin', () => {
  it('shows the code without waiting for the next status', async () => {
    useAuthStore.setState({
      client: fakeClient({
        codex_login_start: {
          userCode: 'ABCD-1234',
          verificationUrl: 'https://auth.openai.com/codex/device',
        },
      }),
    });

    await useCodexAuthStore.getState().startLogin();

    expect(useCodexAuthStore.getState().status).toMatchObject({
      installed: true,
      loggedIn: false,
      loginPending: true,
      pending: {
        userCode: 'ABCD-1234',
        verificationUrl: 'https://auth.openai.com/codex/device',
      },
    });
  });

  it('fails while nothing is connected', async () => {
    await expect(useCodexAuthStore.getState().startLogin()).rejects.toThrow(/Not connected/);
  });
});

describe('logout', () => {
  it('refreshes the status afterwards', async () => {
    const out: CodexAuthStatusData = {
      installed: true,
      loggedIn: false,
      authMethod: 'none',
      loginPending: false,
    };
    useAuthStore.setState({ client: fakeClient({ codex_auth_status: out }) });
    useCodexAuthStore.setState({ status: CONNECTED });

    await useCodexAuthStore.getState().logout();

    expect(useCodexAuthStore.getState().status).toEqual(out);
  });
});

describe('setApiKey', () => {
  it('refreshes the status afterwards', async () => {
    const keyed: CodexAuthStatusData = {
      installed: true,
      loggedIn: true,
      authMethod: 'api_key',
      loginPending: false,
    };
    useAuthStore.setState({ client: fakeClient({ codex_auth_status: keyed }) });

    await useCodexAuthStore.getState().setApiKey('sk-test');

    expect(useCodexAuthStore.getState().status).toEqual(keyed);
  });
});
