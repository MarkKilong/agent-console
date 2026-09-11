import type { ModelInfo } from '@agent-console/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Settings that belong to the project rather than to a single prompt. */
type ProjectSettings = {
  /** Model asked to name new threads; null until one has been chosen by hand. */
  titleModel: string | null;
  setTitleModel(model: string): void;
};

export const useProjectSettings = create<ProjectSettings>()(
  persist(
    (set) => ({
      titleModel: null,
      setTitleModel: (titleModel) => set({ titleModel }),
    }),
    { name: 'agent-console.project', skipHydration: true },
  ),
);

/**
 * Which model names threads. The stored choice when there is one, else the cheapest the
 * CLI lists — a Haiku if it offers one. Empty only while no model is known at all, and
 * then nothing is sent and the runner keeps its title from the prompt.
 */
export function effectiveTitleModel(
  models: ModelInfo[],
  disabled: string[],
  chosen: string | null,
): string {
  if (chosen) return chosen;
  const enabled = models.filter((model) => !disabled.includes(model.id));
  const pick = enabled.find((model) => model.id.includes('haiku')) ?? enabled[0];
  return (pick ?? models[0])?.id ?? '';
}
