#!/usr/bin/env tsx
/**
 * Smoke test: seed → ingest events → snapshot → SSE receives updates.
 * Spawns the server in-process via fetch against a temporary DB.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Point at a temp database before importing app modules that open the DB.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-smoke-"));
const dbPath = path.join(tmpDir, "smoke.db");
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = "smoke-test-secret";
process.env.ALLOW_SIGNUPS = "false";
process.env.SEED_OWNER_EMAIL = "";
process.env.SEED_OWNER_PASSWORD = "";
process.env.PUBLIC_WEB_DIR = path.join(tmpDir, "missing-web");

const { getDb, closeDb } = await import("../src/lib/db.js");
const { seedOwner } = await import("../src/lib/seed.js");
const { authRoutes } = await import("../src/routes/auth.js");
const { workspaceRoutes } = await import("../src/routes/workspaces.js");
const { apiRoutes } = await import("../src/routes/events.js");

const app = new Hono();
app.use("*", cors());
app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/auth", authRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api", apiRoutes);
getDb();

const server = serve({ fetch: app.fetch, port: 0 });
await new Promise<void>((r) => setTimeout(r, 50));

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to bind smoke server");
}
const base = `http://127.0.0.1:${address.port}`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

try {
  const seeded = seedOwner({
    email: "alex@brwnindustries.com",
    password: "smoke-test-password-123",
    workspaceName: "Smoke Workspace",
    workspaceSlug: "smoke",
    createTokens: true,
  });
  assert(seeded.writeToken && seeded.readToken, "tokens missing from seed");

  const writeToken = seeded.writeToken!;
  const readToken = seeded.readToken!;

  // Start SSE before posting so we catch the live event
  const sseAbort = new AbortController();
  const ssePromise = (async () => {
    const res = await fetch(`${base}/api/events/stream`, {
      headers: { Authorization: `Bearer ${readToken}` },
      signal: sseAbort.signal,
    });
    assert(res.ok && res.body, `SSE failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawSnapshot = false;
    let sawTask = false;
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline && !(sawSnapshot && sawTask)) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: snapshot")) sawSnapshot = true;
      if (buffer.includes("task_started") || buffer.includes("event: task_event")) {
        sawTask = true;
      }
    }
    try {
      sseAbort.abort();
    } catch {
      /* ignore */
    }
    return { sawSnapshot, sawTask };
  })();

  await new Promise((r) => setTimeout(r, 200));

  const ingest = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${writeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent: { name: "smoke-bot", source: "claude-code", label: "Smoke" },
      events: [
        {
          type: "task_started",
          task_id: "smoke-1",
          tool: "Bash",
          description: "npm test",
          timestamp: Date.now(),
          session_id: "smoke-session",
        },
      ],
      todos: [
        {
          content: "Run smoke test",
          status: "in_progress",
          activeForm: "Running smoke test",
        },
      ],
    }),
  });
  const ingestJson = (await ingest.json()) as {
    ok?: boolean;
    accepted?: number;
    error?: string;
  };
  assert(
    ingest.ok && ingestJson.ok && (ingestJson.accepted ?? 0) >= 1,
    `ingest failed: ${ingest.status} ${JSON.stringify(ingestJson)}`
  );
  const stateRes = await fetch(`${base}/api/state`, {
    headers: { Authorization: `Bearer ${readToken}` },
  });
  assert(stateRes.ok, `state failed: ${stateRes.status}`);
  const state = (await stateRes.json()) as {
    activeTasks: Array<{ id: string }>;
    todos: unknown[];
    agents: Array<{ name: string }>;
  };
  assert(
    state.activeTasks.some((t) => t.id === "smoke-1"),
    "active task missing from snapshot"
  );
  assert(state.todos.length >= 1, "todos missing from snapshot");
  assert(
    state.agents.some((a) => a.name === "smoke-bot"),
    "agent label missing"
  );

  const sse = await ssePromise;
  assert(sse.sawSnapshot, "SSE never sent snapshot");
  assert(sse.sawTask, "SSE never forwarded task_started");

  // Complete the task and verify state
  const complete = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${writeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "task_complete",
      task_id: "smoke-1",
      duration_ms: 42,
      timestamp: Date.now(),
    }),
  });
  assert(complete.ok, "complete failed");

  const state2 = (await (
    await fetch(`${base}/api/state`, {
      headers: { Authorization: `Bearer ${readToken}` },
    })
  ).json()) as {
    activeTasks: unknown[];
    recentTasks: Array<{ id: string; status: string }>;
  };
  assert(state2.activeTasks.length === 0, "task still active after complete");
  assert(
    state2.recentTasks.some((t) => t.id === "smoke-1" && t.status === "completed"),
    "completed task missing from history"
  );

  console.log("SMOKE OK: ingest → state → SSE → complete");
  process.exitCode = 0;
} catch (err) {
  console.error("SMOKE FAILED:", err);
  process.exitCode = 1;
} finally {
  server.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
