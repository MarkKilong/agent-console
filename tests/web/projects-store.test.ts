import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectsStore } from '../../apps/web/src/store/use-projects-store.js';

beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, cloneParent: null });
});

describe('projects store', () => {
  it('adds a project that is nothing but a name', () => {
    const project = useProjectsStore.getState().addProject({ name: '  scratch  ' });

    expect(project.name).toBe('scratch');
    expect(project.repoPath).toBeUndefined();
    expect(project.repoUrl).toBeUndefined();
    expect(project.environmentId).toBeUndefined();
  });

  // The whole project is persisted, so this is also what a reload gets back.
  it('remembers the environment one project was opened in, and only that one', () => {
    const project = useProjectsStore.getState().addProject({ name: 'scratch' });
    useProjectsStore.getState().addProject({ name: 'other' });

    useProjectsStore.getState().noteEnvironment(project.id, 'sbx-1');

    expect(useProjectsStore.getState().projects[0]!.environmentId).toBe('sbx-1');
    expect(useProjectsStore.getState().projects[1]!.environmentId).toBeUndefined();
  });
});
