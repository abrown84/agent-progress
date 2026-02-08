/** Core task model used across the app */
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
  downloadProgress?: number;
}

/** Raw task event from the Rust backend */
export interface TaskEvent {
  type: "task_started" | "task_complete" | "task_error" | "task_canceled" | "session_stopped";
  task_id: string;
  tool?: string;
  description?: string;
  session_id?: string;
  timestamp: number;
  background?: boolean;
  subagent_type?: string;
  duration_ms?: number;
}

/** Download progress event from the backend */
export interface DownloadProgressEvent {
  task_id: string;
  percent: number;
  speed?: string;
  eta?: string;
  timestamp: number;
}

/** Todo item from the backend */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
  session_id?: string;
}

/** Window position options */
export type WindowPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** User-facing settings */
export interface Settings {
  position: WindowPosition;
  alwaysOnTop: boolean;
  opacity: number;
  maxRecentTasks: number;
  autoHide: boolean;
}

/** Tool display configuration */
export interface ToolConfig {
  label: string;
  icon: string;
}
