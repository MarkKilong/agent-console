import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type LayoutStore = {
  sidebarOpen: boolean;
  rightOpen: boolean;
  toggleSidebar(): void;
  toggleRight(): void;
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      rightOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleRight: () => set((state) => ({ rightOpen: !state.rightOpen })),
    }),
    { name: 'agent-console.layout', skipHydration: true },
  ),
);
