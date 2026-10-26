import fs from "node:fs";
import { createSign } from "node:crypto";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { generateId } from "./crypto.js";
import type { PushMessage } from "./push.js";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedSa: ServiceAccount | null | undefined;
let cachedAccess: { token: string; exp: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa;
  const rawJson = process.env.FCM_SERVICE_ACCOUNT_JSON || "";
  const path = config.fcmServiceAccountPath;
  try {
    if (rawJson.trim().startsWith("{")) {
      cachedSa = JSON.parse(rawJson) as ServiceAccount;
      return cachedSa;
    }
    if (path && fs.existsSync(path)) {
      cachedSa = JSON.parse(fs.readFileSync(path, "utf8")) as ServiceAccount;
      return cachedSa;
    }
  } catch (e) {
    console.warn("[fcm] service account load failed:", (e as Error).message);
  }
  cachedSa = null;
  return null;
}

export function fcmEnabled(): boolean {
  const sa = loadServiceAccount();
  const projectId = config.fcmProjectId || sa?.project_id || "";
  return Boolean(sa && projectId);
}

export function fcmProjectId(): string {
  const sa = loadServiceAccount();
  return config.fcmProjectId || sa?.project_id || "";
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(): Promise<string | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;
  if (cachedAccess && cachedAccess.exp > Date.now() + 60_000) {
    return cachedAccess.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = b64url(signer.sign(sa.private_key));
  const assertion = `${unsigned}.${sig}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn(`[fcm] token HTTP ${res.status}`);
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedAccess = {
    token: json.access_token,
    exp: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return json.access_token;
}

export function upsertFcmToken(opts: {
  workspaceId: string;
  userId: string;
  token: string;
  platform?: string;
  userAgent?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO fcm_devices
         (id, workspace_id, user_id, token, platform, user_agent, created_at, last_success_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         platform = excluded.platform,
         user_agent = excluded.user_agent,
         last_success_at = excluded.last_success_at`
    )
    .run(
      generateId("fcm"),
      opts.workspaceId,
      opts.userId,
      opts.token,
      opts.platform || "android",
      (opts.userAgent || "").slice(0, 300),
      Date.now(),
      Date.now()
    );
}

export function deleteFcmToken(token: string, userId: string): void {
  getDb()
    .prepare(`DELETE FROM fcm_devices WHERE token = ? AND user_id = ?`)
    .run(token, userId);
}

export function countFcmDevices(workspaceId: string, userId?: string): number {
  if (userId) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM fcm_devices WHERE workspace_id = ? AND user_id = ?`
      )
      .get(workspaceId, userId) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM fcm_devices WHERE workspace_id = ?`)
    .get(workspaceId) as { n: number };
  return row.n;
}

export function usersWithFcm(workspaceId: string): Set<string> {
  const rows = getDb()
    .prepare(`SELECT DISTINCT user_id FROM fcm_devices WHERE workspace_id = ?`)
    .all(workspaceId) as Array<{ user_id: string }>;
  return new Set(rows.map((r) => r.user_id));
}

export async function sendFcmToWorkspace(
  workspaceId: string,
  msg: PushMessage
): Promise<{ sent: number; removed: number }> {
  if (!fcmEnabled()) return { sent: 0, removed: 0 };
  const access = await getAccessToken();
  if (!access) return { sent: 0, removed: 0 };
  const projectId = fcmProjectId();
  const devices = getDb()
    .prepare(
      `SELECT id, token FROM fcm_devices WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<{ id: string; token: string }>;

  let sent = 0;
  let removed = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: d.token,
                data: {
                  title: msg.title,
                  body: msg.body,
                  tag: msg.tag || "agent-progress",
                  url: msg.url || "/#/dashboard",
                },
                android: {
                  priority: "HIGH",
                  collapse_key: msg.tag || "agent-progress",
                },
              },
            }),
            signal: AbortSignal.timeout(8_000),
          }
        );
        if (res.ok) {
          sent++;
          getDb()
            .prepare(`UPDATE fcm_devices SET last_success_at = ? WHERE id = ?`)
            .run(Date.now(), d.id);
          return;
        }
        const errText = await res.text();
        if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) {
          getDb().prepare(`DELETE FROM fcm_devices WHERE id = ?`).run(d.id);
          removed++;
        } else {
          console.warn(`[fcm] send HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn("[fcm] send failed:", (e as Error).message);
      }
    })
  );
  return { sent, removed };
}

/** Test helper — clear cached credentials between tests. */
export function resetFcmCache(): void {
  cachedSa = undefined;
  cachedAccess = null;
}
