import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export type WindowPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface Settings {
  position: WindowPosition;
  alwaysOnTop: boolean;
  opacity: number;
  maxRecentTasks: number;
  autoHide: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  position: "bottom-right",
  alwaysOnTop: true,
  opacity: 95,
  maxRecentTasks: 5,
  autoHide: false,
};

const STORAGE_KEY = "progress-overlay-settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch {
        // Invalid JSON, use defaults
      }
    }
    setIsLoaded(true);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings, isLoaded]);

  // Apply window position when it changes
  useEffect(() => {
    if (!isLoaded) return;
    invoke("set_window_position", { position: settings.position }).catch(console.error);
  }, [settings.position, isLoaded]);

  // Apply always-on-top when it changes
  useEffect(() => {
    if (!isLoaded) return;
    invoke("set_always_on_top", { enabled: settings.alwaysOnTop }).catch(console.error);
  }, [settings.alwaysOnTop, isLoaded]);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, updateSetting, resetSettings, isLoaded };
}
