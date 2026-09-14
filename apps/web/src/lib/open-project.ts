import { reusableEnvironments } from '@/lib/deployment';
import { useConsoleStore } from '@/store/use-console-store';
import { useProjectsStore, type Project } from '@/store/use-projects-store';

type Environment = { id: string; url: string; token: string; repoPath: string };

const WAKING = 'Waking environment…';
const LOST =
  'That sandbox is gone, so this project started from an empty folder. Push to GitHub to keep work beyond a couple of hours.';

/**
 * Makes one project the open environment: the previous one is handed back, this project's
 * own is woken where it still exists and created where it does not, and the console store
 * is pointed at it.
 */
export async function openProject(project: Project): Promise<void> {
  await releaseCurrentEnvironment();
  // Waking a stopped sandbox takes a moment, and nothing else would say why.
  if (project.environmentId) useConsoleStore.getState().setNotice(WAKING);

  try {
    const resumed = project.environmentId ? await resume(project.environmentId) : null;
    const environment = resumed ?? (await create(project));
    useConsoleStore.getState().openEnvironment(environment);
    // A sandbox that expired took a blank project's only copy of its files with it.
    if (!resumed && project.environmentId && !project.repoUrl) {
      useConsoleStore.getState().setNotice(LOST);
    }
    if (reusableEnvironments) {
      useProjectsStore.getState().noteEnvironment(project.id, environment.id);
    }
    useProjectsStore.getState().setActive(project.id);
  } catch (cause) {
    useConsoleStore.getState().setNotice(null);
    throw cause;
  }
}

/** Leaves no project open: used when the active one is removed from the list. */
export async function closeProject(): Promise<void> {
  await releaseCurrentEnvironment();
  useProjectsStore.getState().setActive(null);
}

/** Forgetting a project throws its environment away for good; nothing will reopen it. */
export async function removeProject(project: Project): Promise<void> {
  if (project.id === useProjectsStore.getState().activeProjectId) await closeProject();
  if (project.environmentId) {
    await fetch(`/api/environments/${project.environmentId}`, { method: 'DELETE' }).catch(() => {});
  }
  useProjectsStore.getState().removeProject(project.id);
}

/** The sandbox that came back still holds the files; a 404 means it is gone for good. */
async function resume(environmentId: string): Promise<Environment | null> {
  const response = await fetch(`/api/environments/${environmentId}/resume`, { method: 'POST' });
  if (!response.ok) return null;
  return (await response.json()) as Environment;
}

async function create(project: Project): Promise<Environment> {
  const response = await fetch('/api/environments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      project.repoUrl
        ? { repoUrl: project.repoUrl }
        : project.repoPath
          ? { repoPath: project.repoPath }
          : { name: project.name },
    ),
  });
  const body = (await response.json()) as Environment | { error: string };
  if (!response.ok || !('id' in body)) {
    throw new Error('error' in body ? body.error : 'Could not open the environment');
  }
  return body;
}

/**
 * Hands the open environment back. A sandbox is stopped, so its files survive for the next
 * open; a local runner has nothing worth keeping and is destroyed.
 */
async function releaseCurrentEnvironment(): Promise<void> {
  const { environment, closeEnvironment } = useConsoleStore.getState();
  if (!environment) return;
  // Dropped from the store first so nothing keeps talking to a runner that is going away.
  closeEnvironment();
  const url = `/api/environments/${environment.id}`;
  await fetch(reusableEnvironments ? `${url}/stop` : url, {
    method: reusableEnvironments ? 'POST' : 'DELETE',
  }).catch(() => {});
}
