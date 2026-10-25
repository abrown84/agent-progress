import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CloudSettings, Settings } from "../types";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../utils/constants";
import { isTauriRuntime } from "../transport";

interface SettingsState extends Settings {
  isLoaded: boolean;

  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateCloudSetting: <K extends keyof CloudSettings>(
    key: K,
    value: CloudSettings[K]
  ) => void;
  resetSettings: () => void;
}

async function applyWindowSideEffect(key: string, value: unknown) {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    if (key === "position") {
      await invoke("set_window_position", { position: value as string });
    } else if (key === "alwaysOnTop") {
      await invoke("set_always_on_top", { enabled: value as boolean });
    }
  } catch (err) {
    console.error(err);
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      isLoaded: true,

      updateSetting: (key, value) => {
        set({ [key]: value } as Partial<SettingsState>);
        if (key === "position" || key === "alwaysOnTop") {
          void applyWindowSideEffect(key, value);
        }
      },

      updateCloudSetting: (key, value) => {
        const cloud = { ...get().cloud, [key]: value };
        set({ cloud });
      },

      resetSettings: () => {
        set({ ...DEFAULT_SETTINGS });
        void applyWindowSideEffect("position", DEFAULT_SETTINGS.position);
        void applyWindowSideEffect("alwaysOnTop", DEFAULT_SETTINGS.alwaysOnTop);
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        position: state.position,
        alwaysOnTop: state.alwaysOnTop,
        opacity: state.opacity,
        maxRecentTasks: state.maxRecentTasks,
        autoHide: state.autoHide,
        cloud: state.cloud,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<Settings>;
        return {
          ...current,
          ...p,
          cloud: { ...DEFAULT_SETTINGS.cloud, ...(p.cloud || {}) },
        };
      },
    }
  )
);

export const selectSettings = (state: SettingsState): Settings => ({
  position: state.position,
  alwaysOnTop: state.alwaysOnTop,
  opacity: state.opacity,
  maxRecentTasks: state.maxRecentTasks,
  autoHide: state.autoHide,
  cloud: state.cloud,
});
