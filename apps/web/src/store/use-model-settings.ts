import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomModel } from '@/lib/models';

/** Which models the composer picker may offer. Only the exceptions are stored. */
type ModelSettings = {
  disabled: string[];
  /** Ids the CLI never reported, typed in by hand. */
  custom: CustomModel[];
  toggle(id: string): void;
  addCustom(id: string, name?: string): void;
  removeCustom(id: string): void;
};

export const useModelSettings = create<ModelSettings>()(
  persist(
    (set) => ({
      disabled: [],
      custom: [],
      toggle: (id) =>
        set((state) => ({
          disabled: state.disabled.includes(id)
            ? state.disabled.filter((other) => other !== id)
            : [...state.disabled, id],
        })),
      addCustom: (id, name) =>
        set((state) => ({ custom: [...state.custom, { id, name: name?.trim() || id }] })),
      removeCustom: (id) =>
        set((state) => ({
          custom: state.custom.filter((model) => model.id !== id),
          disabled: state.disabled.filter((other) => other !== id),
        })),
    }),
    { name: 'agent-console.models', skipHydration: true },
  ),
);
