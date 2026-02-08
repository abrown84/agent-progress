import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../types";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../utils/constants";

interface SettingsState extends Settings {
  isLoaded: boolean;

  // Actions
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      isLoaded: true,

      updateSetting: (key, value) => {
        set({ [key]: value });

        // Apply side effects
        if (key === "position") {
          invoke("set_window_position", { position: value as string }).catch(
            console.error
          );
        } else if (key === "alwaysOnTop") {
          invoke("set_always_on_top", { enabled: value as boolean }).catch(
            console.error
          );
        }
      },

      resetSettings: () => {
        set({ ...DEFAULT_SETTINGS });
        invoke("set_window_position", { position: DEFAULT_SETTINGS.position }).catch(
          console.error
        );
        invoke("set_always_on_top", { enabled: DEFAULT_SETTINGS.alwaysOnTop }).catch(
          console.error
        );
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
      }),
    }
  )
);

// Selectors
export const selectSettings = (state: SettingsState): Settings => ({
  position: state.position,
  alwaysOnTop: state.alwaysOnTop,
  opacity: state.opacity,
  maxRecentTasks: state.maxRecentTasks,
  autoHide: state.autoHide,
});
