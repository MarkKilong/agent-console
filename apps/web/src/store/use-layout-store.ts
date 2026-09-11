import type { TerminalShell } from '@agent-console/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The surfaces the right panel can open. Files and Diff are single-instance; a
 * terminal is one tab per shell the user starts, so it carries its own identity.
 */
export type Surface =
  | { kind: 'files' }
  | { kind: 'diff' }
  | { kind: 'terminal'; id: string; title: string; shell: TerminalShell };

/** Tab identity: everything but a terminal is its kind. */
export function surfaceKey(surface: Surface): string {
  return surface.kind === 'terminal' ? `terminal:${surface.id}` : surface.kind;
}

/** What a terminal tab is called once the runner has resolved the shell. */
export const SHELL_TITLES: Record<TerminalShell, string> = {
  powershell: 'PowerShell',
  bash: 'Git Bash',
  cmd: 'cmd',
  default: 'Terminal',
};

/** "PowerShell", then "PowerShell 2" — the runner names the shell, the strip numbers it. */
export function nextTitle(tabs: Surface[], shell: TerminalShell, title?: string): string {
  const base = title ?? SHELL_TITLES[shell];
  const taken = new Set(tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.title));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

const DIFF: Surface = { kind: 'diff' };

type LayoutStore = {
  sidebarOpen: boolean;
  tabs: Surface[];
  /** Null hides the panel; the tabs are kept so re-opening restores them. */
  activeTab: Surface | null;
  /** The shell a new terminal tab starts on, when the runner reports it installed. */
  defaultShell: TerminalShell;
  toggleSidebar(): void;
  toggleRight(): void;
  openTab(surface: Surface): void;
  closeTab(surface: Surface): void;
  setTerminalShell(id: string, shell: TerminalShell): void;
  setDefaultShell(shell: TerminalShell): void;
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      tabs: [DIFF],
      activeTab: DIFF,
      defaultShell: 'powershell',

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      toggleRight: () =>
        set((state) => {
          if (state.activeTab) return { activeTab: null };
          const tabs = state.tabs.length > 0 ? state.tabs : [DIFF];
          return { tabs, activeTab: tabs[0] ?? null };
        }),

      openTab: (surface) =>
        set((state) => {
          const key = surfaceKey(surface);
          const existing = state.tabs.find((tab) => surfaceKey(tab) === key);
          return {
            tabs: existing ? state.tabs : [...state.tabs, surface],
            activeTab: existing ?? surface,
          };
        }),

      closeTab: (surface) =>
        set((state) => {
          const key = surfaceKey(surface);
          const index = state.tabs.findIndex((tab) => surfaceKey(tab) === key);
          if (index === -1) return state;
          const tabs = state.tabs.filter((tab) => surfaceKey(tab) !== key);
          if (!state.activeTab || surfaceKey(state.activeTab) !== key) return { tabs };
          // The neighbour that slid into its place, else the one before it.
          return { tabs, activeTab: tabs[index] ?? tabs.at(-1) ?? null };
        }),

      setTerminalShell: (id, shell) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.kind === 'terminal' && tab.id === id);
          const current = state.tabs[index];
          // Same shell: leaving the state untouched is what keeps the surface from restarting.
          if (current?.kind !== 'terminal' || current.shell === shell) return state;
          const next: Surface = { ...current, shell, title: nextTitle(state.tabs, shell) };
          return {
            tabs: state.tabs.map((tab, at) => (at === index ? next : tab)),
            activeTab:
              state.activeTab && surfaceKey(state.activeTab) === surfaceKey(next)
                ? next
                : state.activeTab,
          };
        }),

      setDefaultShell: (shell) => set({ defaultShell: shell }),
    }),
    {
      name: 'agent-console.layout',
      skipHydration: true,
      version: 2,
      migrate: migrateLayout,
    },
  ),
);

/**
 * Version 0 stored a single `rightOpen` flag; the panel was the diff and nothing else.
 * Version 1 stored surfaces as bare strings, before terminals made them objects.
 *
 * Fields added since — `defaultShell` — need no bump: persist merges over the initial
 * state, so a blob missing one simply keeps the initial value.
 */
export function migrateLayout(persisted: unknown, version: number): unknown {
  if (version >= 2) return persisted;

  if (version === 1) {
    const state = (persisted ?? {}) as {
      sidebarOpen?: boolean;
      tabs?: string[];
      activeTab?: string | null;
    };
    return {
      sidebarOpen: state.sidebarOpen ?? true,
      tabs: (state.tabs ?? ['diff']).map((kind) => ({ kind })),
      activeTab: state.activeTab ? { kind: state.activeTab } : null,
    };
  }

  const state = (persisted ?? {}) as { sidebarOpen?: boolean; rightOpen?: boolean };
  return {
    sidebarOpen: state.sidebarOpen ?? true,
    tabs: [DIFF],
    activeTab: state.rightOpen === false ? null : DIFF,
  };
}
