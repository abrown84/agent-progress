import { create } from "zustand";
import type { Task, TaskEvent, DownloadProgressEvent } from "../types";
import type { WorkspaceSnapshot } from "../transport/types";
import { MAX_COMPLETED_TASKS, STALE_THRESHOLD_MS, STALE_CLEANUP_INTERVAL_MS } from "../utils/constants";

interface TaskState {
  activeTasks: Task[];
  completedTasks: Task[];
  isVisible: boolean;
  connectionStatus: "idle" | "connected" | "disconnected" | "error";
  connectionDetail?: string;
  agents: WorkspaceSnapshot["agents"];
  errors: NonNullable<WorkspaceSnapshot["errors"]>;

  _taskMap: Map<string, Task>;

  addTask: (event: TaskEvent) => void;
  completeTask: (taskId: string, timestamp: number, isError: boolean) => void;
  cancelTask: (taskId: string) => void;
  clearSession: () => void;
  clearCompleted: () => void;
  setIsVisible: (visible: boolean) => void;
  updateDownloadProgress: (taskId: string, percent: number) => void;
  cleanupStaleTasks: () => void;
  applySnapshot: (state: WorkspaceSnapshot) => void;
  handleTaskEvent: (data: TaskEvent) => void;
  handleDownload: (data: DownloadProgressEvent) => void;
  setConnection: (
    status: TaskState["connectionStatus"],
    detail?: string
  ) => void;
}

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

export const useTaskStore = create<TaskState>()((set, get) => ({
  activeTasks: [],
  completedTasks: [],
  isVisible: true,
  connectionStatus: "idle",
  agents: [],
  errors: [],
  _taskMap: new Map(),

  addTask: (event) =>
    set((state) => {
      const taskMap = new Map(state._taskMap);

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

  applySnapshot: (state) => {
    const taskMap = new Map<string, Task>();
    for (const t of state.activeTasks || []) {
      taskMap.set(t.id, {
        id: t.id,
        tool: t.tool,
        description: t.description,
        startTime: t.startTime,
        status: "active",
        background: t.background,
        subagentType: t.subagentType,
        sessionId: t.sessionId,
        downloadProgress: t.downloadProgress,
      });
    }
    for (const t of state.recentTasks || []) {
      if (t.status === "canceled") continue;
      taskMap.set(t.id, {
        id: t.id,
        tool: t.tool,
        description: t.description,
        startTime: t.startTime,
        endTime: t.endTime,
        status: t.status === "error" ? "error" : "completed",
        background: t.background,
        subagentType: t.subagentType,
        sessionId: t.sessionId,
      });
    }
    set({
      _taskMap: taskMap,
      ...deriveTaskArrays(taskMap),
      agents: state.agents || [],
      errors: state.errors || [],
      isVisible: true,
    });
  },

  handleTaskEvent: (data) => {
    const store = get();
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
  },

  handleDownload: (data) => {
    const taskMap = get()._taskMap;
    if (taskMap.has(data.task_id)) {
      get().updateDownloadProgress(data.task_id, data.percent);
      return;
    }
    for (const [id, task] of taskMap) {
      if (task.status === "active") {
        const desc = task.description.toLowerCase();
        if (desc.includes("curl") || desc.includes("wget") || desc.includes("download")) {
          get().updateDownloadProgress(id, data.percent);
          break;
        }
      }
    }
  },

  setConnection: (status, detail) => set({ connectionStatus: status, connectionDetail: detail }),
}));

/** @deprecated Prefer initProgressTransport from transport bootstrap */
export function initTaskListeners(): () => void {
  console.warn("initTaskListeners is deprecated; use initProgressTransport");
  const cleanupInterval = setInterval(() => {
    useTaskStore.getState().cleanupStaleTasks();
  }, STALE_CLEANUP_INTERVAL_MS);
  return () => clearInterval(cleanupInterval);
}
