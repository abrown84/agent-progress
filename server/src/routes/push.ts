import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { config } from "../lib/config.js";
import { AuthError, requireSession, userCanAccessWorkspace } from "../lib/auth.js";
import { generateId } from "../lib/crypto.js";
import { pushEnabled, sendToWorkspace } from "../lib/push.js";

export const pushRoutes = new Hono();

const subscribeSchema = z.object({
  workspaceId: z.string().min(1),
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
});

pushRoutes.get("/vapid-public-key", (c) => {
  if (!pushEnabled()) return c.json({ enabled: false, publicKey: null });
  return c.json({ enabled: true, publicKey: config.vapidPublicKey });
});

pushRoutes.post("/subscribe", async (c) => {
  const session = requireSession(c);
  if (!pushEnabled()) return c.json({ error: "Push not configured" }, 503);
  const body = subscribeSchema.parse(await c.req.json());
  if (!userCanAccessWorkspace(session.userId, body.workspaceId)) {
    throw new AuthError(403, "No access to workspace");
  }
  const { endpoint, keys } = body.subscription;
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions
         (id, workspace_id, user_id, endpoint, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent`
    )
    .run(
      generateId("push"),
      body.workspaceId,
      session.userId,
      endpoint,
      keys.p256dh,
      keys.auth,
      (c.req.header("User-Agent") || "").slice(0, 300),
      Date.now()
    );
  return c.json({ ok: true });
});

pushRoutes.post("/unsubscribe", async (c) => {
  const session = requireSession(c);
  const body = z.object({ endpoint: z.string().min(1) }).parse(await c.req.json());
  getDb()
    .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`)
    .run(body.endpoint, session.userId);
  return c.json({ ok: true });
});

pushRoutes.post("/test", async (c) => {
  const session = requireSession(c);
  const body = z.object({ workspaceId: z.string().min(1) }).parse(await c.req.json());
  if (!userCanAccessWorkspace(session.userId, body.workspaceId)) {
    throw new AuthError(403, "No access to workspace");
  }
  const result = await sendToWorkspace(body.workspaceId, {
    title: "Agent Progress",
    body: "Notifications are working 🎉",
    tag: "test",
    url: "/#/dashboard",
  });
  return c.json({ ok: true, ...result });
});

pushRoutes.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status as 401);
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request", details: err.flatten() }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
