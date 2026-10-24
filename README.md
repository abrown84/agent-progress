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

Accepted event `type` values: `task_started`, `task_complete`, `task_error`, `task_canceled`, `session_stopped`.  
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

## Event format (local JSONL / API)

Same shapes as before — see `task_started` / `task_complete` / `task_error` / `session_stopped` in the curl examples above. Local path defaults to `~/.claude/progress-events.jsonl`.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Brown Industries](https://brwnindustries.com) · [Book an AI Ops Audit](https://brwnindustries.com/ai-ops)

**Note:** Not affiliated with Anthropic.
