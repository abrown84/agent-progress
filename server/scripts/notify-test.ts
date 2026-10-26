#!/usr/bin/env tsx
/**
 * Notification-path tests: VAPID auto-provision, shouldNotify filters,
 * dedupe, prefs, subscribe + test endpoint behavior (no real FCM needed).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-notify-"));
const dbPath = path.join(tmpDir, "notify.db");
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = "notify-test-secret";
process.env.ALLOW_SIGNUPS = "false";
process.env.SEED_OWNER_EMAIL = "";
process.env.SEED_OWNER_PASSWORD = "";
process.env.PUBLIC_WEB_DIR = path.join(tmpDir, "missing-web");
// Force auto-generate path (no env VAPID)
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.RELAY_NOTIFY_URL = "";
process.env.RELAY_NOTIFY_TOKEN = "";

const { getDb, closeDb } = await import("../src/lib/db.js");
const { seedOwner } = await import("../src/lib/seed.js");
const { authRoutes } = await import("../src/routes/auth.js");
const { workspaceRoutes } = await import("../src/routes/workspaces.js");
const { pushRoutes } = await import("../src/routes/push.js");
const { apiRoutes } = await import("../src/routes/events.js");
  const {
  ensureVapidKeys,
  pushEnabled,
  shouldNotifyEvent,
  resetNotifyDedupe,
  setNotifyPrefs,
  getNotifyPrefs,
  notifyTaskEvent,
  countSubscriptions,
  buildPushMessage,
} = await import("../src/lib/push.js");

const app = new Hono();
app.use("*", cors({ origin: "*", credentials: true }));
app.route("/api/auth", authRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/push", pushRoutes);
app.route("/api", apiRoutes);
getDb();
ensureVapidKeys();

const server = serve({ fetch: app.fetch, port: 0 });
await new Promise<void>((r) => setTimeout(r, 50));
const address = server.address();
if (!address || typeof address === "string") throw new Error("bind failed");
const base = `http://127.0.0.1:${address.port}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length
    ? raw
    : (res.headers.get("set-cookie") || "").split(/,(?=\s*[^;]+=)/);
  const session = list.find((c) => c.trim().startsWith("ap_session="));
  assert(session, "missing session cookie");
  return session!.split(";")[0]!.trim();
}

try {
  assert(pushEnabled(), "push should be enabled after ensureVapidKeys");
  const keys = ensureVapidKeys();
  assert(keys && keys.publicKey.length > 20, "public key missing");

  // Persist: second ensure should reuse DB keys
  const again = ensureVapidKeys();
  assert(again!.publicKey === keys!.publicKey, "VAPID keys should be stable");

  const seeded = seedOwner({
    email: "notify@brwnindustries.com",
    password: "notify-test-password-123",
    workspaceName: "Notify Workspace",
    workspaceSlug: "notify",
    createTokens: true,
  });
  assert(seeded.workspaceId, "workspace missing");
  const ws = seeded.workspaceId;

  resetNotifyDedupe();
  const complete = {
    type: "task_complete" as const,
    task_id: "t1",
    tool: "Bash",
    description: "done",
    timestamp: Date.now(),
  };
  const errEvent = {
    type: "task_error" as const,
    task_id: "t2",
    tool: "Bash",
    description: "boom",
    timestamp: Date.now(),
  };
  const needs = {
    type: "task_needs_input" as const,
    task_id: "t3",
    tool: "Ask",
    description: "pick one",
    timestamp: Date.now(),
  };
  const started = {
    type: "task_started" as const,
    task_id: "t4",
    tool: "Bash",
    description: "start",
    timestamp: Date.now(),
  };

  assert(shouldNotifyEvent(ws, complete).ok, "complete should notify");
  assert(!shouldNotifyEvent(ws, complete).ok, "complete should dedupe");
  resetNotifyDedupe();
  assert(
    !shouldNotifyEvent(ws, { ...complete, background: true }).ok,
    "background complete skipped"
  );
  assert(shouldNotifyEvent(ws, errEvent).ok, "error should notify");
  assert(shouldNotifyEvent(ws, needs).ok, "needs_input should notify");
  assert(!shouldNotifyEvent(ws, started).ok, "started should not notify");

  const deep = buildPushMessage("❌ Task failed", "CI Agent", errEvent);
  assert(
    deep.url?.includes("task=t2") && deep.url?.includes("agent=CI"),
    `deep link missing task/agent: ${deep.url}`
  );

  setNotifyPrefs(ws, { notifyCompletions: false });
  resetNotifyDedupe();
  assert(!shouldNotifyEvent(ws, complete).ok, "completions muted");
  assert(shouldNotifyEvent(ws, errEvent).ok, "errors still notify when muted completions");

  setNotifyPrefs(ws, { notifyCompletions: true, quietUntil: Date.now() + 60_000 });
  resetNotifyDedupe();
  assert(!shouldNotifyEvent(ws, errEvent).ok, "quiet blocks");
  setNotifyPrefs(ws, { quietUntil: null });
  assert(getNotifyPrefs(ws).quietUntil === null, "quiet cleared");

  // HTTP: login → vapid key → subscribe fake → test complains about invalid endpoint gracefully
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "notify@brwnindustries.com",
      password: "notify-test-password-123",
    }),
  });
  assert(login.ok, `login failed ${login.status}`);
  const cookie = cookieFrom(login);

  const vapid = await fetch(`${base}/api/push/vapid-public-key`);
  const vapidJson = (await vapid.json()) as { enabled: boolean; publicKey: string };
  assert(vapidJson.enabled && vapidJson.publicKey, "vapid endpoint disabled");

  const statusBefore = await fetch(`${base}/api/push/status?workspaceId=${ws}`, {
    headers: { Cookie: cookie },
  });
  assert(statusBefore.ok, "status failed");
  const statusJson = (await statusBefore.json()) as { pushEnabled: boolean };
  assert(statusJson.pushEnabled, "status.pushEnabled false");

  const subRes = await fetch(`${base}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      workspaceId: ws,
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/notify-test-endpoint",
        keys: {
          p256dh: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64url"),
          auth: Buffer.from("0123456789abcdef").toString("base64url"),
        },
      },
    }),
  });
  assert(subRes.ok, `subscribe failed ${subRes.status} ${await subRes.text()}`);
  assert(countSubscriptions(ws) === 1, "subscription not stored");

  const testRes = await fetch(`${base}/api/push/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ workspaceId: ws }),
  });
  // Fake FCM endpoint should fail send; endpoint may be removed (410/404) or error.
  // Either ok:false (no successful send) or ok:true if somehow sent — assert it doesn't 500.
  assert(testRes.status !== 500, `test crashed: ${testRes.status}`);
  const testJson = (await testRes.json()) as { ok?: boolean; push?: { sent: number } };
  assert("ok" in testJson || "error" in testJson, "test response shape");

  // Ingest notify path should not throw
  resetNotifyDedupe();
  notifyTaskEvent(ws, null, {
    type: "task_error",
    task_id: "ingest-err",
    tool: "Test",
    description: "from notify-test",
    timestamp: Date.now(),
  });

  // Prefs HTTP
  const prefsRes = await fetch(`${base}/api/push/prefs`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      workspaceId: ws,
      notifyCompletions: false,
      quietMinutes: 30,
    }),
  });
  assert(prefsRes.ok, "prefs patch failed");
  const prefsJson = (await prefsRes.json()) as {
    prefs: { notifyCompletions: boolean; quietActive: boolean };
  };
  assert(prefsJson.prefs.notifyCompletions === false, "prefs not saved");
  assert(prefsJson.prefs.quietActive === true, "quiet not active");

  // Agent write token still works for events that would notify
  const writeToken = seeded.writeToken!;
  const ingest = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${writeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "task_needs_input",
      task_id: "decide-1",
      tool: "AskUser",
      description: "Approve deploy?",
      timestamp: Date.now(),
    }),
  });
  assert(ingest.ok, `ingest needs_input failed ${ingest.status}`);

  console.log("NOTIFY OK: vapid · filters · dedupe · prefs · subscribe · test · ingest");
  process.exitCode = 0;
} catch (err) {
  console.error("NOTIFY FAILED:", err);
  process.exitCode = 1;
} finally {
  server.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
