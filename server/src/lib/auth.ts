import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { hashToken, verifySession } from "./crypto.js";
import type { TokenKind } from "./types.js";

export interface SessionUser {
  userId: string;
  email: string;
  exp: number;
}

export interface TokenAuth {
  tokenId: string;
  workspaceId: string;
  kind: TokenKind;
}

export function getSession(c: Context): SessionUser | null {
  const cookie = getCookie(c, "ap_session");
  const header = c.req.header("Authorization");
  const bearer =
    header?.startsWith("Bearer ") && !header.slice(7).startsWith("ap")
      ? header.slice(7)
      : null;
  const raw = cookie || bearer;
  if (!raw) return null;
  const session = verifySession<SessionUser>(raw, config.sessionSecret);
  if (!session || session.exp < Date.now()) return null;
  return session;
}

export function requireSession(c: Context): SessionUser {
  const session = getSession(c);
  if (!session) throw new AuthError(401, "Authentication required");
  return session;
}

export function authenticateApiToken(
  c: Context,
  required: TokenKind
): TokenAuth {
  const header = c.req.header("Authorization");
  const queryToken = c.req.query("token")?.trim() || "";
  const raw =
    (header?.startsWith("Bearer ") ? header.slice(7).trim() : "") ||
    c.req.header("X-API-Token")?.trim() ||
    queryToken;
  if (!raw) throw new AuthError(401, "API token required");

  const expectedPrefix = required === "write" ? "apw_" : "apr_";
  // Write tokens can also be used where read is required? No — keep strict.
  // Read endpoints accept read tokens; write endpoints accept write tokens.
  if (required === "write" && !raw.startsWith("apw_")) {
    throw new AuthError(403, "Write token required (apw_…)");
  }
  if (required === "read" && !raw.startsWith("apr_") && !raw.startsWith("apw_")) {
    throw new AuthError(403, "Read or write token required");
  }

  const db = getDb();
  const hash = hashToken(raw);
  const row = db
    .prepare(
      `SELECT id, workspace_id, kind FROM api_tokens
       WHERE token_hash = ? AND revoked_at IS NULL`
    )
    .get(hash) as
    | { id: string; workspace_id: string; kind: TokenKind }
    | undefined;

  if (!row) throw new AuthError(401, "Invalid token");
  if (required === "write" && row.kind !== "write") {
    throw new AuthError(403, "Write token required");
  }
  if (required === "read" && row.kind !== "read" && row.kind !== "write") {
    throw new AuthError(403, "Read token required");
  }

  // Accept write tokens for read endpoints as well.
  if (required === "read" && row.kind === "write") {
    // ok
  } else if (required === "read" && !raw.startsWith(expectedPrefix) && row.kind !== "write") {
    throw new AuthError(403, "Read token required");
  }

  db.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).run(
    Date.now(),
    row.id
  );

  return {
    tokenId: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
  };
}

export function userCanAccessWorkspace(
  userId: string,
  workspaceId: string
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM workspace_members WHERE user_id = ? AND workspace_id = ?`
    )
    .get(userId, workspaceId) as { ok: number } | undefined;
  return Boolean(row);
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
