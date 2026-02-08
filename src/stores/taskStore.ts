import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { Task, TaskEvent, DownloadProgressEvent } from "../types";
import { MAX_COMPLETED_TASKS, STALE_THRESHOLD_MS, STALE_CLEANUP_INTERVAL_MS } from "../utils/constants";

interface TaskState {
  // Store derived arrays directly to avoid re-computation issues
  activeTasks: Task[];
  completedTasks: Task[];
  isVisible: boolean;

  // Internal task map (not directly subscribed to)
  _taskMap: Map<string, Task>;

  // Actions
  addTask: (event: TaskEvent) => void;
  completeTask: (taskId: string, timestamp: number, isError: boolean) => void;
  cancelTask: (taskId: string) => void;
  clearSession: () => void;
  clearCompleted: () => void;
  setIsVisible: (visible: boolean) => void;
  updateDownloadProgress: (taskId: string, percent: number) => void;
  cleanupStaleTasks: () => void;
}

// Helper to derive active/completed arrays from map
function deriveTaskArrays(taskMap: Map<string, Task>) {
  const tasks = Array.from(taskMap.values());
  return {
    activeTasks: tasks.filter((t) => t.status === "active"),
    completedTasks: tasks
      .filter((t) => t.status === "completed" || t.status === "error")
      .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
      .slice(0, MAX_COMPLETED_TASKS),
  };
}

export const useTaskStore = create<TaskState>()((set) => ({
  activeTasks: [],
  completedTasks: [],
  isVisible: true,
  _taskMap: new Map(),

  addTask: (event) =>
    set((state) => {
      const taskMap = new Map(state._taskMap);

      // Clean up stale active tasks from same session
      if (event.session_id) {
        for (const [id, task] of taskMap) {
          if (
            task.status === "active" &&
            task.sessionId === event.session_id &&
            id !== event.task_id &&
            event.timestamp - task.startTime > 2000
          ) {
            taskMap.delete(id);
          }
        }
      }

      taskMap.set(event.task_id, {
        id: event.task_id,
        tool: event.tool || "Unknown",
        description: event.description || "Running...",
        startTime: event.timestamp,
        status: "active",
        background: event.background || false,
        subagentType: event.subagent_type,
        sessionId: event.session_id,
      });

      return { _taskMap: taskMap, isVisible: true, ...deriveTaskArrays(taskMap) };
    }),

  completeTask: (taskId, timestamp, isError) =>
    set((state) => {
      const taskMap = new Map(state._taskMap);
      const existing = taskMap.get(taskId);
      if (existing) {
        taskMap.set(taskId, {
          ...existing,
          status: isError ? "error" : "completed",
          endTime: timestamp,
        });
      }
      return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
    }),

  cancelTask: (taskId) =>
    set((state) => {
      const taskMap = new Map(state._taskMap);
      taskMap.delete(taskId);
      return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
    }),

  clearSession: () =>
    set((state) => {
      const taskMap = new Map(state._taskMap);
      for (const [id, task] of taskMap) {
        if (task.status === "active") {
          taskMap.delete(id);
        }
      }
      return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
    }),

  clearCompleted: () =>
    set((state) => {
      const taskMap = new Map(state._taskMap);
      for (const [id, task] of taskMap) {
        if (task.status !== "active") {
          taskMap.delete(id);
        }
      }
      return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
    }),

  setIsVisible: (visible) => set({ isVisible: visible }),

  updateDownloadProgress: (taskId, percent) =>
    set((state) => {
      const taskMap = new Map(state._taskMap);
      const task = taskMap.get(taskId);
      if (task && task.status === "active") {
        taskMap.set(taskId, { ...task, downloadProgress: percent });
        return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
      }
      return state;
    }),

  cleanupStaleTasks: () =>
    set((state) => {
      const now = Date.now();
      let hasStale = false;

      for (const task of state._taskMap.values()) {
        if (task.status === "active" && now - task.startTime > STALE_THRESHOLD_MS) {
          hasStale = true;
          break;
        }
      }

      if (!hasStale) return state;

      const taskMap = new Map(state._taskMap);
      for (const [id, task] of taskMap) {
        if (task.status === "active" && now - task.startTime > STALE_THRESHOLD_MS) {
          taskMap.delete(id);
        }
      }
      return { _taskMap: taskMap, ...deriveTaskArrays(taskMap) };
    }),
}));

/** Initialize Tauri event listeners - call once at app startup */
export function initTaskListeners(): () => void {
  const unlisteners: Promise<() => void>[] = [];

  // Task events from backend
  unlisteners.push(
    listen<TaskEvent>("task-event", (event) => {
      const data = event.payload;
      const store = useTaskStore.getState();

      switch (data.type) {
        case "task_started":
          store.addTask(data);
          break;
        case "task_complete":
          store.completeTask(data.task_id, data.timestamp, false);
          break;
        case "task_error":
          store.completeTask(data.task_id, data.timestamp, true);
          break;
        case "task_canceled":
          store.cancelTask(data.task_id);
          break;
        case "session_stopped":
          store.clearSession();
          break;
      }
    })
  );

  // Download progress
  unlisteners.push(
    listen<DownloadProgressEvent>("download-progress", (event) => {
      const data = event.payload;
      const taskMap = useTaskStore.getState()._taskMap;

      // Find active download task
      for (const [id, task] of taskMap) {
        if (task.status === "active") {
          const desc = task.description.toLowerCase();
          if (desc.includes("curl") || desc.includes("wget") || desc.includes("download")) {
            useTaskStore.getState().updateDownloadProgress(id, data.percent);
            break;
          }
        }
      }
    })
  );

  // Periodic stale cleanup
  const cleanupInterval = setInterval(() => {
    useTaskStore.getState().cleanupStaleTasks();
  }, STALE_CLEANUP_INTERVAL_MS);

  return () => {
    unlisteners.forEach((p) => p.then((fn) => fn()));
    clearInterval(cleanupInterval);
  };
}
