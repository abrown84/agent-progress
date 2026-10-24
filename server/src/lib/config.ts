import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(rootDir, "..");

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt("PORT", 8787),
  host: process.env.HOST || "0.0.0.0",
  databasePath:
    process.env.DATABASE_PATH || path.join(repoRoot, "data", "agent-progress.db"),
  sessionSecret:
    process.env.SESSION_SECRET || "dev-only-change-me-in-production-please",
  allowSignups: envBool("ALLOW_SIGNUPS", false),
  publicWebDir:
    process.env.PUBLIC_WEB_DIR || path.join(repoRoot, "dist-web"),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: envInt("RATE_LIMIT_MAX", 120),
  writeRateLimitMax: envInt("WRITE_RATE_LIMIT_MAX", 600),
  seedOwnerEmail: process.env.SEED_OWNER_EMAIL || "",
  seedOwnerPassword: process.env.SEED_OWNER_PASSWORD || "",
  seedWorkspaceName: process.env.SEED_WORKSPACE_NAME || "Alex Workspace",
  seedWorkspaceSlug: process.env.SEED_WORKSPACE_SLUG || "alex",
};
