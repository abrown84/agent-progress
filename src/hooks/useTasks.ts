import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

export interface Task {
  id: string;
  tool: string;
  description: string;
  startTime: number;
  endTime?: number;
  status: "active" | "completed" | "error";
  background: boolean;
  subagentType?: string;
}

interface TaskEvent {
  type: "start" | "complete" | "error";
  task_id: string;
  tool?: string;
  description?: string;
  session_id?: string;
  timestamp: number;
  background?: boolean;
  subagent_type?: string;
  duration_ms?: number;
}

const MAX_COMPLETED_TASKS = 5;
const STALE_TASK_TIMEOUT = 30000; // 30 seconds - auto-complete stale tasks

export function useTasks() {
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [isVisible, setIsVisible] = useState(true);
  const [hideTimeout, setHideTimeout] = useState<NodeJS.Timeout | null>(null);

  const activeTasks = Array.from(tasks.values()).filter(
    (t) => t.status === "active"
  );
  const completedTasks = Array.from(tasks.values())
    .filter((t) => t.status === "completed" || t.status === "error")
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(0, MAX_COMPLETED_TASKS);

  const resetHideTimer = useCallback(() => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    setIsVisible(true);
    // Auto-hide disabled - overlay always visible
  }, [hideTimeout]);

  useEffect(() => {
    console.log("[useTasks] Setting up event listener...");

    const unlisten = listen<TaskEvent>("task-event", (event) => {
      console.log("[useTasks] RAW EVENT:", JSON.stringify(event));
      console.log("[useTasks] PAYLOAD:", JSON.stringify(event.payload));
      const data = event.payload;
      console.log("[useTasks] Processing type:", data.type, "task_id:", data.task_id);

      setTasks((prev) => {
        const next = new Map(prev);

        if (data.type === "start") {
          next.set(data.task_id, {
            id: data.task_id,
            tool: data.tool || "Unknown",
            description: data.description || "Running...",
            startTime: data.timestamp,
            status: "active",
            background: data.background || false,
            subagentType: data.subagent_type,
          });
        } else if (data.type === "complete" || data.type === "error") {
          const existing = next.get(data.task_id);
          if (existing) {
            next.set(data.task_id, {
              ...existing,
              status: data.type === "error" ? "error" : "completed",
              endTime: data.timestamp,
            });
          }
        }

        return next;
      });

      resetHideTimer();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [resetHideTimer]);

  // Keep visible while tasks are active
  useEffect(() => {
    if (activeTasks.length > 0) {
      setIsVisible(true);
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        setHideTimeout(null);
      }
    }
  }, [activeTasks.length, hideTimeout]);

  // Auto-complete stale tasks that never received a completion event
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => {
        let hasChanges = false;
        const next = new Map(prev);
        for (const [id, task] of next) {
          if (task.status === "active" && now - task.startTime > STALE_TASK_TIMEOUT) {
            next.set(id, { ...task, status: "error", endTime: now });
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => {
      const next = new Map(prev);
      for (const [id, task] of next) {
        if (task.status !== "active") {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  return {
    activeTasks,
    completedTasks,
    isVisible,
    clearCompleted,
    setIsVisible,
  };
}
