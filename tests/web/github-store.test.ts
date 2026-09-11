import type { GithubStatusData, ResponseData } from '@agent-console/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunnerClient } from '../../apps/web/src/lib/runner-client.js';
import { useAuthStore } from '../../apps/web/src/store/use-auth-store.js';
import { useGithubStore } from '../../apps/web/src/store/use-github-store.js';

const CONNECTED: GithubStatusData = {
  connected: true,
  login: 'MarkKilong',
  scopes: ['repo', 'workflow'],
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
  useGithubStore.setState({ status: undefined, error: undefined });
});

// The pending-login poll is a live timer; leaving one behind outlives the test.
afterEach(() => useGithubStore.getState().stop());

describe('refresh', () => {
  it('stores the status the runner reports', async () => {
    useAuthStore.setState({ client: fakeClient({ github_status: CONNECTED }) });

    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState().status).toEqual(CONNECTED);
    expect(useGithubStore.getState().error).toBeUndefined();
  });

  it('surfaces the error a finished login left behind', async () => {
    const expired: GithubStatusData = { connected: false, error: 'The device code has expired.' };
    useAuthStore.setState({ client: fakeClient({ github_status: expired }) });

    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState().error).toBe('The device code has expired.');
  });

  it('does nothing while nothing is connected', async () => {
    await useGithubStore.getState().refresh();

    expect(useGithubStore.getState().status).toBeUndefined();
  });
});

describe('startLogin', () => {
  it('shows the code without waiting for the next status', async () => {
    useAuthStore.setState({
      client: fakeClient({
        github_login_start: {
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 900,
        },
      }),
    });

    await useGithubStore.getState().startLogin();

    expect(useGithubStore.getState().status).toEqual({
      connected: false,
      pending: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
    });
  });

  it('fails while nothing is connected', async () => {
    await expect(useGithubStore.getState().startLogin()).rejects.toThrow(/Not connected/);
  });
});

describe('logout', () => {
  it('refreshes the status afterwards', async () => {
    useAuthStore.setState({
      client: fakeClient({ github_status: { connected: false } }),
    });
    useGithubStore.setState({ status: CONNECTED });

    await useGithubStore.getState().logout();

    expect(useGithubStore.getState().status).toEqual({ connected: false });
  });
});
