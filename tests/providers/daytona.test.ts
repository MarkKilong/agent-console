import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAYTONA_WORKSPACE,
  DaytonaProvider,
  type DaytonaClient,
  type DaytonaSandbox,
} from '../../packages/providers/src/daytona/daytona-provider.js';
import { createProvider } from '../../packages/providers/src/index.js';

const PREVIEW = 'https://4310-sbx.daytonaproxy.example';

/** A sandbox that records what the provider asked of it and reports itself healthy. */
function fakeSandbox(
  id: string,
  labels: Record<string, string>,
  createdAt = new Date().toISOString(),
): DaytonaSandbox & { calls: string[]; files: Map<string, string>; modes: Map<string, string> } {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const modes = new Map<string, string>();
  return {
    files,
    modes,
    fs: {
      createFolder: async (path, mode) => {
        calls.push(`mkdir ${path} ${mode}`);
      },
      uploadFiles: async (uploads) => {
        calls.push(`upload ${uploads.map((file) => file.destination).join(',')}`);
        for (const file of uploads) files.set(file.destination, file.source.toString('utf8'));
      },
      downloadFile: async (path) => {
        const content = files.get(path);
        if (content === undefined) throw new Error(`file not found: ${path}`);
        return Buffer.from(content, 'utf8');
      },
      setFilePermissions: async (path, permissions) => {
        if (permissions.mode) modes.set(path, permissions.mode);
      },
    },
    id,
    state: 'started',
    labels,
    createdAt,
    calls,
    start: async () => {
      calls.push('start');
    },
    stop: async () => {
      calls.push('stop');
    },
    delete: async () => {
      calls.push('delete');
    },
    getPreviewLink: async (port) => ({ url: `${PREVIEW}:${port}`, token: 'preview-token' }),
    git: {
      clone: async (url, path, branch) => {
        calls.push(`clone ${url} ${path} ${branch ?? ''}`.trim());
      },
    },
    process: {
      createSession: async (session) => {
        calls.push(`session ${session}`);
      },
      executeSessionCommand: async (session, request) => {
        calls.push(`exec ${session} ${request.command} async=${request.runAsync}`);
      },
    },
  };
}

function fakeClient() {
  const sandboxes = new Map<string, ReturnType<typeof fakeSandbox>>();
  const created: Parameters<DaytonaClient['create']>[0][] = [];
  const client: DaytonaClient = {
    create: async (params) => {
      created.push(params);
      const sandbox = fakeSandbox(`sbx-${created.length}`, params.labels);
      sandboxes.set(sandbox.id, sandbox);
      return sandbox;
    },
    get: async (id) => {
      const sandbox = sandboxes.get(id);
      if (!sandbox)
        throw Object.assign(new Error(`Sandbox ${id} not found`), { name: 'DaytonaNotFoundError' });
      return sandbox;
    },
    list: async function* (query) {
      for (const sandbox of sandboxes.values()) {
        const wanted = Object.entries(query?.labels ?? {});
        if (wanted.every(([key, value]) => sandbox.labels[key] === value)) yield sandbox;
      }
    },
  };
  /** Puts a sandbox of a given age in the list, which `create` cannot express. */
  const add = (id: string, labels: Record<string, string>, ageMs: number) => {
    const sandbox = fakeSandbox(id, labels, new Date(Date.now() - ageMs).toISOString());
    sandboxes.set(id, sandbox);
    return sandbox;
  };
  return { client, created, sandboxes, add };
}

describe('DaytonaProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a sandbox, clones the repo, starts the runner and hands out its endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, created, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    const handle = await provider.create({
      repoUrl: 'https://github.com/o/r.git',
      branch: 'main',
      env: { RUNNER_AGENT: 'fake' },
    });
    expect(handle).toEqual({ id: 'sbx-1', kind: 'daytona', status: 'running' });

    const params = created[0]!;
    expect(params.snapshot).toBe('runner:1');
    expect(params.public).toBe(true);
    expect(params.envVars).toMatchObject({
      RUNNER_AGENT: 'fake',
      RUNNER_PORT: '4310',
      RUNNER_CWD: DAYTONA_WORKSPACE,
    });
    expect(params.envVars.RUNNER_TOKEN).toBeTruthy();
    expect(params.labels['agent-console/token']).toBe(params.envVars.RUNNER_TOKEN);

    expect(sandboxes.get('sbx-1')!.calls).toEqual([
      `clone https://github.com/o/r.git ${DAYTONA_WORKSPACE} main`,
      'session runner',
      'exec runner cd /app/packages/runner && node dist/main.js async=true',
    ]);

    await expect(provider.endpoint('sbx-1')).resolves.toEqual({
      url: `wss://4310-sbx.daytonaproxy.example:4310`,
      token: params.envVars.RUNNER_TOKEN,
    });
    await expect(provider.status('sbx-1')).resolves.toBe('running');
  });

  it('deletes the sandbox when the runner never becomes healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    );
    vi.useFakeTimers();
    const { client, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    const creating = provider.create({ repoUrl: 'https://github.com/o/r.git' });
    const failed = expect(creating).rejects.toThrow(/did not become healthy/);
    await vi.advanceTimersByTimeAsync(61_000);
    await failed;
    vi.useRealTimers();

    expect(sandboxes.get('sbx-1')!.calls.at(-1)).toBe('delete');
  });

  it('writes the spec files before the runner starts and reads them back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    await provider.create({
      repoUrl: 'https://github.com/o/r.git',
      files: [{ path: '/root/.claude/.credentials.json', content: '{"token":"t"}', mode: 0o600 }],
    });

    const sandbox = sandboxes.get('sbx-1')!;
    // Uploaded after the clone and before the runner: the CLI reads it as it starts.
    expect(sandbox.calls).toEqual([
      `clone https://github.com/o/r.git ${DAYTONA_WORKSPACE}`,
      'upload /root/.claude/.credentials.json',
      'session runner',
      'exec runner cd /app/packages/runner && node dist/main.js async=true',
    ]);
    expect(sandbox.modes.get('/root/.claude/.credentials.json')).toBe('600');

    await expect(
      provider.readFiles('sbx-1', ['/root/.claude/.credentials.json', '/root/.codex/auth.json']),
    ).resolves.toEqual({ '/root/.claude/.credentials.json': '{"token":"t"}' });
  });

  it('makes an empty workspace when there is no repository, and labels it an auth sandbox', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, created, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    await provider.create({ env: { RUNNER_AGENT: 'fake' } });

    const params = created[0]!;
    expect(params.labels['agent-console/kind']).toBe('auth');
    expect(params.autoStopInterval).toBe(5);
    expect(params.autoDeleteInterval).toBe(0);
    expect(params.envVars).toMatchObject({
      HOME: '/root',
      CLAUDE_CONFIG_DIR: '/root/.claude',
      AGENT_CONSOLE_DATA_DIR: '/root/.agent-console',
      RUNNER_CWD: DAYTONA_WORKSPACE,
    });
    expect(sandboxes.get('sbx-1')!.calls[0]).toBe(`mkdir ${DAYTONA_WORKSPACE} 755`);
  });

  it('sweeps only auth sandboxes, and only the ones past the age given', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    const stale = add('auth-old', { 'agent-console/kind': 'auth' }, 45 * 60_000);
    const fresh = add('auth-new', { 'agent-console/kind': 'auth' }, 60_000);
    const project = add(
      'project',
      { 'agent-console/repo': 'https://github.com/o/r.git' },
      5 * 3_600_000,
    );

    await expect(provider.sweepStaleAuth(30 * 60_000)).resolves.toEqual(['auth-old']);
    expect(stale.calls).toEqual(['delete']);
    expect(fresh.calls).toEqual([]);
    expect(project.calls).toEqual([]);
  });

  it('keeps sweeping when one delete fails, and spares a sandbox with no age', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    const stubborn = add('auth-stuck', { 'agent-console/kind': 'auth' }, 45 * 60_000);
    stubborn.delete = () => Promise.reject(new Error('sandbox is busy'));
    const ageless = add('auth-unknown', { 'agent-console/kind': 'auth' }, 45 * 60_000);
    Object.assign(ageless, { createdAt: undefined });
    const stale = add('auth-old', { 'agent-console/kind': 'auth' }, 45 * 60_000);

    await expect(provider.sweepStaleAuth(30 * 60_000)).resolves.toEqual(['auth-old']);
    expect(stale.calls).toEqual(['delete']);
    expect(ageless.calls).toEqual([]);
  });

  it('refuses a local folder', async () => {
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client: fakeClient().client });
    await expect(provider.create({ repoPath: 'C:/code/app' })).rejects.toThrow(/repoUrl/);
  });

  it('reports a missing sandbox as gone and destroys it without complaint', async () => {
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client: fakeClient().client });
    await expect(provider.status('nope')).resolves.toBe('gone');
    await expect(provider.destroy('nope')).resolves.toBeUndefined();
  });
});

describe('createProvider', () => {
  it('names the variable the daytona entry needs when it is unset', async () => {
    vi.stubEnv('DAYTONA_SNAPSHOT', '');
    await expect(createProvider('daytona')).rejects.toThrow(/DAYTONA_SNAPSHOT/);
    vi.unstubAllEnvs();
  });
});
