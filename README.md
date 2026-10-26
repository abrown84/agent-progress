# Agent Progress

Real-time AI agent task progress — as a **Windows desktop overlay** (local `~/.claude` files) and a **self-hosted cloud dashboard** (multi-tenant API + SSE).

![Tauri](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-18-61DAFB) ![Hono](https://img.shields.io/badge/Hono-4-orange) ![License](https://img.shields.io/badge/License-MIT-green)

> **Built by [Brown Industries](https://brwnindustries.com)** · Deploy target: `progress.brwnindustries.com`

## Zero AI tokens

This product **never calls an LLM**. Summaries are local pattern matching. If model calls are ever needed, they must go through Alex’s One Gateway (`gemini-3.8-flash`) — not from this app.

| What it does | What it doesn’t do |
|--------------|-------------------|
| Reads local event files / accepts agent POSTs | Call AI APIs |
| Shows live tasks, todos, errors | Consume model tokens |
| Streams updates over SSE | Depend on paid SaaS |

## Features

- **Desktop overlay** — floating always-on-top window watching `~/.claude/progress-events.jsonl`
- **Cloud API** — multi-tenant workspaces, write/read tokens, SQLite
- **Web dashboard** — same React UI via a transport abstraction (Tauri vs fetch+SSE)
- **Agent labels** — name + source (`claude-code`, `cursor-cloud`, `grok-bot`, …)
- **Optional forwarder** — desktop can push local events to a cloud workspace
- **Self-host** — Docker Compose + nginx; signups gateable via env

## Setup in 2 minutes (phone + agents)

Intended for Alex at `https://progress.brwnindustries.com`.

### Android app (recommended)

1. Install the **Agent Progress** APK (`versionCode` 2+ native WebView app — upgrades over v1 TWA).  
   Download: GitHub Actions artifact, or `https://progress.brwnindustries.com/android/agent-progress.apk`.
2. Open the app → **sign in** → **Enable notifications** → allow → **Send test notification**.
3. Done. Agents still report with one URL + one write token (below).

Native FCM needs a Firebase project from Alex — see [`android/FIREBASE.md`](android/FIREBASE.md).  
Keystore outside git: [`android/KEYSTORE.md`](android/KEYSTORE.md). OTA: app checks `/android/latest.json`.

### Browser / agents

1. **Sign in** on your Android phone (Chrome) → open **Dashboard** (or use the APK above).
2. Tap **Enable notifications** → allow the permission → you should get a test ping.  
   Optional: Chrome menu → **Add to Home screen**.
3. Tap **Mint write token** (or use the token from seed) → copy **Report URL** + **Write token**.
4. Point any agent at one URL + one token:

```bash
curl -sS -X POST "https://progress.brwnindustries.com/api/events" \
  -H "Authorization: Bearer apw_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"task_complete","task_id":"demo-1","tool":"Demo","description":"hello","timestamp":1705678901234}'
```

You get a phone alert on `task_complete`, `task_error`, and `task_needs_input`.  
Use **Send test notification** anytime. Quiet controls: “Only errors & decisions” and “Quiet for 1 hour”.

Desktop overlay keeps working unchanged (local files + optional cloud forwarder).

### Deploy notes (VPS)

After pulling a build that includes Web Push:

```bash
docker compose up --build -d
```

- **VAPID**: if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are empty, the server **auto-generates** keys and stores them in SQLite (`app_kv`). To pin keys across reinstalls, generate once with `npx web-push generate-vapid-keys` and set them in `.env` (never commit `.env`).
- **Optional BRWN Text relay**: set `RELAY_NOTIFY_URL` + `RELAY_NOTIFY_TOKEN` to also mirror alerts to the Android BRWN Text app. Web Push alone is enough for phone alerts.
- Confirm: `curl -s https://progress.brwnindustries.com/api/health` → `pushEnabled: true`.
- nginx must terminate HTTPS (required for Web Push). Use `deploy/nginx.progress.brwnindustries.com.conf.example`.
- **Android**: `npm run publish:android` writes `dist-web/android/{agent-progress.apk,latest.json}`. On VPS `srv1417676` under `/opt/agent-progress`, rebuild/restart compose so those files and FCM env are live. Set `FCM_SERVICE_ACCOUNT_PATH` (see `android/FIREBASE.md`).

## Quick start (desktop)

```bash
npm install
npm start          # Tauri overlay (dev)
npm run build      # Production binary
```

## Quick start (cloud / self-host)

```bash
# 1) Install server deps
cd server && npm install && cd ..

# 2) Seed Alex’s owner account (prints write/read tokens once — store securely)
cp .env.example .env   # edit SESSION_SECRET + SEED_OWNER_*
cd server && npm run seed && cd ..

# 3) Run API (serves web UI after build:web)
npm run build:web
cd server && npm run dev

# 4) Smoke test (ingest → snapshot → SSE)
npm run smoke
```

### Docker (nginx-ready)

```bash
cp .env.example .env
# Set SESSION_SECRET, optional SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD

docker compose up --build -d
# Listens on :8787 — put nginx in front for https://progress.brwnindustries.com
```

Example nginx upstream:

```nginx
server {
  server_name progress.brwnindustries.com;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
  }
}
```

### Environment

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Signs dashboard session cookies |
| `ALLOW_SIGNUPS` | `true`/`false` — public registration (default off) |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | Auto-seed owner on boot / via `npm run seed` |
| `DATABASE_PATH` | SQLite file (Compose volume `/data`) |
| `CORS_ORIGIN` | Allowed browser origins |
| `PUBLIC_WEB_DIR` | Static web build directory |
| `PUBLIC_URL` | Absolute site URL (notification links; default `https://progress.brwnindustries.com`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys (optional — auto-generated + persisted if empty) |
| `VAPID_SUBJECT` | `mailto:…` contact for VAPID |
| `RELAY_NOTIFY_URL` / `RELAY_NOTIFY_TOKEN` | Optional BRWN Text relay mirror |

**Never commit secrets.** Tokens are hashed at rest (SHA-256); plaintext is shown once at creation.

## Agent reporting API

Authenticate with a **write token** (`apw_…`) as `Authorization: Bearer …` or `X-API-Token`.

### Copy-paste: report a task

```bash
export PROGRESS_URL="https://progress.brwnindustries.com"
export WRITE_TOKEN="apw_YOUR_TOKEN"

curl -sS -X POST "$PROGRESS_URL/api/events" \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": { "name": "my-bot", "source": "claude-code", "label": "CI Agent" },
    "events": [
      {
        "type": "task_started",
        "task_id": "job-42",
        "tool": "Bash",
        "description": "npm test",
        "timestamp": 1705678901234,
        "session_id": "session-1"
      }
    ]
  }'
```

Complete it:

```bash
curl -sS -X POST "$PROGRESS_URL/api/events" \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task_complete",
    "task_id": "job-42",
    "duration_ms": 5000,
    "timestamp": 1705678906234
  }'
```

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/events` | write token | Single event, batch, todos, or download progress |
| `GET` | `/api/state` | read (or write) token | Workspace snapshot |
| `GET` | `/api/events/stream` | read token | SSE live updates (`?token=` for browsers) |
| `POST` | `/api/auth/login` | — | Email + password |
| `POST` | `/api/auth/signup` | — | When `ALLOW_SIGNUPS=true` |
| `POST` | `/api/auth/magic-link` | — | Magic-link ready (no mailer bundled) |
| `GET` | `/api/workspaces` | session | List workspaces |
| `POST` | `/api/workspaces/:id/tokens` | session | Mint read/write tokens |
| `GET` | `/api/push/vapid-public-key` | — | Public VAPID key |
| `GET` | `/api/push/status` | session | Push/relay status + prefs |
| `POST` | `/api/push/subscribe` | session | Register this device |
| `POST` | `/api/push/test` | session | Send test (Web Push + optional relay) |
| `PATCH` | `/api/push/prefs` | session | Quiet / skip-completions |

Accepted event `type` values: `task_started`, `task_complete`, `task_error`, `task_canceled`, `task_needs_input`, `session_stopped`.  
Phone push fires for **complete / error / needs_input** (completions skip when the task is marked `background: true`, or when quiet prefs mute completions).  
Also: `todos` array (`content`, `status`, `activeForm`) and `download` (`task_id`, `percent`, …).

Rate limits apply per IP and per token. Invalid shapes return `400` with Zod details.

## Desktop ↔ cloud

In overlay **Settings → Cloud workspace**:

1. Enable cloud and set **Server URL** + **read token** (`apr_…`) to mirror the dashboard live.
2. Optionally set a **write token** and enable **Forward local ~/.claude events** so the desktop pushes file-watch events to the server.

Local file watching keeps working either way.

## Project layout

```
├── src/                 # Shared React UI + Zustand stores
│   ├── transport/       # Tauri invoke/listen vs fetch+SSE (+ composite forwarder)
│   └── web/             # Landing, auth, mobile-friendly dashboard
├── src-tauri/           # Desktop overlay (Rust)
├── server/              # Hono + SQLite multi-tenant API
├── android/             # TWA APK (Brown branding, Web Push via Chrome)
├── docker-compose.yml
└── web.html             # Web entry (builds to dist-web/)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Desktop Tauri dev |
| `npm run build` | Desktop production build |
| `npm run dev:frontend` | Overlay UI only |
| `npm run build:web` | Browser dashboard → `dist-web/` |
| `npm run dev:web` | Web UI with `/api` proxy to `:8787` |
| `npm run dev:server` | API on `:8787` |
| `npm run smoke` | Ingest → state → SSE smoke test |
| `npm test` | Smoke + notification-path tests |
| `npm run build:android` | Signed native release APK → `artifacts/agent-progress.apk` |
| `npm run publish:android` | APK + `/android/latest.json` OTA manifest → `dist-web/android/` |
| `npm run test:android` | Android unit tests (UpdateChecker SHA-256) |

## Event format (local JSONL / API)

Same shapes as before — see `task_started` / `task_complete` / `task_error` / `session_stopped` in the curl examples above. Local path defaults to `~/.claude/progress-events.jsonl`.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Brown Industries](https://brwnindustries.com) · [Book an AI Ops Audit](https://brwnindustries.com/ai-ops)

**Note:** Not affiliated with Anthropic.
