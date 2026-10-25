import type { DownloadProgressEvent, TaskEvent, TodoItem } from "../types";

export interface AgentInfo {
  id: string;
  name: string;
  source: string;
  label: string | null;
  last_seen_at: number | null;
}

export interface WorkspaceSnapshot {
  workspace?: { id: string; name: string; slug: string };
  agents?: AgentInfo[];
  activeTasks: Array<{
    id: string;
    agent_id?: string | null;
    tool: string;
    description: string;
    startTime: number;
    status: "active";
    background: boolean;
    subagentType?: string;
    sessionId?: string;
    downloadProgress?: number;
  }>;
  recentTasks: Array<{
    id: string;
    agent_id?: string | null;
    tool: string;
    description: string;
    startTime: number;
    endTime?: number;
    status: "completed" | "error" | "canceled";
    background: boolean;
    subagentType?: string;
    sessionId?: string;
  }>;
  todos: TodoItem[];
  errors?: Array<{
    id: string;
    agent_id?: string | null;
    tool: string;
    description: string;
    startTime: number;
    endTime?: number;
  }>;
}

export interface ProgressHandlers {
  onTaskEvent: (event: TaskEvent) => void;
  onTodos: (todos: TodoItem[]) => void;
  onDownload?: (event: DownloadProgressEvent) => void;
  onSnapshot?: (state: WorkspaceSnapshot) => void;
  onConnectionChange?: (status: "connected" | "disconnected" | "error", detail?: string) => void;
}

export interface PlatformActions {
  hideWindow?: () => Promise<void>;
  showWindow?: () => Promise<void>;
  closeApp?: () => Promise<void>;
  clearEvents?: () => Promise<void>;
  toggleDevtools?: () => Promise<void>;
  setWindowPosition?: (position: string) => Promise<void>;
  setAlwaysOnTop?: (enabled: boolean) => Promise<void>;
}

export interface ProgressTransport {
  readonly kind: "tauri" | "cloud" | "composite";
  connect(handlers: ProgressHandlers): Promise<() => void>;
  actions: PlatformActions;
}

export interface CloudConnectionConfig {
  baseUrl: string;
  readToken: string;
  /** Optional write token used by the desktop forwarder */
  writeToken?: string;
  forwardLocalEvents?: boolean;
  agentName?: string;
  agentSource?: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
