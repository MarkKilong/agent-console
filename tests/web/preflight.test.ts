import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { isLoggedIn, preflight, resolveClaudeBinary } from '../../apps/web/src/server/preflight.js';

const BINARY = process.platform === 'win32' ? 'claude.exe' : 'claude';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-console-preflight-'));
});

describe('resolveClaudeBinary', () => {
  it('finds the executable on PATH', async () => {
    await writeFile(join(dir, BINARY), '', { mode: 0o755 });
    expect(resolveClaudeBinary({ PATH: dir })).toBe(join(dir, BINARY));
  });

  it('returns null when PATH has no claude', () => {
    expect(resolveClaudeBinary({ PATH: dir })).toBeNull();
  });

  it('returns null when CLAUDE_BINARY points at nothing', () => {
    expect(resolveClaudeBinary({ PATH: dir, CLAUDE_BINARY: join(dir, 'gone.exe') })).toBeNull();
  });
});

describe('isLoggedIn', () => {
  it('is false when there are no credentials', () => {
    expect(isLoggedIn({ CLAUDE_CONFIG_DIR: dir })).toBe(false);
  });

  it('is true for a credentials file with an access token', async () => {
    await writeFile(
      join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'sk-secret' } }),
    );
    expect(isLoggedIn({ CLAUDE_CONFIG_DIR: dir })).toBe(true);
  });

  it('is false when the oauth block has no token', async () => {
    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: {} }));
    expect(isLoggedIn({ CLAUDE_CONFIG_DIR: dir })).toBe(false);
  });

  it('is unknown when the credentials cannot be parsed', async () => {
    await writeFile(join(dir, '.credentials.json'), 'not json');
    expect(isLoggedIn({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
  });
});

describe('preflight', () => {
  it('reports nothing to check for the fake agent', () => {
    expect(preflight({ RUNNER_AGENT: 'fake', PATH: dir })).toEqual({
      agent: 'fake',
      claudeBinary: null,
      loggedIn: null,
    });
  });

  it('leaves login unknown when the binary is missing', () => {
    expect(preflight({ PATH: dir, CLAUDE_CONFIG_DIR: dir })).toEqual({
      agent: 'claude',
      claudeBinary: null,
      loggedIn: null,
    });
  });

  it('reports a logged-out install', async () => {
    await writeFile(join(dir, BINARY), '', { mode: 0o755 });
    expect(preflight({ PATH: dir, CLAUDE_CONFIG_DIR: dir })).toEqual({
      agent: 'claude',
      claudeBinary: join(dir, BINARY),
      loggedIn: false,
    });
  });
});
