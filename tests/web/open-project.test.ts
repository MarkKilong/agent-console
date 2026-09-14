import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsoleStore } from '../../apps/web/src/store/use-console-store.js';
import { useProjectsStore } from '../../apps/web/src/store/use-projects-store.js';

// Read once, at import, by the module under test: this is the sandbox deployment.
process.env.NEXT_PUBLIC_ENV_PROVIDER = 'daytona';
const { openProject } = await import('../../apps/web/src/lib/open-project.js');

const calls: string[] = [];

function stubFetch(respond: (url: string) => Response): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return respond(url);
    }),
  );
}

function environment(id: string): Response {
  const body = { id, url: `wss://${id}`, token: 't', repoPath: '/workspace/repo' };
  return new Response(JSON.stringify(body), { status: 200 });
}

/** A project already opened once, so it has a sandbox to go back to. */
function openedOnce(name: string, environmentId: string) {
  const project = useProjectsStore.getState().addProject({ name });
  useProjectsStore.getState().noteEnvironment(project.id, environmentId);
  return useProjectsStore.getState().projects.find((row) => row.id === project.id)!;
}

beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, cloneParent: null });
  useConsoleStore.getState().closeEnvironment();
  useConsoleStore.getState().setNotice(null);
});

afterEach(() => vi.unstubAllGlobals());

describe('openProject', () => {
  it('wakes the sandbox a project remembers instead of making a new one', async () => {
    const project = openedOnce('scratch', 'sbx-1');
    stubFetch(() => environment('sbx-1'));

    await openProject(project);

    expect(calls).toEqual(['POST /api/environments/sbx-1/resume']);
    expect(useConsoleStore.getState().environment).toMatchObject({
      id: 'sbx-1',
      repoPath: '/workspace/repo',
    });
    expect(useConsoleStore.getState().notice).toBeNull();
    expect(useProjectsStore.getState().activeProjectId).toBe(project.id);
  });

  it('creates a new sandbox when the old one is gone, and says the folder is empty again', async () => {
    const project = openedOnce('scratch', 'sbx-1');
    stubFetch((url) =>
      url.endsWith('/resume')
        ? new Response('{"error":"gone"}', { status: 404 })
        : environment('sbx-2'),
    );

    await openProject(project);

    expect(calls).toEqual(['POST /api/environments/sbx-1/resume', 'POST /api/environments']);
    expect(useProjectsStore.getState().projects[0]!.environmentId).toBe('sbx-2');
    expect(useConsoleStore.getState().notice).toMatch(/empty folder/);
  });

  it('stops the sandbox it is leaving rather than destroying it', async () => {
    const first = openedOnce('scratch', 'sbx-1');
    const second = openedOnce('other', 'sbx-2');
    stubFetch((url) => environment(url.includes('sbx-2') ? 'sbx-2' : 'sbx-1'));

    await openProject(first);
    await openProject(second);

    expect(calls).toEqual([
      'POST /api/environments/sbx-1/resume',
      'POST /api/environments/sbx-1/stop',
      'POST /api/environments/sbx-2/resume',
    ]);
  });
});
