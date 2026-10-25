import { getDb } from "./db.js";
import type { TodoItem, WorkspaceState } from "./types.js";

export function buildWorkspaceState(workspaceId: string): WorkspaceState {
  const db = getDb();

  const workspace = db
    .prepare(`SELECT id, name, slug FROM workspaces WHERE id = ?`)
    .get(workspaceId) as { id: string; name: string; slug: string } | undefined;

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const agents = db
    .prepare(
      `SELECT id, name, source, label, last_seen_at
       FROM agents WHERE workspace_id = ?
       ORDER BY COALESCE(last_seen_at, created_at) DESC`
    )
    .all(workspaceId) as WorkspaceState["agents"];

  const activeRows = db
    .prepare(
      `SELECT id, agent_id, tool, description, start_time, background,
              subagent_type, session_id, download_progress
       FROM tasks
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY start_time DESC
       LIMIT 200`
    )
    .all(workspaceId) as Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    start_time: number;
    background: number;
    subagent_type: string | null;
    session_id: string | null;
    download_progress: number | null;
  }>;

  const recentRows = db
    .prepare(
      `SELECT id, agent_id, tool, description, start_time, end_time, status,
              background, subagent_type, session_id, duration_ms
       FROM tasks
       WHERE workspace_id = ? AND status IN ('completed', 'error', 'canceled')
       ORDER BY COALESCE(end_time, start_time) DESC
       LIMIT 100`
    )
    .all(workspaceId) as Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    start_time: number;
    end_time: number | null;
    status: "completed" | "error" | "canceled";
    background: number;
    subagent_type: string | null;
    session_id: string | null;
    duration_ms: number | null;
  }>;

  const errorRows = db
    .prepare(
      `SELECT id, agent_id, tool, description, start_time, end_time
       FROM tasks
       WHERE workspace_id = ? AND status = 'error'
       ORDER BY COALESCE(end_time, start_time) DESC
       LIMIT 50`
    )
    .all(workspaceId) as Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    start_time: number;
    end_time: number | null;
  }>;

  const todoRows = db
    .prepare(
      `SELECT content, status, active_form, session_id
       FROM todos
       WHERE workspace_id = ?
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all(workspaceId) as Array<{
    content: string;
    status: TodoItem["status"];
    active_form: string;
    session_id: string | null;
  }>;

  return {
    workspace,
    agents,
    activeTasks: activeRows.map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      tool: r.tool,
      description: r.description,
      startTime: r.start_time,
      status: "active" as const,
      background: Boolean(r.background),
      subagentType: r.subagent_type || undefined,
      sessionId: r.session_id || undefined,
      downloadProgress: r.download_progress ?? undefined,
    })),
    recentTasks: recentRows.map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      tool: r.tool,
      description: r.description,
      startTime: r.start_time,
      endTime: r.end_time ?? undefined,
      status: r.status,
      background: Boolean(r.background),
      subagentType: r.subagent_type || undefined,
      sessionId: r.session_id || undefined,
      duration_ms: r.duration_ms ?? undefined,
    })),
    todos: todoRows.map((t) => ({
      content: t.content,
      status: t.status,
      activeForm: t.active_form,
      session_id: t.session_id || undefined,
    })),
    errors: errorRows.map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      tool: r.tool,
      description: r.description,
      startTime: r.start_time,
      endTime: r.end_time ?? undefined,
    })),
  };
}
