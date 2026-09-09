import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A project is a folder on this machine; removing one never touches the folder. */
export type Project = {
  id: string;
  name: string;
  repoPath: string;
  addedAt: number;
};

type ProjectsStore = {
  projects: Project[];
  activeProjectId: string | null;
  addProject(repoPath: string, name?: string): Project;
  removeProject(projectId: string): void;
  setActive(projectId: string | null): void;
};

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,

      addProject: (repoPath, name) => {
        const project: Project = {
          id: globalThis.crypto.randomUUID(),
          name: name?.trim() || folderName(repoPath),
          repoPath: repoPath.trim(),
          addedAt: Date.now(),
        };
        set((state) => ({ projects: [...state.projects, project] }));
        return project;
      },

      removeProject: (projectId) =>
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== projectId),
          activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
        })),

      setActive: (projectId) => set({ activeProjectId: projectId }),
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

function folderName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
}
