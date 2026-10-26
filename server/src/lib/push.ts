import webpush from "web-push";
import { config } from "./config.js";
import { getDb } from "./db.js";
import type { TaskEvent } from "./types.js";

let vapidReady = false;

export interface PushMessage {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export interface NotifyPrefs {
  notifyCompletions: boolean;
  quietUntil: number | null;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Events that are worth interrupting a phone for. */
export const NOTIFY_TYPES: Partial<Record<TaskEvent["type"], string>> = {
  task_complete: "✅ Task complete",
  task_error: "❌ Task failed",
  task_needs_input: "✋ Decision needed",
};

const DEDUPE_TTL_MS = 90_000;
const recentNotifyKeys = new Map<string, number>();

function pruneDedupe(now: number): void {
  for (const [k, ts] of recentNotifyKeys) {
    if (now - ts > DEDUPE_TTL_MS) recentNotifyKeys.delete(k);
  }
}

/** Exported for tests — clear in-memory dedupe window. */
export function resetNotifyDedupe(): void {
  recentNotifyKeys.clear();
}

function kvGet(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_kv WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function kvSet(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

/**
 * Ensure VAPID keys exist: env → persisted DB → generate once.
 * Makes Web Push work out of the box without a manual key dance.
 */
export function ensureVapidKeys(): { publicKey: string; privateKey: string } | null {
  let publicKey = config.vapidPublicKey;
  let privateKey = config.vapidPrivateKey;

  if (!publicKey || !privateKey) {
    publicKey = kvGet("vapid_public_key") || "";
    privateKey = kvGet("vapid_private_key") || "";
  }

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    kvSet("vapid_public_key", publicKey);
    kvSet("vapid_private_key", privateKey);
    console.log("[push] Generated and persisted VAPID keys (set VAPID_* in .env to pin them)");
  }

  // Keep config in sync so /vapid-public-key and setVapidDetails share one source.
  config.vapidPublicKey = publicKey;
  config.vapidPrivateKey = privateKey;

  if (!vapidReady) {
    webpush.setVapidDetails(config.vapidSubject, publicKey, privateKey);
    vapidReady = true;
  }
  return { publicKey, privateKey };
}

export function pushEnabled(): boolean {
  if (vapidReady && config.vapidPublicKey && config.vapidPrivateKey) return true;
  return Boolean(ensureVapidKeys());
}

export function relayEnabled(): boolean {
  return Boolean(config.relayNotifyUrl && config.relayNotifyToken);
}

export function getNotifyPrefs(workspaceId: string): NotifyPrefs {
  const row = getDb()
    .prepare(
      `SELECT notify_completions, quiet_until FROM workspace_notify_prefs WHERE workspace_id = ?`
    )
    .get(workspaceId) as
    | { notify_completions: number; quiet_until: number | null }
    | undefined;
  return {
    notifyCompletions: row ? Boolean(row.notify_completions) : true,
    quietUntil: row?.quiet_until ?? null,
  };
}

export function setNotifyPrefs(
  workspaceId: string,
  patch: Partial<NotifyPrefs>
): NotifyPrefs {
  const current = getNotifyPrefs(workspaceId);
  const next: NotifyPrefs = {
    notifyCompletions:
      patch.notifyCompletions !== undefined
        ? patch.notifyCompletions
        : current.notifyCompletions,
    quietUntil: patch.quietUntil !== undefined ? patch.quietUntil : current.quietUntil,
  };
  getDb()
    .prepare(
      `INSERT INTO workspace_notify_prefs (workspace_id, notify_completions, quiet_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         notify_completions = excluded.notify_completions,
         quiet_until = excluded.quiet_until,
         updated_at = excluded.updated_at`
    )
    .run(
      workspaceId,
      next.notifyCompletions ? 1 : 0,
      next.quietUntil,
      Date.now()
    );
  return next;
}

/**
 * Decide whether an event should produce a phone alert.
 * Pure enough for unit tests (prefs + dedupe + background filter).
 */
export function shouldNotifyEvent(
  workspaceId: string,
  event: TaskEvent,
  prefs: NotifyPrefs = getNotifyPrefs(workspaceId),
  now = Date.now()
): { ok: true; title: string } | { ok: false; reason: string } {
  const title = NOTIFY_TYPES[event.type];
  if (!title) return { ok: false, reason: "event_type_not_notifiable" };

  if (prefs.quietUntil && now < prefs.quietUntil) {
    return { ok: false, reason: "quiet" };
  }

  if (event.type === "task_complete" && !prefs.notifyCompletions) {
    return { ok: false, reason: "completions_muted" };
  }

  // Background subagent completions are noisy; still notify on errors/decisions.
  if (event.type === "task_complete" && event.background) {
    return { ok: false, reason: "background_complete" };
  }

  const dedupeKey = `${workspaceId}:${event.type}:${event.task_id || "none"}`;
  pruneDedupe(now);
  const last = recentNotifyKeys.get(dedupeKey);
  if (last !== undefined && now - last < DEDUPE_TTL_MS) {
    return { ok: false, reason: "deduped" };
  }
  recentNotifyKeys.set(dedupeKey, now);

  return { ok: true, title };
}

export function buildPushMessage(
  title: string,
  agentName: string,
  event: TaskEvent
): PushMessage {
  const what = [event.tool, event.description].filter(Boolean).join(": ");
  return {
    title: agentName ? `${title} · ${agentName}` : title,
    body: (what || "Agent update").slice(0, 180),
    tag: event.task_id ? `task-${event.task_id}-${event.type}` : undefined,
    url: "/#/dashboard",
  };
}

export function notifyTaskEvent(
  workspaceId: string,
  agentId: string | null,
  event: TaskEvent
): void {
  if (!pushEnabled() && !relayEnabled()) return;

  const decision = shouldNotifyEvent(workspaceId, event);
  if (!decision.ok) return;

  let agentName = "";
  if (agentId) {
    const row = getDb()
      .prepare(`SELECT name, label FROM agents WHERE id = ?`)
      .get(agentId) as { name: string; label: string | null } | undefined;
    agentName = row?.label || row?.name || "";
  }

  const msg = buildPushMessage(decision.title, agentName, event);
  if (pushEnabled()) {
    void sendToWorkspace(workspaceId, msg).catch((e) =>
      console.warn("[push] send failed:", (e as Error).message)
    );
  }
  void sendToRelay(msg);
}

/** Forward an alert to the BRWN Text relay, which delivers it to the paired phone. Never throws. */
export async function sendToRelay(msg: PushMessage): Promise<boolean> {
  if (!relayEnabled()) return false;
  const link = msg.url
    ? new URL(msg.url, config.publicUrl).toString()
    : config.publicUrl;
  try {
    const res = await fetch(config.relayNotifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.relayNotifyToken}`,
      },
      body: JSON.stringify({
        title: msg.title,
        body: msg.body,
        link,
        source: "agent-progress",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`[relay] notify HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn("[relay] notify failed:", (e as Error).message);
    return false;
  }
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

export function countSubscriptions(workspaceId: string, userId?: string): number {
  if (userId) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM push_subscriptions WHERE workspace_id = ? AND user_id = ?`
      )
      .get(workspaceId, userId) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE workspace_id = ?`)
    .get(workspaceId) as { n: number };
  return row.n;
}
