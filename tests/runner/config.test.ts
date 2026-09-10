import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  it('rejects a CODEX_BINARY that does not exist', () => {
    expect(() =>
      loadConfig({
        RUNNER_TOKEN: 'dev',
        RUNNER_AGENT: 'codex',
        CODEX_BINARY: join(tmpdir(), 'no-such-codex.exe'),
      }),
    ).toThrow(/CODEX_BINARY is not an executable file/);
  });

  it('accepts a CODEX_BINARY that exists, with a model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-console-config-'));
    const binary = join(dir, 'codex.cmd');
    await writeFile(binary, '', { mode: 0o755 });

    const config = loadConfig({
      RUNNER_TOKEN: 'dev',
      RUNNER_AGENT: 'codex',
      CODEX_BINARY: binary,
      CODEX_MODEL: 'gpt-5-codex',
    });
    expect(config).toMatchObject({
      agent: 'codex',
      codexBinary: binary,
      codexModel: 'gpt-5-codex',
      claudeBinary: undefined,
    });
  });

  it('ignores CODEX_BINARY for the claude agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-console-config-'));
    const claude = join(dir, 'claude.exe');
    await writeFile(claude, '', { mode: 0o755 });

    const config = loadConfig({
      RUNNER_TOKEN: 'dev',
      CLAUDE_BINARY: claude,
      CODEX_BINARY: join(tmpdir(), 'no-such-codex.exe'),
    });
    expect(config.agent).toBe('claude');
    expect(config.codexBinary).toBeUndefined();
  });

  it('shares one data root and hashes the workspace under it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-console-root-'));
    const config = loadConfig({
      RUNNER_TOKEN: 'dev',
      RUNNER_AGENT: 'fake',
      AGENT_CONSOLE_DATA_DIR: root,
      RUNNER_CWD: tmpdir(),
    });

    expect(config.dataRoot).toBe(root);
    expect(dirname(config.dataDir)).toBe(root);
    expect(config.dataDir).not.toBe(root);
    expect(config.threadsDir).toBe(join(config.dataDir, 'threads'));
  });

  it('defaults the data root to ~/.agent-console', () => {
    const config = loadConfig({ RUNNER_TOKEN: 'dev', RUNNER_AGENT: 'fake' });
    expect(config.dataRoot).toBe(join(homedir(), '.agent-console'));
  });

  it('complains when codex is not on PATH', () => {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(() => loadConfig({ RUNNER_TOKEN: 'dev', RUNNER_AGENT: 'codex' })).toThrow(
        /Could not find the `codex` executable on PATH/,
      );
    } finally {
      process.env.PATH = path;
    }
  });
});
