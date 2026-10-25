import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import {
  AuthError,
  requireSession,
  userCanAccessWorkspace,
} from "../lib/auth.js";
import { generateId, generateToken, hashToken } from "../lib/crypto.js";

export const workspaceRoutes = new Hono();

workspaceRoutes.get("/", (c) => {
  const session = requireSession(c);
  const rows = getDb()
    .prepare(
      `SELECT w.id, w.name, w.slug, w.created_at, m.role
       FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ?
       ORDER BY w.created_at ASC`
    )
    .all(session.userId);
  return c.json({ workspaces: rows });
});

workspaceRoutes.post("/", async (c) => {
  const session = requireSession(c);
  const body = z
    .object({
      name: z.string().min(1).max(120),
      slug: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
    })
    .parse(await c.req.json());

  const db = getDb();
  const now = Date.now();
  const id = generateId("ws");
  let slug =
    body.slug ||
    body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  let n = 1;
  const base = slug;
  while (db.prepare(`SELECT 1 FROM workspaces WHERE slug = ?`).get(slug)) {
    slug = `${base}-${n++}`;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, body.name, slug, session.userId, now);
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
    ).run(id, session.userId, now);
  });
  tx();

  return c.json({ workspace: { id, name: body.name, slug } }, 201);
});

workspaceRoutes.get("/:id", (c) => {
  const session = requireSession(c);
  const id = c.req.param("id");
  if (!userCanAccessWorkspace(session.userId, id)) {
    throw new AuthError(403, "Forbidden");
  }
  const workspace = getDb()
    .prepare(`SELECT id, name, slug, created_at FROM workspaces WHERE id = ?`)
    .get(id);
  if (!workspace) return c.json({ error: "Not found" }, 404);
  return c.json({ workspace });
});

workspaceRoutes.get("/:id/tokens", (c) => {
  const session = requireSession(c);
  const id = c.req.param("id");
  if (!userCanAccessWorkspace(session.userId, id)) {
    throw new AuthError(403, "Forbidden");
  }
  const tokens = getDb()
    .prepare(
      `SELECT id, kind, name, token_prefix, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE workspace_id = ?
       ORDER BY created_at DESC`
    )
    .all(id);
  return c.json({ tokens });
});

workspaceRoutes.post("/:id/tokens", async (c) => {
  const session = requireSession(c);
  const id = c.req.param("id");
  if (!userCanAccessWorkspace(session.userId, id)) {
    throw new AuthError(403, "Forbidden");
  }
  const body = z
    .object({
      kind: z.enum(["write", "read"]),
      name: z.string().min(1).max(120),
    })
    .parse(await c.req.json());

  const raw = generateToken(body.kind === "write" ? "apw" : "apr");
  const tokenId = generateId("tok");
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO api_tokens
        (id, workspace_id, kind, name, token_hash, token_prefix, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tokenId,
      id,
      body.kind,
      body.name,
      hashToken(raw),
      raw.slice(0, 10),
      session.userId,
      now
    );

  return c.json(
    {
      token: {
        id: tokenId,
        kind: body.kind,
        name: body.name,
        token_prefix: raw.slice(0, 10),
        created_at: now,
      },
      // Shown once — never stored in plaintext
      secret: raw,
    },
    201
  );
});

workspaceRoutes.post("/:id/tokens/:tokenId/revoke", (c) => {
  const session = requireSession(c);
  const id = c.req.param("id");
  const tokenId = c.req.param("tokenId");
  if (!userCanAccessWorkspace(session.userId, id)) {
    throw new AuthError(403, "Forbidden");
  }
  getDb()
    .prepare(
      `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ?`
    )
    .run(Date.now(), tokenId, id);
  return c.json({ ok: true });
});

workspaceRoutes.get("/:id/agents", (c) => {
  const session = requireSession(c);
  const id = c.req.param("id");
  if (!userCanAccessWorkspace(session.userId, id)) {
    throw new AuthError(403, "Forbidden");
  }
  const agents = getDb()
    .prepare(
      `SELECT id, name, source, label, created_at, last_seen_at
       FROM agents WHERE workspace_id = ?
       ORDER BY COALESCE(last_seen_at, created_at) DESC`
    )
    .all(id);
  return c.json({ agents });
});

workspaceRoutes.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: err.message }, err.status as 401);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request", details: err.flatten() }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
