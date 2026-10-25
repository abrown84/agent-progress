import { getDb } from "./db.js";
import {
  generateId,
  generateToken,
  hashPassword,
  hashToken,
} from "./crypto.js";
import { config } from "./config.js";

export interface SeedResult {
  created: boolean;
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
  writeToken?: string;
  readToken?: string;
}

export function seedOwner(options?: {
  email?: string;
  password?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  createTokens?: boolean;
}): SeedResult {
  const email = (options?.email || config.seedOwnerEmail).trim();
  const password = options?.password || config.seedOwnerPassword;
  if (!email || !password) {
    throw new Error(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required (or pass --email/--password)"
    );
  }

  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .get(email) as { id: string } | undefined;

  if (existing) {
    const ws = db
      .prepare(
        `SELECT id, slug FROM workspaces WHERE owner_user_id = ? ORDER BY created_at ASC LIMIT 1`
      )
      .get(existing.id) as { id: string; slug: string } | undefined;
    return {
      created: false,
      userId: existing.id,
      email,
      workspaceId: ws?.id || "",
      workspaceSlug: ws?.slug || "",
    };
  }

  const now = Date.now();
  const userId = generateId("usr");
  const workspaceId = generateId("ws");
  const workspaceName =
    options?.workspaceName || config.seedWorkspaceName || "Owner Workspace";
  let slug =
    options?.workspaceSlug ||
    config.seedWorkspaceSlug ||
    email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let n = 1;
  const base = slug;
  while (db.prepare(`SELECT 1 FROM workspaces WHERE slug = ?`).get(slug)) {
    slug = `${base}-${n++}`;
  }

  let writeToken: string | undefined;
  let readToken: string | undefined;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, email, hashPassword(password), "Alex", now);
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(workspaceId, workspaceName, slug, userId, now);
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`
    ).run(workspaceId, userId, now);

    if (options?.createTokens !== false) {
      writeToken = generateToken("apw");
      readToken = generateToken("apr");
      db.prepare(
        `INSERT INTO api_tokens
          (id, workspace_id, kind, name, token_hash, token_prefix, created_by, created_at)
         VALUES (?, ?, 'write', 'seed-write', ?, ?, ?, ?)`
      ).run(
        generateId("tok"),
        workspaceId,
        hashToken(writeToken),
        writeToken.slice(0, 10),
        userId,
        now
      );
      db.prepare(
        `INSERT INTO api_tokens
          (id, workspace_id, kind, name, token_hash, token_prefix, created_by, created_at)
         VALUES (?, ?, 'read', 'seed-read', ?, ?, ?, ?)`
      ).run(
        generateId("tok"),
        workspaceId,
        hashToken(readToken),
        readToken.slice(0, 10),
        userId,
        now
      );
    }
  });
  tx();

  return {
    created: true,
    userId,
    email,
    workspaceId,
    workspaceSlug: slug,
    writeToken,
    readToken,
  };
}
