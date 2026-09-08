import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProvider } from '../../packages/providers/src/index.js';

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
