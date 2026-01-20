import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/notification.css";

interface TaskData {
  task_id: string;
  tool: string;
  description: string;
  subagent_type?: string;
  background?: boolean;
}

interface ProgressUpdate {
  task_id: string;
  percent: number; // 0-100
  speed?: string;
  eta?: string;
}

interface TaskComplete {
  task_id: string;
  status: "complete" | "error";
}

const TOOL_ICONS: Record<string, string> = {
  Bash: "terminal",
  Task: "cpu",
  Read: "file",
  Write: "pencil",
  Edit: "edit",
  Glob: "search",
  Grep: "search",
  WebFetch: "globe",
  WebSearch: "globe",
  curl: "download",
  wget: "download",
};

function getIcon(tool: string, desc: string): JSX.Element {
  // Check if it's a download
  const isDownload = desc.includes("curl") || desc.includes("wget") ||
                     desc.toLowerCase().includes("download");

  const iconType = isDownload ? "download" : (TOOL_ICONS[tool] || "info");

  const icons: Record<string, JSX.Element> = {
    terminal: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    cpu: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
      </svg>
    ),
    download: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    file: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      </svg>
    ),
    globe: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      </svg>
    ),
    search: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
    ),
    info: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
      </svg>
    ),
    pencil: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
    edit: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  };

  return icons[iconType] || icons.info;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function NotificationWindow() {
  const [task, setTask] = useState<TaskData | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<"active" | "complete" | "error">("active");
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());

  // Get task data from window label (passed as query param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskData = params.get("task");
    if (taskData) {
      try {
        setTask(JSON.parse(decodeURIComponent(taskData)));
      } catch (e) {
        console.error("Failed to parse task data:", e);
      }
    }
  }, []);

  // Show window once content is ready (prevents flash)
  useEffect(() => {
    if (task) {
      // Small delay to ensure CSS is applied
      requestAnimationFrame(() => {
        invoke("show_notification_ready").catch(console.error);
      });
    }
  }, [task]);

  // Listen for progress updates
  useEffect(() => {
    if (!task) return;

    const unlistenProgress = listen<ProgressUpdate>("download-progress", (event) => {
      if (event.payload.task_id === task.task_id) {
        setProgress(event.payload.percent);
      }
    });

    const unlistenComplete = listen<TaskComplete>("task-complete", (event) => {
      if (event.payload.task_id === task.task_id) {
        setProgress(100); // Fill bar to 100% on completion
        setStatus(event.payload.status);
        // Auto-close after 2 seconds
        setTimeout(async () => {
          const win = getCurrentWindow();
          await win.close();
        }, 2000);
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, [task]);

  // Update elapsed time
  useEffect(() => {
    if (status !== "active") return;

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [status, startTime]);

  if (!task) return null;

  const isDownload = task.description?.includes("curl") ||
                     task.description?.includes("wget") ||
                     task.description?.toLowerCase().includes("download");

  return (
    <div className={`notification ${status}`}>
      <div className="notification-content">
        <div className={`notification-icon ${status}`}>
          {getIcon(task.tool, task.description || "")}
        </div>

        <div className="notification-body">
          <div className="notification-title">
            {task.description || `Running ${task.tool}...`}
          </div>

          {/* Progress bar for downloads or when progress is available */}
          {(isDownload || progress !== null) && (
            <div className="progress-container">
              <div
                className="progress-bar"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          )}

          <div className="notification-meta">
            <span className="notification-time">{formatDuration(elapsed)}</span>
            {progress !== null && (
              <span className="notification-progress">{Math.round(progress)}%</span>
            )}
            {status !== "active" && (
              <span className={`notification-status ${status}`}>
                {status === "complete" ? "Done" : "Failed"}
              </span>
            )}
          </div>
        </div>

        {/* Spinner for active tasks */}
        {status === "active" && !progress && (
          <div className="notification-spinner">
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}

export default NotificationWindow;
