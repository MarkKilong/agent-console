import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * A project is a folder on this machine, a repository URL the provider clones itself, or —
 * on a sandbox deployment — nothing at all, a name whose files live only in its sandbox.
 * Removing one never touches the folder.
 */
export type Project = {
  id: string;
  name: string;
  /** The folder on this machine; absent for a project that lives only in a sandbox. */
  repoPath?: string;
  /** Set for projects the environment provider clones itself. */
  repoUrl?: string;
  /** The sandbox holding the files, so reopening wakes it instead of starting over. */
  environmentId?: string;
  addedAt: number;
};

type ProjectsStore = {
  projects: Project[];
  activeProjectId: string | null;
  /** The folder the last clone landed in, so the next one is offered the same place. */
  cloneParent: string | null;
  addProject(project: Pick<Project, 'name' | 'repoPath' | 'repoUrl'>): Project;
  noteEnvironment(projectId: string, environmentId: string): void;
  removeProject(projectId: string): void;
  setActive(projectId: string | null): void;
  setCloneParent(path: string): void;
};

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      cloneParent: null,

      addProject: ({ name, repoPath, repoUrl }) => {
        const project: Project = {
          id: globalThis.crypto.randomUUID(),
          name: name.trim(),
          ...(repoPath ? { repoPath: repoPath.trim() } : {}),
          ...(repoUrl ? { repoUrl: repoUrl.trim() } : {}),
          addedAt: Date.now(),
        };
        set((state) => ({ projects: [...state.projects, project] }));
        return project;
      },

      noteEnvironment: (projectId, environmentId) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId ? { ...project, environmentId } : project,
          ),
        })),

      removeProject: (projectId) =>
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== projectId),
          activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
        })),

      setActive: (projectId) => set({ activeProjectId: projectId }),

      setCloneParent: (path) => set({ cloneParent: path.trim() || null }),
    }),
    // Rehydrated from app-shell, so the server render and the first client render match.
    { name: 'agent-console.projects', skipHydration: true },
  ),
);

export function useActiveProject(): Project | null {
  return useProjectsStore(
    (state) => state.projects.find((project) => project.id === state.activeProjectId) ?? null,
  );
}
