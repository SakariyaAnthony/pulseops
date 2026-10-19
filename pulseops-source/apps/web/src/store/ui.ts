import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Density = "comfortable" | "compact";

type UiState = {
  collapsed: boolean;
  live: boolean;
  density: Density;
  commandOpen: boolean;
  source: "mock" | "api";
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setLive: (live: boolean) => void;
  setDensity: (density: Density) => void;
  setCommandOpen: (open: boolean) => void;
  setSource: (source: "mock" | "api") => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      collapsed: false,
      live: true,
      density: "comfortable",
      commandOpen: false,
      source: "mock",
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setLive: (live) => set({ live }),
      setDensity: (density) => set({ density }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setSource: (source) => set({ source }),
    }),
    {
      name: "pulseops-ui",
      partialize: (state) => ({
        collapsed: state.collapsed,
        live: state.live,
        density: state.density,
      }),
    },
  ),
);
