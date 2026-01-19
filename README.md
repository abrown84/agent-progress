# Agent Progress

A Windows desktop overlay that displays real-time agent task progress in a floating window.

> **Platform:** Windows 10/11 (macOS and Linux support possible with minor adjustments)

![Tauri](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-18-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6)

## Quick Start

```bash
# Install dependencies
npm install

# Run the app (development mode with hot-reload)
npm start
```

That's it! The overlay window will appear in the bottom-right corner of your screen.

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **Rust** toolchain ([install](https://rustup.rs/))
- **Windows**: WebView2 (usually pre-installed on Windows 10/11)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `webkit2gtk` and `libappindicator` packages

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run in development mode (recommended) |
| `npm run build` | Build production binary |
| `npm run help` | Show all available commands |
| `npm run dev:frontend` | Run only the frontend (for UI development) |

## How It Works

1. AI agents write task events to `~/.claude/progress-events.jsonl` (or any agent's progress events file)
2. The overlay watches this file and displays tasks in real-time
3. Shows tool being used, duration, and status (running/done/failed)

## Controls

| Button | Action |
|--------|--------|
| **Settings** (gear icon) | Open settings panel |
| **DevTools** | Open browser developer tools |
| **Clear** | Clear all completed tasks |
| **Minimize** | Hide the overlay |
| **Close** | Exit the application |

## Settings

Open settings by clicking the gear icon in the header.

| Setting | Description |
|---------|-------------|
| **Window Position** | Corner of screen: bottom-right, bottom-left, top-right, top-left |
| **Always on Top** | Keep window above other windows |
| **Opacity** | Window transparency (50-100%) |
| **Recent Tasks** | Number of completed tasks to display (1-10) |
| **Auto-hide** | Automatically hide when no active tasks |

Settings are persisted in localStorage and restored on restart.

## Supported Tools

The overlay recognizes these AI agent operations:

| Tool | Display |
|------|---------|
| Task (Explore) | Explorer Agent |
| Task (Plan) | Planner Agent |
| Task | Background Agent |
| Bash | Terminal |
| Read | Reading |
| Write | Writing |
| Edit | Editing |
| Glob | Searching |
| Grep | Grep |
| WebFetch | Web Request |
| WebSearch | Web Search |

## Event Format

Events are written as JSONL (one JSON object per line):

```json
{"type": "start", "task_id": "abc123", "tool": "Bash", "description": "npm install", "timestamp": 1234567890}
{"type": "complete", "task_id": "abc123", "duration_ms": 5000, "timestamp": 1234567895}
```

## Architecture

```
progress-overlay/
├── src/                 # React/TypeScript frontend
│   ├── components/      # UI components (Header, TaskList, TaskCard)
│   ├── hooks/           # React hooks (useTasks)
│   └── styles/          # Tailwind CSS
├── src-tauri/           # Rust backend
│   └── src/lib.rs       # File watching, window management
└── package.json
```

## Troubleshooting

**Window doesn't appear**
- Check if `~/.claude/progress-events.jsonl` exists
- Try `npm run dev:frontend` to verify frontend works

**Rust compilation errors**
- Run `rustup update` to update Rust
- On Windows, ensure Visual Studio Build Tools are installed

**Hot-reload not working**
- The Tauri dev server handles both frontend and backend reload
- If stuck, stop and restart `npm start`

## License

MIT
