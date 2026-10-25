import { useTaskStore } from "../stores/taskStore";
import { useTodoStore } from "../stores/todoStore";
import { useSettingsStore } from "../stores/settingsStore";
import { STALE_CLEANUP_INTERVAL_MS } from "../utils/constants";
import { createTransport, type ProgressTransport } from "./index";

let activeTransport: ProgressTransport | null = null;

export function getActiveTransport(): ProgressTransport | null {
  return activeTransport;
}

/**
 * Wire the appropriate transport (Tauri local, cloud SSE, or both) into Zustand stores.
 * Call once at app startup; returns a cleanup function.
 */
export async function initProgressTransport(options?: {
  mode?: "auto" | "tauri" | "cloud" | "composite";
  /** Override cloud config (web dashboard passes explicit values) */
  cloud?: {
    enabled?: boolean;
    baseUrl: string;
    readToken: string;
    writeToken?: string;
    forwardLocalEvents?: boolean;
    agentName?: string;
  } | null;
}): Promise<() => void> {
  const settings = useSettingsStore.getState();
  const cloudFromSettings = settings.cloud;
  const cloudOpt = options?.cloud;

  const cloudEnabled =
    cloudOpt?.enabled !== undefined
      ? cloudOpt.enabled
      : cloudFromSettings.enabled && Boolean(cloudFromSettings.baseUrl && cloudFromSettings.readToken);

  const cloud =
    cloudEnabled && (cloudOpt?.baseUrl || cloudFromSettings.baseUrl)
      ? {
          baseUrl: cloudOpt?.baseUrl || cloudFromSettings.baseUrl,
          readToken: cloudOpt?.readToken || cloudFromSettings.readToken,
          writeToken: cloudOpt?.writeToken || cloudFromSettings.writeToken || undefined,
          forwardLocalEvents:
            cloudOpt?.forwardLocalEvents ?? cloudFromSettings.forwardLocalEvents,
          agentName: cloudOpt?.agentName || cloudFromSettings.agentName || "desktop",
        }
      : null;

  const transport = createTransport({
    mode: options?.mode || "auto",
    cloud,
  });
  activeTransport = transport;

  const cleanup = await transport.connect({
    onTaskEvent: (event) => useTaskStore.getState().handleTaskEvent(event),
    onTodos: (todos) => useTodoStore.getState().setTodos(todos),
    onDownload: (event) => useTaskStore.getState().handleDownload(event),
    onSnapshot: (state) => {
      useTaskStore.getState().applySnapshot(state);
      useTodoStore.getState().setTodos(state.todos || []);
    },
    onConnectionChange: (status, detail) => {
      useTaskStore.getState().setConnection(status, detail);
    },
  });

  const cleanupInterval = setInterval(() => {
    useTaskStore.getState().cleanupStaleTasks();
  }, STALE_CLEANUP_INTERVAL_MS);

  return () => {
    cleanup();
    clearInterval(cleanupInterval);
    activeTransport = null;
  };
}
