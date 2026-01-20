# Agent Progress Overlay

A lightweight Windows desktop overlay that displays real-time AI agent task progress in a floating window.

![Tauri](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-18-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6) ![License](https://img.shields.io/badge/License-MIT-green)

> **Platform:** Windows 10/11 (macOS and Linux support possible with minor adjustments)

## Features

- **Real-time task monitoring** - Watch AI agent operations as they happen
- **Floating overlay** - Non-intrusive window that stays out of your way
- **Smart summaries** - Human-readable descriptions of complex commands
- **Download progress** - Track file downloads with progress bars
- **Todo tracking** - See multi-step task progress
- **Notification popups** - Get notified when tasks start/complete
- **System tray** - Minimize to tray, easy access controls
- **Customizable** - Position, opacity, auto-hide, and more

## Zero Token Usage

**This app consumes zero LLM/AI tokens.** It's a pure visualization tool:

| What It Does | What It Doesn't Do |
|--------------|-------------------|
| Reads local event files | Make any API calls |
| Displays task progress | Use any AI services |
| Generates summaries locally | Consume tokens |
| Watches filesystem | Connect to the internet |

### How Summaries Work

Task summaries are generated **locally using pattern matching**, not AI:

```typescript
// Example from TaskCard.tsx - no AI involved
if (cmd.startsWith("git push")) return "Pushing to remote";
if (cmd.startsWith("npm install")) return "Installing dependencies";
if (cmd.startsWith("cargo build")) return "Building Rust project";
```

The app recognizes 20+ command patterns and converts them to human-readable text entirely on your machine.

## Quick Start

```bash
# Install dependencies
npm install

# Run the app (development mode with hot-reload)
npm start
```

The overlay window will appear in the bottom-right corner of your screen.

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **Rust** toolchain ([install](https://rustup.rs/))
- **Windows**: WebView2 (pre-installed on Windows 10/11)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `webkit2gtk` and `libappindicator` packages

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run in development mode |
| `npm run build` | Build production binary |
| `npm run dev:frontend` | Run frontend only (UI development) |
| `npm run help` | Show all available commands |

## How It Works

```
AI Agent (e.g., Claude Code)
    │
    ├── Writes events to ~/.claude/progress-events.jsonl
    │
    ▼
Agent Progress Overlay
    │
    ├── Watches the JSONL file for changes
    ├── Parses events (task_started, task_complete, task_error)
    ├── Generates human-readable summaries (LOCAL pattern matching)
    └── Displays in floating overlay window
```

The overlay is **completely passive** - it only reads files, never writes or sends data anywhere.

## Standalone Usage

The app requires **something** to write events to `~/.claude/progress-events.jsonl`. Options:

### 1. With Claude Code (Primary Use Case)
Claude Code automatically writes events when running. Just start the overlay and use Claude Code normally.

### 2. With Custom Tools
Any tool can write events in this format:

```json
{"type":"task_started","task_id":"unique-id","tool":"Bash","description":"npm install","timestamp":1705678901234,"session_id":"session-1"}
{"type":"task_complete","task_id":"unique-id","duration_ms":5000,"timestamp":1705678906234}
```

### 3. For Testing/Demo
Create a test event file:

```bash
echo '{"type":"task_started","task_id":"test-1","tool":"Bash","description":"echo Hello World","timestamp":'$(date +%s)000',"session_id":"demo"}' >> ~/.claude/progress-events.jsonl
```

## Event Format

Events are JSONL (one JSON object per line):

### task_started
```json
{
  "type": "task_started",
  "task_id": "unique-id",
  "tool": "Bash",
  "description": "npm install",
  "timestamp": 1705678901234,
  "session_id": "optional-session",
  "background": false,
  "subagent_type": "Explore"
}
```

### task_complete
```json
{
  "type": "task_complete",
  "task_id": "unique-id",
  "duration_ms": 5000,
  "timestamp": 1705678906234
}
```

### task_error
```json
{
  "type": "task_error",
  "task_id": "unique-id",
  "timestamp": 1705678906234
}
```

### session_stopped
```json
{
  "type": "session_stopped",
  "session_id": "session-id",
  "timestamp": 1705678906234
}
```

## Supported Tools

The overlay recognizes these tool types and displays appropriate icons/labels:

| Tool | Display | Icon |
|------|---------|------|
| Task (Explore) | Explorer Agent | Robot |
| Task (Plan) | Planner Agent | Robot |
| Task | Background Agent | Robot |
| Skill | /skill-name | Wand |
| Bash | Terminal | Terminal |
| Read | Reading file.ext | File |
| Write | Writing file.ext | Pencil |
| Edit | Editing file.ext | Pencil |
| Glob | Searching | Search |
| Grep | Grep | Search |
| WebFetch | Web Request | Globe |
| WebSearch | Web Search | Globe |
| TodoWrite | Planning | List |
| LSP | Analyzing code | Code |

Bash commands are further parsed to show human-readable summaries:
- `git push origin main` → "Pushing to remote"
- `npm install lodash` → "npm install lodash"
- `cargo build --release` → "Building release"
- `docker compose up` → "Starting containers"

## Settings

Click the gear icon to access settings:

| Setting | Description | Default |
|---------|-------------|---------|
| **Window Position** | Screen corner | bottom-right |
| **Always on Top** | Stay above other windows | true |
| **Opacity** | Window transparency (50-100%) | 95% |
| **Recent Tasks** | Completed tasks to show (1-10) | 5 |
| **Auto-hide** | Hide when no active tasks | false |

Settings persist in localStorage.

## Controls

| Button | Action |
|--------|--------|
| **Settings** (gear) | Open settings panel |
| **DevTools** | Open browser developer tools |
| **Clear** | Clear completed tasks |
| **Minimize** | Hide to system tray |
| **Close** | Exit application |

## Architecture

```
progress-overlay/
├── src/                     # React/TypeScript frontend
│   ├── App.tsx              # Main overlay UI
│   ├── NotificationWindow.tsx # Popup notifications
│   ├── components/
│   │   ├── TaskCard.tsx     # Task display + LOCAL summaries
│   │   ├── TaskList.tsx     # Task list container
│   │   └── TodoSection.tsx  # Todo tracking
│   ├── hooks/
│   │   ├── useTasks.ts      # Task event management
│   │   └── useTodos.ts      # Todo state management
│   └── index.css            # Tailwind styles
├── src-tauri/               # Rust backend
│   └── src/lib.rs           # File watching, windows, tray
├── package.json             # Node dependencies
└── Cargo.toml               # Rust dependencies
```

## Building for Production

```bash
# Build optimized release binary
npm run build

# Output location (Windows)
src-tauri/target/release/progress-overlay.exe

# Output location (with installer)
src-tauri/target/release/bundle/
```

The release build is optimized with:
- LTO (Link-Time Optimization)
- Single codegen unit
- Symbol stripping
- Size optimization

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Window doesn't appear | Check if `~/.claude/progress-events.jsonl` exists |
| No tasks showing | Verify events are being written (tail the file) |
| Rust compilation errors | Run `rustup update` to update Rust |
| WebView2 missing | Download from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| Hot-reload stuck | Stop and restart `npm start` |

## Adapting for Other Agents

To use with a different AI agent:

1. **Change the event file path** in `src-tauri/src/lib.rs`:
   ```rust
   fn get_events_file_path() -> PathBuf {
       dirs::home_dir()
           .join(".your-agent")
           .join("events.jsonl")
   }
   ```

2. **Add tool recognition** in `src/components/TaskCard.tsx`:
   ```typescript
   const TOOL_INFO: Record<string, { label: string; icon: string }> = {
     YourTool: { label: "Your Tool", icon: "custom" },
   };
   ```

3. **Write events** in the expected format from your agent.

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to verify
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Note:** This project is not affiliated with Anthropic. It's an independent tool for visualizing AI agent progress.
