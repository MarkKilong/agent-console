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
): DaytonaSandbox & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    state: 'started',
    labels,
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
  };
  return { client, created, sandboxes };
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
