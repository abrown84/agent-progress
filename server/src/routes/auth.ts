import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "../lib/config.js";
import { getDb } from "../lib/db.js";
import {
  generateId,
  hashPassword,
  hashToken,
  signSession,
  verifyPassword,
} from "../lib/crypto.js";
import { getSession, AuthError } from "../lib/auth.js";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
  workspaceName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const magicRequestSchema = z.object({
  email: z.string().email(),
});

export const authRoutes = new Hono();

authRoutes.get("/me", (c) => {
  const session = getSession(c);
  if (!session) return c.json({ user: null });
  const user = getDb()
    .prepare(`SELECT id, email, name, created_at FROM users WHERE id = ?`)
    .get(session.userId);
  return c.json({ user });
});

authRoutes.post("/signup", async (c) => {
  if (!config.allowSignups) {
    return c.json({ error: "Signups are disabled" }, 403);
  }
  const body = signupSchema.parse(await c.req.json());
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .get(body.email);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const now = Date.now();
  const userId = generateId("usr");
  const workspaceId = generateId("ws");
  const slugBase = (body.workspaceName || body.email.split("@")[0])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let slug = slugBase || "workspace";
  let n = 1;
  while (db.prepare(`SELECT 1 FROM workspaces WHERE slug = ?`).get(slug)) {
    slug = `${slugBase}-${n++}`;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, body.email, hashPassword(body.password), body.name || null, now);
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(
      workspaceId,
      body.workspaceName || "My Workspace",
      slug,
      userId,
      now
    );
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
    ).run(workspaceId, userId, now);
  });
  tx();

  const token = issueSession(c, userId, body.email);
  return c.json({
    user: { id: userId, email: body.email, name: body.name || null },
    workspace: { id: workspaceId, slug },
    sessionToken: token,
  });
});

authRoutes.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const user = getDb()
    .prepare(`SELECT id, email, password_hash, name FROM users WHERE email = ?`)
    .get(body.email) as
    | { id: string; email: string; password_hash: string; name: string | null }
    | undefined;

  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = issueSession(c, user.id, user.email);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    sessionToken: token,
  });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, "ap_session", { path: "/" });
  return c.json({ ok: true });
});

/** Magic-link ready endpoint: stores a hashed token. Delivery is left to the operator. */
authRoutes.post("/magic-link", async (c) => {
  const body = magicRequestSchema.parse(await c.req.json());
  const raw = `apl_${cryptoRandom()}`;
  const id = generateId("ml");
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO magic_links (id, email, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, body.email, hashToken(raw), now + 15 * 60_000, now);

  // Never email automatically — no paid services. In non-prod, return token for testing.
  const response: Record<string, unknown> = {
    ok: true,
    message: "If an account exists, a magic link can be delivered by your mailer.",
  };
  if (process.env.NODE_ENV !== "production") {
    response.devToken = raw;
  }
  return c.json(response);
});

authRoutes.post("/magic-link/consume", async (c) => {
  const body = z.object({ token: z.string().min(1) }).parse(await c.req.json());
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, expires_at, consumed_at FROM magic_links WHERE token_hash = ?`
    )
    .get(hashToken(body.token)) as
    | { id: string; email: string; expires_at: number; consumed_at: number | null }
    | undefined;

  if (!row || row.consumed_at || row.expires_at < Date.now()) {
    return c.json({ error: "Invalid or expired magic link" }, 401);
  }

  db.prepare(`UPDATE magic_links SET consumed_at = ? WHERE id = ?`).run(
    Date.now(),
    row.id
  );

  let user = db
    .prepare(`SELECT id, email, name FROM users WHERE email = ?`)
    .get(row.email) as { id: string; email: string; name: string | null } | undefined;

  if (!user) {
    if (!config.allowSignups) {
      return c.json({ error: "No account for this email" }, 404);
    }
    const userId = generateId("usr");
    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, NULL, ?)`
    ).run(userId, row.email, hashPassword(cryptoRandom()), now);
    user = { id: userId, email: row.email, name: null };
  }

  const token = issueSession(c, user.id, user.email);
  return c.json({ user, sessionToken: token });
});

function issueSession(
  c: Parameters<typeof setCookie>[0],
  userId: string,
  email: string
): string {
  const token = signSession(
    { userId, email, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 },
    config.sessionSecret
  );
  setCookie(c, "ap_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
  return token;
}

function cryptoRandom(): string {
  return generateId("tmp") + generateId("");
}

authRoutes.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: err.message }, err.status as 401);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: "Invalid request", details: err.flatten() }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
