import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/runner/src/config.js';

describe('loadConfig', () => {
  it('requires a token', () => {
    expect(() => loadConfig({})).toThrow(/RUNNER_TOKEN/);
  });

  it('rejects a CLAUDE_BINARY that does not exist', () => {
    expect(() =>
      loadConfig({ RUNNER_TOKEN: 'dev', CLAUDE_BINARY: join(tmpdir(), 'no-such-claude.exe') }),
    ).toThrow(/CLAUDE_BINARY is not an executable file/);
  });

  it('accepts a CLAUDE_BINARY that exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-console-config-'));
    const binary = join(dir, 'claude.exe');
    await writeFile(binary, '', { mode: 0o755 });

    expect(loadConfig({ RUNNER_TOKEN: 'dev', CLAUDE_BINARY: binary }).claudeBinary).toBe(binary);
  });

  it('ignores CLAUDE_BINARY for the fake agent', () => {
    const config = loadConfig({
      RUNNER_TOKEN: 'dev',
      RUNNER_AGENT: 'fake',
      CLAUDE_BINARY: join(tmpdir(), 'no-such-claude.exe'),
    });
    expect(config.agent).toBe('fake');
    expect(config.claudeBinary).toBeUndefined();
  });
});
