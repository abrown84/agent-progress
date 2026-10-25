import webpush from "web-push";
import { config } from "./config.js";
import { getDb } from "./db.js";
import type { TaskEvent } from "./types.js";

let configured = false;

export function pushEnabled(): boolean {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey
    );
    configured = true;
  }
  return true;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Events that are worth interrupting a phone for. */
const NOTIFY_TYPES: Partial<Record<TaskEvent["type"], string>> = {
  task_complete: "✅ Task complete",
  task_error: "❌ Task failed",
  task_needs_input: "✋ Decision needed",
};

export function notifyTaskEvent(
  workspaceId: string,
  agentId: string | null,
  event: TaskEvent
): void {
  const title = NOTIFY_TYPES[event.type];
  if (!title || !pushEnabled()) return;
  // Background subagent chatter is noisy; still notify on errors/decisions.
  let agentName = "";
  if (agentId) {
    const row = getDb()
      .prepare(`SELECT name, label FROM agents WHERE id = ?`)
      .get(agentId) as { name: string; label: string | null } | undefined;
    agentName = row?.label || row?.name || "";
  }
  const what = [event.tool, event.description].filter(Boolean).join(": ");
  void sendToWorkspace(workspaceId, {
    title: agentName ? `${title} · ${agentName}` : title,
    body: (what || "Agent update").slice(0, 180),
    tag: event.task_id ? `task-${event.task_id}` : undefined,
    url: "/#/dashboard",
  }).catch((e) => console.warn("[push] send failed:", (e as Error).message));
}

export async function sendToWorkspace(
  workspaceId: string,
  msg: PushMessage
): Promise<{ sent: number; removed: number }> {
  if (!pushEnabled()) return { sent: 0, removed: 0 };
  const db = getDb();
  const subs = db
    .prepare(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE workspace_id = ?`
    )
    .all(workspaceId) as SubRow[];
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 3600, urgency: "high" }
        );
        sent++;
        db.prepare(
          `UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?`
        ).run(Date.now(), s.id);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(s.id);
          removed++;
        } else {
          console.warn(`[push] ${code ?? "error"} for sub ${s.id}`);
        }
      }
    })
  );
  return { sent, removed };
}
