import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import fs from "node:fs";
import path from "node:path";
import { config } from "./lib/config.js";
import { getDb } from "./lib/db.js";
import { seedOwner } from "./lib/seed.js";
import { checkRateLimit } from "./lib/rateLimit.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { apiRoutes } from "./routes/events.js";
import { pushRoutes } from "./routes/push.js";
import { ensureVapidKeys, pushEnabled, relayEnabled } from "./lib/push.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: config.corsOrigin === "*" ? "*" : config.corsOrigin.split(","),
    credentials: true,
  })
);

app.use("/api/*", async (c, next) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  const rl = checkRateLimit(`ip:${ip}`);
  if (!rl.ok) return c.json({ error: "Rate limit exceeded" }, 429);
  c.header("X-RateLimit-Remaining", String(rl.remaining));
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "agent-progress",
    allowSignups: config.allowSignups,
    branding: "Built by Brown Industries",
    pushEnabled: pushEnabled(),
    relayEnabled: relayEnabled(),
  })
);

app.get("/api/config/public", (c) =>
  c.json({
    allowSignups: config.allowSignups,
    pushEnabled: pushEnabled(),
    publicUrl: config.publicUrl,
    branding: {
      name: "Agent Progress",
      byline: "Built by Brown Industries",
      url: "https://brwnindustries.com",
    },
  })
);

app.route("/api/auth", authRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/push", pushRoutes);
app.route("/api", apiRoutes);

// Static web dashboard (landing + SPA)
const webRoot = config.publicWebDir;
if (fs.existsSync(webRoot)) {
  // PWA assets: correct content types and no stale caching of the worker.
  app.get("/manifest.webmanifest", (c) => {
    const file = path.join(webRoot, "manifest.webmanifest");
    if (!fs.existsSync(file)) return c.notFound();
    c.header("Content-Type", "application/manifest+json");
    c.header("Cache-Control", "no-cache");
    return c.body(fs.readFileSync(file, "utf8"));
  });
  app.get("/sw.js", (c) => {
    const file = path.join(webRoot, "sw.js");
    if (!fs.existsSync(file)) return c.notFound();
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    c.header("Service-Worker-Allowed", "/");
    return c.body(fs.readFileSync(file, "utf8"));
  });
  // Digital Asset Links for the Android TWA (package verification → full Web Push).
  app.get("/.well-known/assetlinks.json", (c) => {
    const file = path.join(webRoot, ".well-known", "assetlinks.json");
    if (!fs.existsSync(file)) return c.notFound();
    c.header("Content-Type", "application/json");
    c.header("Cache-Control", "no-cache");
    return c.body(fs.readFileSync(file, "utf8"));
  });
  // Optional sideload APK (copied into dist-web/android/ during release packaging).
  app.get("/android/agent-progress.apk", (c) => {
    const file = path.join(webRoot, "android", "agent-progress.apk");
    if (!fs.existsSync(file)) return c.notFound();
    c.header("Content-Type", "application/vnd.android.package-archive");
    c.header("Content-Disposition", 'attachment; filename="agent-progress.apk"');
    c.header("Cache-Control", "no-cache");
    return c.body(fs.readFileSync(file));
  });
  app.use(
    "/*",
    serveStatic({
      root: webRoot,
      rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
    })
  );

  // SPA fallback for client routes
  app.get("*", (c) => {
    const indexPath = path.join(webRoot, "index.html");
    if (fs.existsSync(indexPath)) {
      return c.html(fs.readFileSync(indexPath, "utf8"));
    }
    return c.text("Web UI not built. Run npm run build:web", 404);
  });
} else {
  app.get("/", (c) =>
    c.html(`<!doctype html><html><body style="font-family:system-ui;padding:2rem">
      <h1>Agent Progress API</h1>
      <p>Built by Brown Industries</p>
      <p>Web UI not found at <code>${webRoot}</code>. API is up at <code>/api/health</code>.</p>
    </body></html>`)
  );
}

// Ensure DB is ready, then auto-provision VAPID so phone push works without manual keys.
getDb();
try {
  ensureVapidKeys();
} catch (e) {
  console.warn("[push] VAPID setup failed:", (e as Error).message);
}

// Optional auto-seed on boot when env vars are set
if (config.seedOwnerEmail && config.seedOwnerPassword) {
  try {
    const result = seedOwner({ createTokens: true });
    if (result.created) {
      console.log(`[seed] Created owner ${result.email} / workspace ${result.workspaceSlug}`);
      if (result.writeToken) {
        console.log("[seed] Write token printed once — store it securely:");
        console.log(`  WRITE=${result.writeToken}`);
      }
      if (result.readToken) {
        console.log(`  READ=${result.readToken}`);
      }
    } else {
      console.log(`[seed] Owner ${result.email} already exists`);
    }
  } catch (e) {
    console.warn("[seed] Skipped:", (e as Error).message);
  }
}

console.log(
  `Agent Progress server listening on http://${config.host}:${config.port}`
);
console.log(`SQLite: ${config.databasePath}`);
console.log(`Signups: ${config.allowSignups ? "enabled" : "disabled"}`);
console.log(
  `Notifications: web-push=${pushEnabled() ? "on" : "off"} relay=${relayEnabled() ? "on" : "off"}`
);

serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

export default app;
