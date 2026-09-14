import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAYTONA_WORKSPACE,
  DaytonaProvider,
  type DaytonaClient,
  type DaytonaSandbox,
} from '../../packages/providers/src/daytona/daytona-provider.js';
import { createProvider } from '../../packages/providers/src/index.js';

const PREVIEW = 'https://4310-sbx.daytonaproxy.example';

/** `state` is writable here: start and stop move it, as Daytona's own does. */
type FakeSandbox = Omit<DaytonaSandbox, 'state'> & {
  state: string;
  calls: string[];
  files: Map<string, string>;
  modes: Map<string, string>;
};

/** A sandbox that records what the provider asked of it and reports itself healthy. */
function fakeSandbox(
  id: string,
  labels: Record<string, string>,
  createdAt = new Date().toISOString(),
): FakeSandbox {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const modes = new Map<string, string>();
  const sandbox: FakeSandbox = {
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
      sandbox.state = 'started';
    },
    stop: async () => {
      calls.push('stop');
      sandbox.state = 'stopped';
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
      executeCommand: async (command, cwd) => {
        calls.push(`run ${command} in ${cwd}`);
        return { exitCode: 0 };
      },
    },
  };
  return sandbox;
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
      'exec runner cd /app/packages/runner && IS_SANDBOX=1 node dist/main.js async=true',
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
      'exec runner cd /app/packages/runner && IS_SANDBOX=1 node dist/main.js async=true',
    ]);
    expect(sandbox.modes.get('/root/.claude/.credentials.json')).toBe('600');

    await expect(
      provider.readFiles('sbx-1', ['/root/.claude/.credentials.json', '/root/.codex/auth.json']),
    ).resolves.toEqual({ '/root/.claude/.credentials.json': '{"token":"t"}' });
  });

  it('writes files into a sandbox that is already running', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const sandbox = add('sbx-9', {}, 0);

    await provider.writeFiles('sbx-9', [
      { path: '/root/.codex/auth.json', content: '{"id":"new"}', mode: 0o600 },
    ]);

    expect(sandbox.files.get('/root/.codex/auth.json')).toBe('{"id":"new"}');
    expect(sandbox.modes.get('/root/.codex/auth.json')).toBe('600');
    // Nothing is restarted: the CLIs read their credentials again on the next turn.
    expect(sandbox.calls).toEqual(['upload /root/.codex/auth.json']);
  });

  it('makes an empty workspace for the auth sandbox, with no repository of its own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, created, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    await provider.create({ kind: 'auth', env: { RUNNER_AGENT: 'fake' } });

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
    // No `git init`: the auth sandbox never holds work worth diffing.
    expect(sandboxes.get('sbx-1')!.calls).toEqual([
      `mkdir ${DAYTONA_WORKSPACE} 755`,
      'session runner',
      'exec runner cd /app/packages/runner && IS_SANDBOX=1 node dist/main.js async=true',
    ]);
  });

  it('git-inits the empty workspace of a project with no repository', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, created, sandboxes } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    await provider.create({ name: 'scratch' });

    const params = created[0]!;
    expect(params.labels['agent-console/name']).toBe('scratch');
    expect(params.labels['agent-console/kind']).toBeUndefined();
    // A project lives as long as any other, not the auth sandbox's few minutes.
    expect(params.autoStopInterval).toBe(15);
    expect(params.autoDeleteInterval).toBe(2 * 60);
    expect(sandboxes.get('sbx-1')!.calls).toEqual([
      `mkdir ${DAYTONA_WORKSPACE} 755`,
      `run git init in ${DAYTONA_WORKSPACE}`,
      'session runner',
      'exec runner cd /app/packages/runner && IS_SANDBOX=1 node dist/main.js async=true',
    ]);
  });

  it('evicts the oldest stopped project sandbox when the disk cap is hit, and creates again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, sandboxes, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });

    const oldest = add('old', { 'agent-console/token': 'a' }, 5 * 3_600_000);
    oldest.state = 'stopped';
    const newer = add('new', { 'agent-console/token': 'b' }, 3_600_000);
    newer.state = 'stopped';
    const running = add('running', { 'agent-console/token': 'c' }, 9 * 3_600_000);
    const auth = add(
      'auth',
      { 'agent-console/token': 'd', 'agent-console/kind': 'auth' },
      9 * 3_600_000,
    );
    auth.state = 'stopped';

    let attempts = 0;
    const create = client.create;
    client.create = async (params, options) => {
      attempts += 1;
      if (attempts === 1)
        throw new Error('Total disk limit exceeded. Maximum allowed: 30GiB.\nUsed: 30GiB.');
      return create(params, options);
    };

    const handle = await provider.create({ name: 'scratch' });

    expect(attempts).toBe(2);
    expect(handle).toEqual({ id: 'sbx-1', kind: 'daytona', status: 'running' });
    expect(sandboxes.get('sbx-1')!.calls).toContain(`run git init in ${DAYTONA_WORKSPACE}`);
    // Only the oldest stopped project sandbox goes; one freed slot is enough for one create.
    expect(oldest.calls).toEqual(['delete']);
    expect(newer.calls).toEqual([]);
    expect(running.calls).toEqual([]);
    expect(auth.calls).toEqual([]);
  });

  it('rethrows the disk cap when there is no stopped project sandbox to evict', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const running = add('running', { 'agent-console/token': 'a' }, 9 * 3_600_000);

    let attempts = 0;
    client.create = async () => {
      attempts += 1;
      throw new Error('Total disk limit exceeded. Maximum allowed: 30GiB.\nUsed: 30GiB.');
    };

    await expect(provider.create({ name: 'scratch' })).rejects.toThrow(/Total disk limit exceeded/);
    expect(attempts).toBe(1);
    expect(running.calls).toEqual([]);
  });

  it('passes the memory cap through, since freeing it would stop a sandbox in use', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const stopped = add('old', { 'agent-console/token': 'a' }, 9 * 3_600_000);
    stopped.state = 'stopped';

    let listed = 0;
    const list = client.list;
    client.list = (query) => {
      listed += 1;
      return list(query);
    };
    let attempts = 0;
    client.create = async () => {
      attempts += 1;
      throw new Error('Total memory limit exceeded. Maximum allowed: 10GiB.\nUsed: 10GiB.');
    };

    await expect(provider.create({ name: 'scratch' })).rejects.toThrow(
      /Total memory limit exceeded/,
    );
    expect(attempts).toBe(1);
    expect(listed).toBe(0);
    expect(stopped.calls).toEqual([]);
  });

  it('wakes a stopped sandbox and relaunches the runner it lost with it', async () => {
    // Down until the relaunch: the first probe is the one that decides.
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = new Response(healthy ? '{"ok":true}' : '', {
          status: healthy ? 200 : 502,
        });
        healthy = true;
        return response;
      }),
    );
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const sandbox = add('sbx', {}, 0);
    sandbox.state = 'stopped';

    await provider.start('sbx');

    expect(sandbox.calls).toEqual([
      'start',
      'session runner',
      'exec runner cd /app/packages/runner && IS_SANDBOX=1 node dist/main.js async=true',
    ]);
  });

  it('leaves a runner that is still answering alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const sandbox = add('sbx', {}, 0);

    await provider.start('sbx');

    expect(sandbox.calls).toEqual([]);
  });

  it('stops a running sandbox once', async () => {
    const { client, add } = fakeClient();
    const provider = new DaytonaProvider({ snapshot: 'runner:1', client });
    const sandbox = add('sbx', {}, 0);

    await provider.stop('sbx');
    await provider.stop('sbx');

    expect(sandbox.calls).toEqual(['stop']);
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
