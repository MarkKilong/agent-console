import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexAuthStatusData } from '@agent-console/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodexAuth } from '../../packages/runner/src/auth/codex-auth.js';
import { fakeCodexAuth } from './helpers.js';

const PROMPT = {
  userCode: 'ABCD-1234',
  verificationUrl: 'https://auth.openai.com/codex/device',
};

let auth: CodexAuth;
let home: string;
let spawned: string[][];

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-console-codex-auth-'));
  home = join(root, 'codex');
  await mkdir(home, { recursive: true });
  spawned = [];
  auth = fakeCodexAuth(root, (args) => spawned.push(args));
});

// A device login left running would outlive the test.
afterEach(() => auth.close());

/** The CLI settles on its own; ask it again rather than wait for a tick. */
async function statusUntil(
  match: (status: CodexAuthStatusData) => boolean,
): Promise<CodexAuthStatusData> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await auth.status();
    if (match(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The login never settled');
}

describe('device login', () => {
  it('walks logged out → code → approved → signed in → logged out', async () => {
    await expect(auth.status()).resolves.toMatchObject({
      installed: true,
      loggedIn: false,
      authMethod: 'none',
      loginPending: false,
    });

    // The url and the code arrive wrapped in colour codes.
    await expect(auth.loginStart()).resolves.toEqual(PROMPT);
    await expect(auth.status()).resolves.toMatchObject({ loginPending: true, pending: PROMPT });

    await writeFile(join(home, 'approve'), '');
    await expect(statusUntil((status) => status.loggedIn)).resolves.toMatchObject({
      authMethod: 'chatgpt',
      loginPending: false,
      error: undefined,
    });

    await auth.logout();
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: false, authMethod: 'none' });
  }, 20000);

  it('remembers why a refused login failed, and forgets it on the next start', async () => {
    await auth.loginStart();
    await writeFile(join(home, 'deny'), '');

    const failed = await statusUntil((status) => status.error !== undefined);
    expect(failed).toMatchObject({ loggedIn: false, loginPending: false, pending: undefined });
    expect(failed.error).toMatch(/Error logging in with device code: denied/);

    await rm(join(home, 'deny'));
    await auth.loginStart();
    await expect(auth.status()).resolves.toMatchObject({ loginPending: true, error: undefined });
  }, 20000);

  it('kills the login on cancel, so a later approval does nothing', async () => {
    await auth.loginStart();
    const before = spawned.length;

    auth.cancel();
    await expect(auth.status()).resolves.toMatchObject({ loginPending: false, pending: undefined });

    await writeFile(join(home, 'approve'), '');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: false });
    // The dead child is not replaced: nothing but the status probes ran.
    expect(spawned.slice(before).every((args) => args[0] !== 'login' || args[1] === 'status')).toBe(
      true,
    );
  }, 20000);
});

describe('api key', () => {
  it('saves a key and reports what the CLI refused', async () => {
    await expect(auth.setApiKey('sk-bad')).rejects.toThrow(/invalid API key/);
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: false, authMethod: 'none' });

    await expect(auth.setApiKey('sk-good')).resolves.toBeUndefined();
    await expect(auth.status()).resolves.toMatchObject({ loggedIn: true, authMethod: 'api_key' });
  }, 20000);
});

describe('version', () => {
  it('reports the CLI version, without its name, and asks for it once', async () => {
    await expect(auth.status()).resolves.toMatchObject({ version: '9.9.9' });
    await expect(auth.status()).resolves.toMatchObject({ version: '9.9.9' });

    expect(spawned.filter((args) => args[0] === '--version')).toHaveLength(1);
  }, 20000);
});
