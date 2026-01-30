# Agent Progress Overlay v2 - Architecture Rewrite

## Executive Summary

A complete redesign of the progress overlay to address performance issues, add persistence, and create a plugin-ready architecture.

---

## Current vs Proposed Architecture

### Current (v1)
```
Claude Code → progress-events.jsonl → Polling (200ms) → Tauri events → React
                                          ↓
                                    High CPU usage
                                    No persistence
                                    Lost events on crash
```

### Proposed (v2)
```
                    ┌─────────────────────────────────────────────────┐
                    │              Agent Progress Overlay v2           │
                    └─────────────────────────────────────────────────┘
                                          ↑
Claude Code ──→ Named Pipe / WebSocket ──→│ Event Router
                    OR                     │     ↓
              File Watch (notify)          │ Event Store (SQLite)
                                          │     ↓
                                          │ Plugin System
                                          │     ↓
                                          │ UI (React + Zustand)
```

---

## Core Components

### 1. Event Ingestion Layer

**Option A: Named Pipe (Recommended for Windows)**
```rust
// Rust: Create named pipe server
use tokio::net::windows::named_pipe::{ServerOptions, NamedPipeServer};

const PIPE_NAME: &str = r"\\.\pipe\claude-progress";

async fn start_pipe_server() -> Result<()> {
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(PIPE_NAME)?;

    loop {
        server.connect().await?;
        let event: TaskEvent = read_json(&mut server).await?;
        event_router.dispatch(event).await;
    }
}
```

**Benefits:**
- Zero polling (event-driven)
- Instant delivery (< 1ms latency)
- No file system overhead
- Built-in backpressure

**Option B: File Watch with notify crate (Fallback)**
```rust
use notify::{Watcher, RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};

fn start_file_watcher() -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(100), tx)?;

    debouncer.watcher().watch(
        Path::new(&get_events_path()),
        RecursiveMode::NonRecursive
    )?;

    for event in rx {
        if let DebouncedEvent::Write(_) = event {
            process_new_events();
        }
    }
}
```

**Benefits over polling:**
- Only wakes on actual file changes
- ~95% reduction in CPU usage
- Built-in debouncing

### 2. Event Store (SQLite)

**Schema:**
```sql
-- Core tables
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    project_path TEXT,
    metadata JSON
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    tool TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'error', 'canceled')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    is_background BOOLEAN DEFAULT FALSE,
    subagent_type TEXT,
    metadata JSON,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    content TEXT NOT NULL,
    active_form TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    event_type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    payload JSON
);

-- Indexes for common queries
CREATE INDEX idx_tasks_session ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_started ON tasks(started_at DESC);
CREATE INDEX idx_todos_session ON todos(session_id);
```

**Rust Integration:**
```rust
use rusqlite::{Connection, params};

struct EventStore {
    conn: Connection,
}

impl EventStore {
    fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("schema.sql"))?;
        Ok(Self { conn })
    }

    fn insert_task(&self, task: &Task) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tasks (id, session_id, tool, description, status, started_at, is_background, subagent_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![task.id, task.session_id, task.tool, task.description,
                    task.status, task.started_at, task.is_background, task.subagent_type]
        )?;
        Ok(())
    }

    fn get_recent_tasks(&self, limit: usize) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?1"
        )?;
        // ... map rows to Task structs
    }

    fn search_tasks(&self, query: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tasks WHERE description LIKE ?1 ORDER BY started_at DESC"
        )?;
        stmt.query_map(params![format!("%{}%", query)], |row| {
            // ... map to Task
        })
    }
}
```

### 3. Event Router

Central hub for dispatching events to plugins and UI:

```rust
use tokio::sync::broadcast;

pub struct EventRouter {
    sender: broadcast::Sender<AppEvent>,
    store: Arc<EventStore>,
    plugins: Vec<Box<dyn Plugin>>,
}

pub enum AppEvent {
    TaskStarted(Task),
    TaskCompleted { task_id: String, duration_ms: u64 },
    TaskError { task_id: String, error: Option<String> },
    TodosUpdated(Vec<Todo>),
    SessionStarted(Session),
    SessionEnded(String),
    DownloadProgress { task_id: String, percent: f64 },
}

impl EventRouter {
    pub async fn dispatch(&self, event: AppEvent) {
        // 1. Persist to store
        self.store.handle_event(&event).await;

        // 2. Notify plugins
        for plugin in &self.plugins {
            plugin.on_event(&event).await;
        }

        // 3. Broadcast to UI
        let _ = self.sender.send(event);
    }
}
```

### 4. Plugin System

**Plugin Trait:**
```rust
#[async_trait]
pub trait Plugin: Send + Sync {
    fn name(&self) -> &str;
    fn version(&self) -> &str;

    async fn on_init(&mut self, ctx: &PluginContext) -> Result<()>;
    async fn on_event(&self, event: &AppEvent) -> Result<()>;
    async fn on_shutdown(&self) -> Result<()>;

    // Optional hooks
    fn on_task_started(&self, _task: &Task) -> Result<()> { Ok(()) }
    fn on_task_completed(&self, _task: &Task) -> Result<()> { Ok(()) }
}

pub struct PluginContext {
    pub store: Arc<EventStore>,
    pub config: Arc<Config>,
    pub app_handle: AppHandle,
}
```

**Example Plugins:**

```rust
// Sound notification plugin
pub struct SoundPlugin {
    success_sound: PathBuf,
    error_sound: PathBuf,
}

#[async_trait]
impl Plugin for SoundPlugin {
    fn name(&self) -> &str { "sounds" }

    async fn on_event(&self, event: &AppEvent) -> Result<()> {
        match event {
            AppEvent::TaskCompleted { .. } => {
                play_sound(&self.success_sound)?;
            }
            AppEvent::TaskError { .. } => {
                play_sound(&self.error_sound)?;
            }
            _ => {}
        }
        Ok(())
    }
}

// Slack notification plugin
pub struct SlackPlugin {
    webhook_url: String,
    notify_on_error: bool,
}

// Analytics plugin
pub struct AnalyticsPlugin {
    // Track task durations, tool usage, etc.
}
```

**Plugin Loading:**
```rust
fn load_plugins(config: &Config) -> Vec<Box<dyn Plugin>> {
    let mut plugins: Vec<Box<dyn Plugin>> = vec![];

    if config.plugins.sounds.enabled {
        plugins.push(Box::new(SoundPlugin::new(&config.plugins.sounds)));
    }

    if let Some(slack_config) = &config.plugins.slack {
        plugins.push(Box::new(SlackPlugin::new(slack_config)));
    }

    // Load dynamic plugins from ~/.claude/overlay-plugins/
    for entry in fs::read_dir(plugins_dir)? {
        // Load .dll/.so plugins via libloading
    }

    plugins
}
```

### 5. State Management (Zustand)

Replace React Context with Zustand for simpler, performant state:

```typescript
// store/taskStore.ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface TaskState {
  tasks: Map<string, Task>;
  activeTasks: Task[];
  completedTasks: Task[];
  isLoading: boolean;

  // Actions
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;

  // Computed (selectors)
  getTaskById: (id: string) => Task | undefined;
  getTasksBySession: (sessionId: string) => Task[];
  searchTasks: (query: string) => Task[];
}

export const useTaskStore = create<TaskState>()(
  subscribeWithSelector((set, get) => ({
    tasks: new Map(),
    activeTasks: [],
    completedTasks: [],
    isLoading: false,

    addTask: (task) => set((state) => {
      const tasks = new Map(state.tasks);
      tasks.set(task.id, task);
      return {
        tasks,
        activeTasks: [...state.activeTasks, task],
      };
    }),

    updateTask: (id, updates) => set((state) => {
      const tasks = new Map(state.tasks);
      const existing = tasks.get(id);
      if (existing) {
        const updated = { ...existing, ...updates };
        tasks.set(id, updated);

        // Move from active to completed if status changed
        if (updates.status === 'completed' || updates.status === 'error') {
          return {
            tasks,
            activeTasks: state.activeTasks.filter(t => t.id !== id),
            completedTasks: [updated, ...state.completedTasks].slice(0, 50),
          };
        }
      }
      return { tasks };
    }),

    // ... other actions
  }))
);

// Selectors with memoization
export const selectActiveTaskCount = (state: TaskState) => state.activeTasks.length;
export const selectTasksByTool = (tool: string) => (state: TaskState) =>
  state.activeTasks.filter(t => t.tool === tool);
```

### 6. UI Components (Refactored)

**Component Structure:**
```
src/
├── components/
│   ├── layout/
│   │   ├── Overlay.tsx          # Main container
│   │   ├── TitleBar.tsx         # Draggable header
│   │   └── StatusBar.tsx        # Bottom stats
│   ├── tasks/
│   │   ├── TaskList.tsx         # Virtualized list
│   │   ├── TaskCard.tsx         # Memoized card
│   │   ├── TaskIcon.tsx         # Extracted icons
│   │   └── TaskProgress.tsx     # Progress bar
│   ├── todos/
│   │   ├── TodoSection.tsx
│   │   └── TodoItem.tsx
│   ├── search/
│   │   ├── SearchBar.tsx
│   │   └── SearchResults.tsx
│   ├── settings/
│   │   ├── SettingsPanel.tsx
│   │   ├── SettingsToggle.tsx
│   │   └── SettingsSlider.tsx
│   └── notifications/
│       └── NotificationPopup.tsx
├── hooks/
│   ├── useTaskListener.ts       # Tauri event subscription
│   ├── useKeyboardShortcuts.ts  # Global hotkeys
│   └── useSettings.ts           # Persist to backend
├── stores/
│   ├── taskStore.ts
│   ├── todoStore.ts
│   └── settingsStore.ts
├── utils/
│   ├── taskSummary.ts           # Pattern matching
│   ├── formatters.ts            # Time, duration
│   └── constants.ts             # Centralized config
└── types/
    └── index.ts                 # Shared types
```

**Memoized TaskCard:**
```tsx
// components/tasks/TaskCard.tsx
import { memo, useMemo } from 'react';
import { TaskIcon } from './TaskIcon';
import { TaskProgress } from './TaskProgress';
import { getSummary } from '@/utils/taskSummary';

interface TaskCardProps {
  task: Task;
}

export const TaskCard = memo(function TaskCard({ task }: TaskCardProps) {
  const summary = useMemo(() => getSummary(task.description), [task.description]);
  const elapsed = useElapsedTime(task.startTime, task.status === 'active');

  return (
    <div className="task-card" data-status={task.status}>
      <TaskIcon tool={task.tool} status={task.status} />
      <div className="task-content">
        <span className="task-tool">{task.tool}</span>
        <span className="task-summary">{summary}</span>
        {task.downloadProgress && <TaskProgress percent={task.downloadProgress} />}
      </div>
      <span className="task-elapsed">{formatDuration(elapsed)}</span>
    </div>
  );
}, (prev, next) => {
  // Custom comparison for performance
  return prev.task.id === next.task.id &&
         prev.task.status === next.task.status &&
         prev.task.downloadProgress === next.task.downloadProgress;
});
```

**Virtualized Task List:**
```tsx
// components/tasks/TaskList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { TaskCard } from './TaskCard';

export function TaskList({ tasks }: { tasks: Task[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60, // Estimated row height
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="task-list-container">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size,
              width: '100%',
            }}
          >
            <TaskCard task={tasks[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 7. Configuration System

**Centralized Config:**
```rust
// src-tauri/src/config.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub window: WindowConfig,
    pub behavior: BehaviorConfig,
    pub plugins: PluginsConfig,
    pub shortcuts: ShortcutsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    pub position: Position,
    pub always_on_top: bool,
    pub opacity: f64,
    pub theme: Theme,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorConfig {
    pub max_recent_tasks: usize,
    pub auto_hide: bool,
    pub auto_hide_delay_ms: u64,
    pub stale_task_threshold_ms: u64,
    pub notification_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutsConfig {
    pub toggle_visibility: String,  // "Ctrl+Shift+P"
    pub clear_tasks: String,        // "Ctrl+Shift+C"
    pub open_settings: String,      // "Ctrl+,"
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = dirs::home_dir()
            .unwrap()
            .join(".claude")
            .join("overlay-config.toml");

        if path.exists() {
            let content = fs::read_to_string(&path)?;
            Ok(toml::from_str(&content)?)
        } else {
            let default = Self::default();
            default.save()?;
            Ok(default)
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = dirs::home_dir()
            .unwrap()
            .join(".claude")
            .join("overlay-config.toml");

        let content = toml::to_string_pretty(self)?;
        fs::write(&path, content)?;
        Ok(())
    }
}
```

**Config File (overlay-config.toml):**
```toml
[window]
width = 320
height = 400
position = "bottom-right"
always_on_top = true
opacity = 0.95
theme = "dark"

[behavior]
max_recent_tasks = 10
auto_hide = false
auto_hide_delay_ms = 3000
stale_task_threshold_ms = 300000  # 5 minutes
notification_duration_ms = 2000

[shortcuts]
toggle_visibility = "Ctrl+Shift+P"
clear_tasks = "Ctrl+Shift+C"
open_settings = "Ctrl+,"

[plugins.sounds]
enabled = true
success_sound = "~/.claude/sounds/success.wav"
error_sound = "~/.claude/sounds/error.wav"

[plugins.slack]
enabled = false
webhook_url = ""
notify_on_error = true
```

### 8. Keyboard Shortcuts

**Global Hotkeys (Rust):**
```rust
use tauri_plugin_global_shortcut::{GlobalShortcutManager, Shortcut};

fn setup_shortcuts(app: &AppHandle, config: &Config) -> Result<()> {
    let manager = app.global_shortcut_manager();

    // Toggle visibility
    let toggle_shortcut = Shortcut::try_from(config.shortcuts.toggle_visibility.as_str())?;
    manager.register(toggle_shortcut, move |_| {
        if let Some(window) = app.get_webview_window("main") {
            if window.is_visible().unwrap_or(false) {
                window.hide().ok();
            } else {
                window.show().ok();
                window.set_focus().ok();
            }
        }
    })?;

    // Clear tasks
    let clear_shortcut = Shortcut::try_from(config.shortcuts.clear_tasks.as_str())?;
    manager.register(clear_shortcut, move |_| {
        app.emit_all("clear-tasks", ()).ok();
    })?;

    Ok(())
}
```

---

## Migration Path

### Phase 1: Foundation (Week 1)
1. Set up SQLite with rusqlite
2. Implement EventStore
3. Switch to `notify` crate for file watching
4. Add basic config system

### Phase 2: Event System (Week 2)
1. Implement EventRouter
2. Add broadcast channels for UI updates
3. Create plugin trait and context
4. Port existing logic to new architecture

### Phase 3: Frontend (Week 3)
1. Migrate to Zustand
2. Extract icons to shared component
3. Implement virtualized list
4. Add search functionality

### Phase 4: Polish (Week 4)
1. Add keyboard shortcuts
2. Implement sound plugin
3. Add light theme
4. Write tests
5. Performance profiling

---

## New Dependencies

**Rust (Cargo.toml):**
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "devtools"] }
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
notify = "6"
notify-debouncer-mini = "0.4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
tracing = "0.1"
tracing-subscriber = "0.3"
dirs = "5"
async-trait = "0.1"
```

**Frontend (package.json):**
```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tanstack/react-virtual": "^3.0.0",
    "zustand": "^4.5.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  }
}
```

---

## Estimated Improvements

| Metric | Current | Projected |
|--------|---------|-----------|
| Idle CPU | ~2-5% | < 0.1% |
| Event latency | 200ms avg | < 10ms |
| Memory (100 tasks) | ~50MB | ~30MB |
| Startup time | ~1s | ~0.5s |
| Task history | 0 (lost on restart) | Unlimited |
| Search capability | None | Full-text |

---

## Questions to Resolve

1. **Event ingestion**: Named pipe (Windows-only) or file watch (cross-platform)?
2. **Plugin distribution**: Dynamic loading (.dll) or compile-time only?
3. **Theme system**: CSS variables or Tailwind config?
4. **Notification position**: Follow main window or independent setting?
5. **Search scope**: Current session only or all history?
