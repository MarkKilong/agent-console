import { create } from 'zustand';

export type DiffScope = 'turn' | 'tree';

/**
 * What the right panel's surfaces are looking at. Not persisted: it is where the
 * user last clicked, and it must survive a tab switch, not a reload.
 */
type PanelStore = {
  diffScope: DiffScope;
  /** Which turn the `turn` scope shows; null means the latest one with a diff. */
  diffTurn: number | null;
  /** One-shot: expand this file in the diff and scroll to it. */
  focusPath: string | null;
  /** The file open in the Files viewer. */
  filesPath: string | null;
  files: string[] | null;
  filesLoading: boolean;
  /** The environment `files` was listed for, so it is loaded once per project. */
  filesEnvId: string | null;
  filesError: string | null;

  setDiffScope(scope: DiffScope): void;
  setDiffTurn(index: number): void;
  showDiffForTurn(index: number): void;
  /** From a tool row: the turn's own diff when it has the file, else the working tree. */
  showDiffForFile(path: string, turnIndex: number | null): void;
  clearFocus(): void;
  openFile(path: string): void;
  startFilesLoad(envId: string): void;
  finishFilesLoad(files: string[] | null, error?: string): void;
};

export const usePanelStore = create<PanelStore>((set) => ({
  diffScope: 'turn',
  diffTurn: null,
  focusPath: null,
  filesPath: null,
  files: null,
  filesLoading: false,
  filesEnvId: null,
  filesError: null,

  setDiffScope: (scope) => set({ diffScope: scope }),
  setDiffTurn: (index) => set({ diffTurn: index }),
  showDiffForTurn: (index) => set({ diffScope: 'turn', diffTurn: index, focusPath: null }),
  showDiffForFile: (path, turnIndex) =>
    set(
      turnIndex === null
        ? { diffScope: 'tree', focusPath: path }
        : { diffScope: 'turn', diffTurn: turnIndex, focusPath: path },
    ),
  clearFocus: () => set({ focusPath: null }),
  openFile: (path) => set({ filesPath: path }),

  startFilesLoad: (envId) =>
    set((state) => {
      // A new project starts from nothing; a Refresh keeps its tree on screen.
      const same = state.filesEnvId === envId;
      return {
        filesEnvId: envId,
        filesLoading: true,
        filesError: null,
        files: same ? state.files : null,
        filesPath: same ? state.filesPath : null,
      };
    }),
  finishFilesLoad: (files, error) => set({ files, filesLoading: false, filesError: error ?? null }),
}));
