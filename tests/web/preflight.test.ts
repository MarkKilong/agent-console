import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isCodexLoggedIn,
  isLoggedIn,
  preflight,
  resolveClaudeBinary,
  resolveCodexBinary,
} from '../../apps/web/src/server/preflight.js';

const BINARY = process.platform === 'win32' ? 'claude.exe' : 'claude';
const CODEX = process.platform === 'win32' ? 'codex.cmd' : 'codex';

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

describe('resolveCodexBinary', () => {
  it('finds the executable on PATH', async () => {
    await writeFile(join(dir, CODEX), '', { mode: 0o755 });
    expect(resolveCodexBinary({ PATH: dir })).toBe(join(dir, CODEX));
  });

  it('returns null when CODEX_BINARY points at nothing', () => {
    expect(resolveCodexBinary({ PATH: dir, CODEX_BINARY: join(dir, 'gone.exe') })).toBeNull();
  });
});

describe('isCodexLoggedIn', () => {
  it('is false when there is no auth.json', () => {
    expect(isCodexLoggedIn({ CODEX_HOME: dir })).toBe(false);
  });

  it('is true for an auth.json holding an object', async () => {
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ tokens: { id_token: 'secret' } }));
    expect(isCodexLoggedIn({ CODEX_HOME: dir })).toBe(true);
  });

  it('is unknown when auth.json cannot be parsed', async () => {
    await writeFile(join(dir, 'auth.json'), 'not json');
    expect(isCodexLoggedIn({ CODEX_HOME: dir })).toBeNull();
  });
});

describe('preflight', () => {
  const env = (extra: NodeJS.ProcessEnv = {}) => ({
    PATH: dir,
    CLAUDE_CONFIG_DIR: dir,
    CODEX_HOME: dir,
    ...extra,
  });

  it('reports the default agent and leaves login unknown with no binaries', () => {
    expect(preflight(env({ RUNNER_AGENT: 'fake' }))).toEqual({
      defaultAgent: 'fake',
      claude: { binary: null, loggedIn: null },
      codex: { binary: null, loggedIn: null },
    });
  });

  it('reports both installs independently', async () => {
    await writeFile(join(dir, BINARY), '', { mode: 0o755 });
    await writeFile(join(dir, CODEX), '', { mode: 0o755 });
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ tokens: {} }));

    expect(preflight(env({ RUNNER_AGENT: 'codex' }))).toEqual({
      defaultAgent: 'codex',
      claude: { binary: join(dir, BINARY), loggedIn: false },
      codex: { binary: join(dir, CODEX), loggedIn: true },
    });
  });

  it('defaults to claude for an unknown RUNNER_AGENT', () => {
    expect(preflight(env({ RUNNER_AGENT: 'nope' })).defaultAgent).toBe('claude');
  });
});
