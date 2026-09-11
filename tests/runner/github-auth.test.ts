import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readCredentials } from '../../packages/runner/src/auth/credentials.js';
import { GitHubAuth, GITHUB_CLIENT_ID } from '../../packages/runner/src/auth/github-auth.js';
import { fakeClaudeAuth } from './helpers.js';

const DEVICE_CODE = {
  device_code: 'dev-1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

type Call = { url: string; body: string };

/**
 * Answers the three device-flow endpoints. The token endpoint replays `replies` in
 * order, so one test can walk pending → slow_down → token.
 */
function scripted(replies: Record<string, unknown>[]): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    if (url === 'https://github.com/login/device/code') return Response.json(DEVICE_CODE);
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json(replies.shift() ?? { error: 'access_denied' });
    }
    if (url === 'https://api.github.com/user') return Response.json({ login: 'MarkKilong' });
    throw new Error(`Unexpected request to ${url}`);
  };
  return { fetch, calls };
}

/** The background poll runs on its own; wait for what it did rather than for a tick. */
async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('The login never settled');
}

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-console-github-'));
  dataDir = join(root, 'data');
});

function auth(replies: Record<string, unknown>[]): { auth: GitHubAuth; calls: Call[] } {
  const { fetch, calls } = scripted(replies);
  // Sleeping for real would cost the slow_down test five seconds.
  return { auth: new GitHubAuth({ dataDir, fetch, sleep: async () => {} }), calls };
}

describe('login', () => {
  it('walks pending → slow_down → token → connected', async () => {
    const { auth: github, calls } = auth([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { access_token: 'gho_test', scope: 'repo,workflow' },
    ]);

    expect(github.status()).toMatchObject({ connected: false, pending: undefined });

    const started = await github.loginStart();
    expect(started).toEqual({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    });
    expect(calls[0]?.body).toBe(`client_id=${GITHUB_CLIENT_ID}&scope=repo%20workflow%20read%3Aorg`);

    await until(() => github.status().connected);
    expect(github.status()).toEqual({
      connected: true,
      login: 'MarkKilong',
      scopes: ['repo', 'workflow'],
      pending: undefined,
      error: undefined,
    });
    expect(github.token()).toBe('gho_test');

    // Three polls, not one: the pending and slow_down answers each cost a round trip.
    expect(calls.filter((call) => call.url.endsWith('/oauth/access_token'))).toHaveLength(3);
  });

  it('reports the pending code until the token arrives', async () => {
    const { auth: github } = auth([{ error: 'authorization_pending' }]);
    await github.loginStart();

    expect(github.status()).toMatchObject({
      connected: false,
      pending: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
    });
  });

  it("shows GitHub's reason when the app refuses the device flow", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      Response.json(
        {
          error: 'device_flow_disabled',
          error_description: 'Device Flow must be explicitly enabled for this App',
        },
        { status: 400 },
      );
    const github = new GitHubAuth({ dataDir, fetch });

    await expect(github.loginStart()).rejects.toThrow(
      'Device Flow must be explicitly enabled for this App',
    );
    expect(github.status()).toMatchObject({ connected: false });
  });

  it('clears the pending login on expiry and remembers why', async () => {
    const { auth: github } = auth([
      { error: 'expired_token', error_description: 'The device code has expired.' },
    ]);
    await github.loginStart();

    await until(() => github.status().pending === undefined);
    expect(github.status()).toMatchObject({
      connected: false,
      error: 'The device code has expired.',
    });
  });

  it('forgets the last error when a new login starts', async () => {
    const { auth: github } = auth([{ error: 'access_denied' }, { error: 'authorization_pending' }]);
    await github.loginStart();
    await until(() => github.status().error !== undefined);

    await github.loginStart();
    expect(github.status().error).toBeUndefined();
  });
});

describe('logout', () => {
  it('clears the three stored keys', async () => {
    const { auth: github } = auth([{ access_token: 'gho_test', scope: 'repo' }]);
    await github.loginStart();
    await until(() => github.status().connected);

    github.logout();

    expect(github.status()).toMatchObject({
      connected: false,
      login: undefined,
      scopes: undefined,
    });
    expect(github.token()).toBeUndefined();
    expect(readCredentials(dataDir)).toEqual({});
  });
});

describe('credentials', () => {
  it('keeps the Claude key and the GitHub token side by side', async () => {
    const claude = fakeClaudeAuth(root);
    const { auth: github } = auth([{ access_token: 'gho_test', scope: 'repo' }]);

    claude.setApiKey('sk-ant-test');
    await github.loginStart();
    await until(() => github.status().connected);
    expect(claude.apiKey()).toBe('sk-ant-test');

    // …and the other way round: a key saved afterwards must not drop the token.
    claude.setApiKey('sk-ant-second');
    expect(github.token()).toBe('gho_test');

    claude.clearApiKey();
    expect(github.token()).toBe('gho_test');
    expect(claude.apiKey()).toBeUndefined();
  });
});
