import { getDb } from "./db.js";
import { generateId } from "./crypto.js";
import { publish } from "./bus.js";
import { notifyTaskEvent } from "./push.js";
import type {
  AgentMeta,
  DownloadProgress,
  IngestEnvelope,
  TaskEvent,
  TodoItem,
} from "./types.js";

export function upsertAgent(
  workspaceId: string,
  meta?: AgentMeta
): string | null {
  if (!meta?.name && !meta?.source && !meta?.label) return null;
  const db = getDb();
  const name = meta.name || meta.label || "unnamed-agent";
  const source = meta.source || "custom";
  const label = meta.label || null;
  const now = Date.now();

  const existing = db
    .prepare(
      `SELECT id FROM agents WHERE workspace_id = ? AND name = ? AND source = ?`
    )
    .get(workspaceId, name, source) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE agents SET last_seen_at = ?, label = COALESCE(?, label) WHERE id = ?`
    ).run(now, label, existing.id);
    return existing.id;
  }

  const id = generateId("agt");
  db.prepare(
    `INSERT INTO agents (id, workspace_id, name, source, label, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, workspaceId, name, source, label, now, now);
  return id;
}

export function applyTaskEvent(
  workspaceId: string,
  agentId: string | null,
  event: TaskEvent
): void {
  const db = getDb();
  const now = Date.now();
  const taskId = event.task_id || `session-${event.session_id || "unknown"}`;

  db.prepare(
    `INSERT INTO events (workspace_id, agent_id, event_type, task_id, payload, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    workspaceId,
    agentId,
    event.type,
    event.type === "session_stopped" ? null : taskId,
    JSON.stringify(event),
    event.timestamp,
    now
  );

  switch (event.type) {
    case "task_started": {
      db.prepare(
        `INSERT INTO tasks (
           id, workspace_id, agent_id, tool, description, status, background,
           subagent_type, session_id, start_time, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET
           agent_id = excluded.agent_id,
           tool = excluded.tool,
           description = excluded.description,
           status = 'active',
           background = excluded.background,
           subagent_type = excluded.subagent_type,
           session_id = excluded.session_id,
           start_time = excluded.start_time,
           end_time = NULL,
           duration_ms = NULL,
           updated_at = excluded.updated_at`
      ).run(
        taskId,
        workspaceId,
        agentId,
        event.tool || "Unknown",
        event.description || "Running...",
        event.background ? 1 : 0,
        event.subagent_type || null,
        event.session_id || null,
        event.timestamp,
        now
      );
      break;
    }
    case "task_complete":
    case "task_error":
    case "task_canceled": {
      const status =
        event.type === "task_complete"
          ? "completed"
          : event.type === "task_error"
            ? "error"
            : "canceled";
      db.prepare(
        `UPDATE tasks SET
           status = ?,
           end_time = ?,
           duration_ms = COALESCE(?, duration_ms),
           updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      ).run(
        status,
        event.timestamp,
        event.duration_ms ?? null,
        now,
        workspaceId,
        taskId
      );
      break;
    }
    case "session_stopped": {
      db.prepare(
        `UPDATE tasks SET status = 'canceled', end_time = ?, updated_at = ?
         WHERE workspace_id = ? AND status = 'active'
           AND (? IS NULL OR session_id = ?)`
      ).run(
        event.timestamp,
        now,
        workspaceId,
        event.session_id || null,
        event.session_id || null
      );
      break;
    }
  }

  publish(workspaceId, { kind: "task_event", agent_id: agentId, event });
  notifyTaskEvent(workspaceId, agentId, event);
}

export function applyTodos(
  workspaceId: string,
  agentId: string | null,
  todos: TodoItem[]
): void {
  const db = getDb();
  const now = Date.now();
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM todos WHERE workspace_id = ?`).run(workspaceId);
    const insert = db.prepare(
      `INSERT INTO todos (workspace_id, agent_id, session_id, content, status, active_form, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const todo of todos) {
      insert.run(
        workspaceId,
        agentId,
        todo.session_id || null,
        todo.content,
        todo.status,
        todo.activeForm,
        now
      );
    }
  });
  replace();
  publish(workspaceId, { kind: "todos", agent_id: agentId, todos });
}

export function applyDownload(
  workspaceId: string,
  agentId: string | null,
  download: DownloadProgress
): void {
  const db = getDb();
  db.prepare(
    `UPDATE tasks SET download_progress = ?, updated_at = ?
     WHERE workspace_id = ? AND id = ? AND status = 'active'`
  ).run(download.percent, Date.now(), workspaceId, download.task_id);

  db.prepare(
    `INSERT INTO events (workspace_id, agent_id, event_type, task_id, payload, timestamp, created_at)
     VALUES (?, ?, 'download', ?, ?, ?, ?)`
  ).run(
    workspaceId,
    agentId,
    download.task_id,
    JSON.stringify(download),
    download.timestamp,
    Date.now()
  );

  publish(workspaceId, { kind: "download", agent_id: agentId, download });
}

export function ingestEnvelope(
  workspaceId: string,
  envelope: IngestEnvelope
): { accepted: number; agent_id: string | null } {
  const agentId = upsertAgent(workspaceId, envelope.agent);
  let accepted = 0;

  const events: TaskEvent[] = [];
  if (envelope.event) events.push(envelope.event);
  if (envelope.events?.length) events.push(...envelope.events);

  // Also accept a bare TaskEvent body (handled by route before calling here).
  for (const event of events) {
    applyTaskEvent(workspaceId, agentId, event);
    accepted += 1;
  }

  if (envelope.todos) {
    applyTodos(workspaceId, agentId, envelope.todos);
    accepted += 1;
  }

  if (envelope.download) {
    applyDownload(workspaceId, agentId, envelope.download);
    accepted += 1;
  }

  if (agentId) {
    getDb()
      .prepare(`UPDATE agents SET last_seen_at = ? WHERE id = ?`)
      .run(Date.now(), agentId);
  }

  return { accepted, agent_id: agentId };
}
