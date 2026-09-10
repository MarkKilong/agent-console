import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The surfaces the right panel can open, one tab each. */
export type Surface = 'files' | 'diff';

type LayoutStore = {
  sidebarOpen: boolean;
  tabs: Surface[];
  /** Null hides the panel; the tabs are kept so re-opening restores them. */
  activeTab: Surface | null;
  toggleSidebar(): void;
  toggleRight(): void;
  openTab(surface: Surface): void;
  closeTab(surface: Surface): void;
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      tabs: ['diff'],
      activeTab: 'diff',

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      toggleRight: () =>
        set((state) => {
          if (state.activeTab) return { activeTab: null };
          const tabs = state.tabs.length > 0 ? state.tabs : (['diff'] as Surface[]);
          return { tabs, activeTab: tabs[0] ?? null };
        }),

      openTab: (surface) =>
        set((state) => ({
          tabs: state.tabs.includes(surface) ? state.tabs : [...state.tabs, surface],
          activeTab: surface,
        })),

      closeTab: (surface) =>
        set((state) => {
          const index = state.tabs.indexOf(surface);
          if (index === -1) return state;
          const tabs = state.tabs.filter((tab) => tab !== surface);
          if (state.activeTab !== surface) return { tabs };
          // The neighbour that slid into its place, else the one before it.
          return { tabs, activeTab: tabs[index] ?? tabs.at(-1) ?? null };
        }),
    }),
    {
      name: 'agent-console.layout',
      skipHydration: true,
      version: 1,
      migrate: migrateLayout,
    },
  ),
);

/** Version 0 stored a single `rightOpen` flag; the panel was the diff and nothing else. */
export function migrateLayout(persisted: unknown, version: number): unknown {
  if (version >= 1) return persisted;
  const state = (persisted ?? {}) as { sidebarOpen?: boolean; rightOpen?: boolean };
  return {
    sidebarOpen: state.sidebarOpen ?? true,
    tabs: ['diff'],
    activeTab: state.rightOpen === false ? null : 'diff',
  };
}
