import { useConsoleStore } from '@/store/use-console-store';
import { useProjectsStore, type Project } from '@/store/use-projects-store';

/**
 * Makes one project the open environment: the previous runner is destroyed, a new
 * one is created for this folder, and the console store is pointed at it.
 */
export async function openProject(project: Project): Promise<void> {
  await closeCurrentEnvironment();

  const response = await fetch('/api/environments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath: project.repoPath }),
  });
  const body = (await response.json()) as
    { id: string; url: string; token: string } | { error: string };
  if (!response.ok || !('id' in body)) {
    throw new Error('error' in body ? body.error : 'Could not open the environment');
  }

  useConsoleStore.getState().openEnvironment({ ...body, repoPath: project.repoPath });
  useProjectsStore.getState().setActive(project.id);
}

/** Leaves no project open: used when the active one is removed from the list. */
export async function closeProject(): Promise<void> {
  await closeCurrentEnvironment();
  useProjectsStore.getState().setActive(null);
}

async function closeCurrentEnvironment(): Promise<void> {
  const { environment, closeEnvironment } = useConsoleStore.getState();
  if (!environment) return;
  // Dropped from the store first so nothing keeps talking to a runner that is going away.
  closeEnvironment();
  await fetch(`/api/environments/${environment.id}`, { method: 'DELETE' }).catch(() => {});
}
