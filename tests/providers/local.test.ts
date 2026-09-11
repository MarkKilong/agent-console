import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../packages/providers/src/index.js';

/** Every runner the provider spawned, so a test can kill one behind its back. */
const spawned = vi.hoisted(() => [] as import('node:child_process').ChildProcess[]);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  // `spawn` is overloaded; the wrapper only ever sees the provider's (cmd, args, options) call.
  const spawn = ((...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    spawned.push(child);
    return child;
  }) as typeof actual.spawn;
  return { ...actual, spawn };
});

describe('LocalProvider', () => {
  it('runs a runner through its whole lifecycle', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'agent-console-local-'));
    execFileSync('git', ['init', '-q'], { cwd: repoPath });

    const provider = createProvider('local');
    const handle = await provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } });

    expect(handle.kind).toBe('local');
    await expect(provider.status(handle.id)).resolves.toBe('running');

    const endpoint = await provider.endpoint(handle.id);
    expect(endpoint.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(endpoint.token).toBeTruthy();

    const health = await fetch(`${endpoint.url.replace('ws://', 'http://')}/healthz`);
    await expect(health.json()).resolves.toEqual({ ok: true, protocolVersion: 1 });

    await provider.destroy(handle.id);
    await expect(provider.status(handle.id)).resolves.toBe('gone');
    // The runner process is really gone, not just marked as such.
    await expect(fetch(`${endpoint.url.replace('ws://', 'http://')}/healthz`)).rejects.toThrow();
  }, 45_000);

  it('fails fast when the runner cannot start, instead of waiting out the health timeout', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'agent-console-local-'));
    execFileSync('git', ['init', '-q'], { cwd: repoPath });

    const provider = createProvider('local');
    const started = Date.now();
    await expect(
      provider.create({
        repoPath,
        env: { RUNNER_AGENT: 'claude', CLAUDE_BINARY: 'C:/definitely/missing/claude.exe' },
      }),
    ).rejects.toThrow(/claude/i);
    // The health timeout is 20s; losing the race to the dying child must be far quicker.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it('answers two concurrent creates for one folder with a single runner', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'agent-console-local-'));
    execFileSync('git', ['init', '-q'], { cwd: repoPath });

    const provider = createProvider('local');
    // One handle means one Environment record, and each of those spawns one child.
    const [first, second] = await Promise.all([
      provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } }),
      provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } }),
    ]);
    expect(second.id).toBe(first.id);

    const endpoint = await provider.endpoint(first.id);
    await expect(
      fetch(`${endpoint.url.replace('ws://', 'http://')}/healthz`).then((r) => r.ok),
    ).resolves.toBe(true);

    await provider.destroy(first.id);
  }, 45_000);

  it('reuses the running environment for a folder instead of spawning a second runner', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'agent-console-local-'));
    execFileSync('git', ['init', '-q'], { cwd: repoPath });

    const provider = createProvider('local');
    const first = await provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } });
    // A different spelling of the same folder must still find it.
    const second = await provider.create({
      repoPath: join(repoPath, '.'),
      env: { RUNNER_AGENT: 'fake' },
    });

    expect(second.id).toBe(first.id);
    await expect(provider.endpoint(second.id)).resolves.toEqual(await provider.endpoint(first.id));

    await provider.destroy(first.id);
  }, 45_000);

  it('spawns a fresh runner for a folder whose runner died behind its back', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'agent-console-local-'));
    execFileSync('git', ['init', '-q'], { cwd: repoPath });

    const provider = createProvider('local');
    const first = await provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } });
    const firstEndpoint = await provider.endpoint(first.id);

    // Killed from outside the provider, as a task manager or a stray taskkill would.
    const child = spawned.at(-1)!;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;

    await expect(provider.status(first.id)).resolves.toBe('stopped');

    const second = await provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } });
    expect(second.id).not.toBe(first.id);
    const secondEndpoint = await provider.endpoint(second.id);
    expect(secondEndpoint.url).not.toBe(firstEndpoint.url);
    const health = await fetch(`${secondEndpoint.url.replace('ws://', 'http://')}/healthz`);
    expect(health.ok).toBe(true);

    await provider.destroy(second.id);
  }, 45_000);

  it('names a missing folder instead of blaming the node executable', async () => {
    const provider = createProvider('local');
    const repoPath = join(tmpdir(), `agent-console-missing-${Date.now()}`);
    await expect(provider.create({ repoPath, env: { RUNNER_AGENT: 'fake' } })).rejects.toThrow(
      `Folder does not exist: ${repoPath}`,
    );
  });

  it('rejects a spec the local provider cannot satisfy', async () => {
    const provider = createProvider('local');
    await expect(provider.create({ repoUrl: 'https://example.com/repo.git' })).rejects.toThrow(
      /repoPath/,
    );
  });

  it('rejects an unknown environment id', async () => {
    const provider = createProvider('local');
    await expect(provider.status('nope')).rejects.toThrow(/Unknown environment/);
  });
});
