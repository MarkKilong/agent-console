import type { EnvFile } from '@agent-console/contracts';
import type { Session } from '../../apps/web/src/server/credentials.js';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bundlePaths,
  captureFiles,
  refreshStored,
  sessionFiles,
  storedPaths,
  summarise,
} from '../../apps/web/src/server/credentials.js';
import { decodeSession, encodeSession } from '../../apps/web/src/server/session-codec.js';

const SECRET = randomBytes(32).toString('base64');

const CLAUDE_FILE = '/root/.claude/.credentials.json';
const CODEX_FILE = '/root/.codex/auth.json';
const RUNNER_FILE = '/root/.agent-console/credentials.json';

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

/** The largest bundle a user can have: a Claude login, a Codex login, and a GitHub token. */
function fullSession(): Session {
  return {
    providers: {
      claude: {
        files: {
          [CLAUDE_FILE]: JSON.stringify({
            claudeAiOauth: { accessToken: randomBytes(300).toString('base64url') },
          }),
          [RUNNER_FILE]: JSON.stringify({ anthropicApiKey: `sk-ant-${'x'.repeat(90)}` }),
        },
        info: { email: 'me@example.com', plan: 'max', authMethod: 'claude.ai', apiKey: true },
      },
      codex: {
        files: {
          [CODEX_FILE]: JSON.stringify({
            tokens: {
              id_token: randomBytes(1100).toString('base64url'),
              access_token: randomBytes(1100).toString('base64url'),
            },
          }),
        },
        info: { authMethod: 'chatgpt' },
      },
      github: {
        files: {
          [RUNNER_FILE]: JSON.stringify({ githubToken: 'gho_x', githubLogin: 'me' }),
        },
        info: { login: 'me', scopes: ['repo'] },
      },
    },
  };
}

describe('session cookie', () => {
  it('round trips a session through encrypt and decrypt', async () => {
    const session = fullSession();
    await expect(decodeSession(await encodeSession(session))).resolves.toEqual(session);
  });

  it('splits a large session across cookies and reassembles it', async () => {
    const session = fullSession();
    const chunks = await encodeSession(session);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(3800);
    await expect(decodeSession(chunks)).resolves.toEqual(session);
  });

  it('carries the auth sandbox id with no provider connected yet', async () => {
    const session: Session = { providers: {}, authEnvironmentId: 'sbx-1' };
    await expect(decodeSession(await encodeSession(session))).resolves.toEqual(session);
  });

  it('reads as empty under a different secret rather than throwing', async () => {
    const chunks = await encodeSession(fullSession());
    process.env.SESSION_SECRET = randomBytes(32).toString('base64');
    await expect(decodeSession(chunks)).resolves.toEqual({ providers: {} });
  });

  it('names SESSION_SECRET when it is missing or too short', async () => {
    delete process.env.SESSION_SECRET;
    await expect(encodeSession({ providers: {} })).rejects.toThrow(/SESSION_SECRET is required/);
    process.env.SESSION_SECRET = randomBytes(8).toString('base64');
    await expect(encodeSession({ providers: {} })).rejects.toThrow(/at least 32 bytes/);
  });
});

describe('credential bundle', () => {
  it('captures only the keys a provider owns in the file it shares', () => {
    const found = {
      [RUNNER_FILE]: JSON.stringify({
        anthropicApiKey: 'sk-ant-1',
        githubToken: 'gho_1',
        githubLogin: 'me',
      }),
    };
    expect(captureFiles('claude', found)).toEqual({
      [RUNNER_FILE]: JSON.stringify({ anthropicApiKey: 'sk-ant-1' }),
    });
    expect(captureFiles('github', found)).toEqual({
      [RUNNER_FILE]: JSON.stringify({ githubToken: 'gho_1', githubLogin: 'me' }),
    });
  });

  it('leaves out a file the sandbox never wrote', () => {
    expect(bundlePaths('claude')).toEqual([CLAUDE_FILE, RUNNER_FILE]);
    expect(captureFiles('claude', {})).toEqual({});
  });

  it('merges the shared file when two providers own a slice of it', () => {
    const files = sessionFiles(fullSession());
    const shared = files.find((file: EnvFile) => file.path === RUNNER_FILE);
    expect(JSON.parse(shared!.content)).toEqual({
      anthropicApiKey: `sk-ant-${'x'.repeat(90)}`,
      githubToken: 'gho_x',
      githubLogin: 'me',
    });
    expect(shared!.mode).toBe(0o600);
    expect(files.map((file: EnvFile) => file.path).sort()).toEqual(
      [CLAUDE_FILE, RUNNER_FILE, CODEX_FILE].sort(),
    );
  });

  it('folds a rotated credential back into the session', () => {
    const session = fullSession();
    expect(storedPaths(session).sort()).toEqual([CLAUDE_FILE, CODEX_FILE, RUNNER_FILE].sort());

    const rotated = JSON.stringify({ claudeAiOauth: { accessToken: 'fresh' } });
    expect(refreshStored(session, { [CLAUDE_FILE]: rotated })).toBe(true);
    expect(session.providers.claude!.files[CLAUDE_FILE]).toBe(rotated);
    expect(refreshStored(session, { [CLAUDE_FILE]: rotated })).toBe(false);
  });

  it('summarises the connected providers and none of their secrets', () => {
    const summary = summarise(fullSession());
    expect(Object.keys(summary).sort()).toEqual(['claude', 'codex', 'github']);
    expect(summary.github).toEqual({ login: 'me', scopes: ['repo'] });
    expect(JSON.stringify(summary)).not.toContain('sk-ant-');
  });
});
