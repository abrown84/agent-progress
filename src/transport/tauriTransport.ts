import type { ProgressHandlers, ProgressTransport, PlatformActions } from "./types";
import type { DownloadProgressEvent, TaskEvent, TodoItem } from "../types";

async function safeInvoke(cmd: string, args?: Record<string, unknown>): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd, args);
  } catch (err) {
    console.warn(`invoke(${cmd}) failed`, err);
  }
}

export function createTauriTransport(): ProgressTransport {
  const actions: PlatformActions = {
    hideWindow: () => safeInvoke("hide_window"),
    showWindow: () => safeInvoke("show_window"),
    closeApp: () => safeInvoke("close_app"),
    clearEvents: () => safeInvoke("clear_events"),
    toggleDevtools: () => safeInvoke("toggle_devtools"),
    setWindowPosition: (position) => safeInvoke("set_window_position", { position }),
    setAlwaysOnTop: (enabled) => safeInvoke("set_always_on_top", { enabled }),
  };

  return {
    kind: "tauri",
    actions,
    async connect(handlers: ProgressHandlers) {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisteners: Array<() => void> = [];

      unlisteners.push(
        await listen<TaskEvent>("task-event", (event) => {
          handlers.onTaskEvent(event.payload);
        })
      );

      unlisteners.push(
        await listen<TodoItem[]>("todos-update", (event) => {
          handlers.onTodos(event.payload || []);
        })
      );

      unlisteners.push(
        await listen<DownloadProgressEvent>("download-progress", (event) => {
          handlers.onDownload?.(event.payload);
        })
      );

      handlers.onConnectionChange?.("connected", "local");

      return () => {
        unlisteners.forEach((fn) => fn());
        handlers.onConnectionChange?.("disconnected", "local");
      };
    },
  };
}
