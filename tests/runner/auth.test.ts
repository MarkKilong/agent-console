import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClaudeAuth } from '../../packages/runner/src/auth/claude-auth.js';
import { fakeClaudeAuth } from './helpers.js';

let auth: ClaudeAuth;
let root: string;
let spawned: string[][];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-console-auth-'));
  spawned = [];
  auth = fakeClaudeAuth(root, (args) => spawned.push(args));
});

describe('login', () => {
  it('walks logged out → url → bad code → good code → logged in', async () => {
    await expect(auth.status()).resolves.toMatchObject({
      loggedIn: false,
      authMethod: 'none',
      apiKey: false,
      loginPending: false,
    });

    const url = await auth.loginStart();
    expect(url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    // The Console login is gone: an API key covers API billing already.
    expect(spawned.flat()).not.toContain('--console');
    await expect(auth.status()).resolves.toMatchObject({ loginPending: true });

    await expect(auth.loginCode('nope')).rejects.toThrow(/Login failed: Invalid code/);
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: false, loginPending: false });

    await auth.loginStart();
    await expect(auth.loginCode('good-code')).resolves.toBeUndefined();
    await expect(auth.status()).resolves.toMatchObject({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'dev@example.com',
      subscriptionType: 'max',
      loginPending: false,
    });

    await auth.logout();
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: false, authMethod: 'none' });
  }, 20000);

  it('refuses a code with no login in progress', async () => {
    await expect(auth.loginCode('good-code')).rejects.toThrow(/No login in progress/);
  });
});

describe('version', () => {
  it('reports the CLI version, without the trailer, and asks for it once', async () => {
    await expect(auth.status()).resolves.toMatchObject({ version: '9.9.9' });
    await expect(auth.status()).resolves.toMatchObject({ version: '9.9.9' });

    expect(spawned.filter((args) => args[0] === '--version')).toHaveLength(1);
  });
});

describe('api key', () => {
  it('round-trips through the data dir', async () => {
    expect(auth.apiKey()).toBeUndefined();

    auth.setApiKey('sk-ant-test');
    expect(auth.apiKey()).toBe('sk-ant-test');
    await expect(auth.status()).resolves.toMatchObject({ apiKey: true });

    auth.clearApiKey();
    expect(auth.apiKey()).toBeUndefined();
    await expect(auth.status()).resolves.toMatchObject({ apiKey: false });
  });

  // Windows derives the mode from ACLs, so there is nothing to assert there.
  it.skipIf(process.platform === 'win32')('stores the key 0600', async () => {
    auth.setApiKey('sk-ant-test');
    const stats = await stat(join(root, 'data', 'credentials.json'));
    expect(stats.mode & 0o777).toBe(0o600);
  });
});
