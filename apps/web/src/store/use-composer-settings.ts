import type { Effort, PermissionMode } from '@agent-console/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** What the composer's three pickers send with every prompt. */
type ComposerSettings = {
  model: string;
  effort: Effort;
  permissionMode: PermissionMode;
  setModel(model: string): void;
  setEffort(effort: Effort): void;
  setPermissionMode(mode: PermissionMode): void;
};

export const useComposerSettings = create<ComposerSettings>()(
  persist(
    (set) => ({
      model: 'claude-opus-5',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      setPermissionMode: (permissionMode) => set({ permissionMode }),
    }),
    { name: 'agent-console.composer', skipHydration: true },
  ),
);
