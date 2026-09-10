import type { AuthStatusData, ResponseData } from '@agent-console/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunnerClient } from '../../apps/web/src/lib/runner-client.js';
import { isClaudeConnected, useAuthStore } from '../../apps/web/src/store/use-auth-store.js';

const LOGGED_IN: AuthStatusData = {
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'dev@example.com',
  subscriptionType: 'max',
  apiKey: false,
  loginPending: false,
};

/** Answers `request` from a table, so the store can be driven with no socket. */
function fakeClient(answers: Record<string, ResponseData>): RunnerClient {
  return {
    request: (command: { type: string }) =>
      Promise.resolve(answers[command.type] ?? { ok: true as const }),
  } as unknown as RunnerClient;
}

beforeEach(() => {
  useAuthStore.setState({
    environment: null,
    status: 'idle',
    error: undefined,
    auth: undefined,
    login: undefined,
    models: [],
    modelsLoaded: false,
    client: null,
  });
});

describe('isClaudeConnected', () => {
  it('is false before the status arrives', () => {
    expect(isClaudeConnected(useAuthStore.getState())).toBe(false);
  });

  it('is true for a logged-in CLI', () => {
    expect(isClaudeConnected({ auth: LOGGED_IN })).toBe(true);
  });

  it('is false when the environment has no Claude to log in', () => {
    expect(
      isClaudeConnected({
        auth: { loggedIn: true, authMethod: 'none', apiKey: false, loginPending: false },
      }),
    ).toBe(false);
  });

  it('is true on a stored API key alone', () => {
    expect(
      isClaudeConnected({
        auth: { loggedIn: false, authMethod: 'none', apiKey: true, loginPending: false },
      }),
    ).toBe(true);
  });
});

describe('submitCode', () => {
  it('clears the pending login and refreshes the status', async () => {
    useAuthStore.setState({
      client: fakeClient({ auth_status: LOGGED_IN }),
      login: { authUrl: 'https://claude.com/cai/oauth/authorize' },
    });

    await useAuthStore.getState().submitCode('good-code');

    expect(useAuthStore.getState().login).toBeUndefined();
    expect(useAuthStore.getState().auth).toEqual(LOGGED_IN);
  });

  it('fails while nothing is connected', async () => {
    await expect(useAuthStore.getState().submitCode('good-code')).rejects.toThrow(/Not connected/);
  });
});
