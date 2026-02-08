import type { Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  position: "bottom-right",
  alwaysOnTop: true,
  opacity: 95,
  maxRecentTasks: 5,
  autoHide: false,
};

export const STORAGE_KEY = "progress-overlay-settings";

/** Max completed tasks to keep in memory */
export const MAX_COMPLETED_TASKS = 50;

/** Stale task threshold in ms (5 minutes) */
export const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Stale cleanup interval in ms (30 seconds) */
export const STALE_CLEANUP_INTERVAL_MS = 30_000;

/** Auto-hide delay in ms */
export const AUTO_HIDE_DELAY_MS = 3000;
