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
  sessionId?: string;
}

interface TaskEvent {
  type: "task_started" | "task_complete" | "task_error" | "session_stopped";
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

        if (data.type === "task_started") {
          // Clean up stale active tasks from the same session
          // If a new task starts while old ones are still "active", the old ones were likely canceled
          if (data.session_id) {
            const now = data.timestamp;
            for (const [id, task] of next) {
              if (
                task.status === "active" &&
                task.sessionId === data.session_id &&
                id !== data.task_id &&
                // If the old task started more than 2 seconds before this new one, it's stale
                now - task.startTime > 2000
              ) {
                console.log("[useTasks] Removing stale task:", id);
                next.delete(id);
              }
            }
          }

          next.set(data.task_id, {
            id: data.task_id,
            tool: data.tool || "Unknown",
            description: data.description || "Running...",
            startTime: data.timestamp,
            status: "active",
            background: data.background || false,
            subagentType: data.subagent_type,
            sessionId: data.session_id,
          });
        } else if (data.type === "task_complete" || data.type === "task_error") {
          const existing = next.get(data.task_id);
          if (existing) {
            next.set(data.task_id, {
              ...existing,
              status: data.type === "task_error" ? "error" : "completed",
              endTime: data.timestamp,
            });
          }
        } else if (data.type === "session_stopped") {
          // Clear all active tasks when session is stopped (user hit Escape/canceled)
          for (const [id, task] of next) {
            if (task.status === "active") {
              next.delete(id);
            }
          }
          console.log("[useTasks] Session stopped - cleared all active tasks");
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

  // Periodic cleanup of very stale tasks (safety net for canceled tasks)
  useEffect(() => {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    const cleanup = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => {
        let hasStale = false;
        for (const [, task] of prev) {
          if (task.status === "active" && now - task.startTime > STALE_THRESHOLD_MS) {
            hasStale = true;
            break;
          }
        }

        if (!hasStale) return prev;

        const next = new Map(prev);
        for (const [id, task] of next) {
          if (task.status === "active" && now - task.startTime > STALE_THRESHOLD_MS) {
            console.log("[useTasks] Removing very stale task:", id);
            next.delete(id);
          }
        }
        return next;
      });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(cleanup);
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
