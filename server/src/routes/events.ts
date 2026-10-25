import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AuthError, authenticateApiToken } from "../lib/auth.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { config } from "../lib/config.js";
import { ingestEnvelope } from "../lib/ingest.js";
import { buildWorkspaceState } from "../lib/state.js";
import { subscribe } from "../lib/bus.js";
import {
  IngestEnvelopeSchema,
  TaskEventSchema,
  type IngestEnvelope,
} from "../lib/types.js";
import { z } from "zod";

export const apiRoutes = new Hono();

apiRoutes.post("/events", async (c) => {
  let auth;
  try {
    auth = authenticateApiToken(c, "write");
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status as 401);
    throw e;
  }

  const rl = checkRateLimit(
    `write:${auth.tokenId}`,
    config.writeRateLimitMax,
    config.rateLimitWindowMs
  );
  if (!rl.ok) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const json = await c.req.json();
  let envelope: IngestEnvelope;

  // Accept either a full envelope, a single TaskEvent, or an array of TaskEvents.
  if (Array.isArray(json)) {
    const events = z.array(TaskEventSchema).parse(json);
    envelope = { events };
  } else if (json && typeof json === "object" && "type" in json) {
    const event = TaskEventSchema.parse(json);
    envelope = { event };
  } else {
    envelope = IngestEnvelopeSchema.parse(json);
  }

  if (
    !envelope.event &&
    !envelope.events?.length &&
    !envelope.todos &&
    !envelope.download
  ) {
    return c.json({ error: "No events, todos, or download payload provided" }, 400);
  }

  const result = ingestEnvelope(auth.workspaceId, envelope);
  return c.json({ ok: true, ...result });
});

apiRoutes.get("/state", (c) => {
  let auth;
  try {
    auth = authenticateApiToken(c, "read");
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status as 401);
    throw e;
  }

  const rl = checkRateLimit(`read:${auth.tokenId}`);
  if (!rl.ok) return c.json({ error: "Rate limit exceeded" }, 429);

  const state = buildWorkspaceState(auth.workspaceId);
  return c.json(state);
});

apiRoutes.get("/events/stream", (c) => {
  let auth;
  try {
    auth = authenticateApiToken(c, "read");
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status as 401);
    throw e;
  }

  const rl = checkRateLimit(`sse:${auth.tokenId}`, 30, 60_000);
  if (!rl.ok) return c.json({ error: "Rate limit exceeded" }, 429);

  const workspaceId = auth.workspaceId;
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const state = buildWorkspaceState(workspaceId);
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify({ kind: "snapshot", state }),
    });

    let closed = false;
    const unsubscribe = subscribe(workspaceId, (payload) => {
      if (closed) return;
      void stream.writeSSE({
        event: payload.kind,
        data: JSON.stringify(payload),
      });
    });

    const ping = setInterval(() => {
      if (closed) return;
      void stream.writeSSE({
        event: "ping",
        data: JSON.stringify({ kind: "ping", ts: Date.now() }),
      });
    }, 15_000);

    stream.onAbort(() => {
      closed = true;
      clearInterval(ping);
      unsubscribe();
    });

    // Keep the handler alive until the client disconnects.
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (closed) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  });
});

apiRoutes.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid event shape", details: err.flatten() }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
