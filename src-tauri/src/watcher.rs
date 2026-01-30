//! File watching system using the notify crate
//!
//! Replaces polling with event-driven file watching for reduced CPU usage.

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::config::Config;

/// Event types that can be parsed from the JSONL file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub task_id: String,
    pub tool: Option<String>,
    pub description: Option<String>,
    pub session_id: Option<String>,
    pub timestamp: u64,
    pub background: Option<bool>,
    pub subagent_type: Option<String>,
    pub duration_ms: Option<u64>,
}

/// Todo item from JSON files
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: String,
    #[serde(rename = "activeForm")]
    pub active_form: String,
}

/// Todo item with session context
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GlobalTodoItem {
    pub content: String,
    pub status: String,
    #[serde(rename = "activeForm")]
    pub active_form: String,
    pub session_id: String,
}

/// Download progress event
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub timestamp: u64,
}

/// State for tracking file positions
struct FileState {
    last_position: u64,
    last_size: u64,
}

/// Events emitted by the file watcher
#[derive(Debug, Clone)]
pub enum WatcherEvent {
    TaskEvent(TaskEvent),
    TodosUpdated(Vec<GlobalTodoItem>),
    DownloadProgress(DownloadProgress),
    Error(String),
}

/// File watcher that uses notify for event-driven watching
pub struct FileWatcher {
    events_path: PathBuf,
    todos_path: PathBuf,
    download_progress_path: PathBuf,
    debounce_ms: u64,
}

impl FileWatcher {
    /// Create a new file watcher from config
    pub fn new(config: &Config) -> Self {
        Self {
            events_path: config.events_path(),
            todos_path: config.todos_path(),
            download_progress_path: config.events_path().parent()
                .unwrap_or(Path::new("."))
                .join("download-progress.json"),
            debounce_ms: config.behavior.file_watch_debounce_ms,
        }
    }

    /// Start watching files and return a receiver for events
    pub fn start(&self) -> Result<Receiver<WatcherEvent>, WatcherError> {
        let (tx, rx) = mpsc::channel::<WatcherEvent>();

        // Ensure files exist
        self.ensure_files_exist()?;

        // Initialize file state (start from end of events file)
        let initial_size = fs::metadata(&self.events_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let file_state = Arc::new(Mutex::new(FileState {
            last_position: initial_size,
            last_size: initial_size,
        }));

        // Clone paths for the watcher thread
        let events_path = self.events_path.clone();
        let todos_path = self.todos_path.clone();
        let download_path = self.download_progress_path.clone();
        let debounce_ms = self.debounce_ms;
        let tx_clone = tx.clone();

        // Spawn watcher thread
        std::thread::spawn(move || {
            if let Err(e) = run_watcher(
                events_path,
                todos_path,
                download_path,
                file_state,
                tx_clone,
                debounce_ms,
            ) {
                tracing::error!("File watcher error: {}", e);
            }
        });

        // Emit initial todos
        let initial_todos = read_all_todos(&self.todos_path);
        if !initial_todos.is_empty() {
            let _ = tx.send(WatcherEvent::TodosUpdated(initial_todos));
        }

        Ok(rx)
    }

    fn ensure_files_exist(&self) -> Result<(), WatcherError> {
        // Ensure parent directory exists
        if let Some(parent) = self.events_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| WatcherError::IoError(e.to_string()))?;
        }

        // Create events file if it doesn't exist
        if !self.events_path.exists() {
            File::create(&self.events_path)
                .map_err(|e| WatcherError::IoError(e.to_string()))?;
        }

        // Create todos directory if it doesn't exist
        fs::create_dir_all(&self.todos_path)
            .map_err(|e| WatcherError::IoError(e.to_string()))?;

        Ok(())
    }
}

/// Run the file watcher (called in a separate thread)
fn run_watcher(
    events_path: PathBuf,
    todos_path: PathBuf,
    download_path: PathBuf,
    file_state: Arc<Mutex<FileState>>,
    tx: mpsc::Sender<WatcherEvent>,
    debounce_ms: u64,
) -> Result<(), WatcherError> {
    // Create debounced watcher
    let (notify_tx, notify_rx) = mpsc::channel();

    let mut debouncer = new_debouncer(
        Duration::from_millis(debounce_ms),
        notify_tx,
    ).map_err(|e| WatcherError::WatchError(e.to_string()))?;

    // Watch events file
    debouncer.watcher()
        .watch(&events_path, RecursiveMode::NonRecursive)
        .map_err(|e| WatcherError::WatchError(e.to_string()))?;

    // Watch todos directory
    debouncer.watcher()
        .watch(&todos_path, RecursiveMode::Recursive)
        .map_err(|e| WatcherError::WatchError(e.to_string()))?;

    // Watch download progress file if it exists
    if download_path.exists() {
        let _ = debouncer.watcher()
            .watch(&download_path, RecursiveMode::NonRecursive);
    }

    tracing::info!("File watcher started");
    tracing::debug!("Watching: {:?}", events_path);
    tracing::debug!("Watching: {:?}", todos_path);

    // Process events
    for result in notify_rx {
        match result {
            Ok(events) => {
                for event in events {
                    handle_file_event(
                        &event,
                        &events_path,
                        &todos_path,
                        &download_path,
                        &file_state,
                        &tx,
                    );
                }
            }
            Err(e) => {
                tracing::error!("Watch error: {:?}", e);
                let _ = tx.send(WatcherEvent::Error(format!("{:?}", e)));
            }
        }
    }

    Ok(())
}

/// Handle a single file event
fn handle_file_event(
    event: &DebouncedEvent,
    events_path: &Path,
    todos_path: &Path,
    download_path: &Path,
    file_state: &Arc<Mutex<FileState>>,
    tx: &mpsc::Sender<WatcherEvent>,
) {
    let path = &event.path;

    if path == events_path {
        // Events file changed - read new events
        if let Ok(mut state) = file_state.lock() {
            let events = read_new_events(events_path, &mut state);
            for event in events {
                tracing::debug!("Task event: {} - {}", event.event_type, event.task_id);
                let _ = tx.send(WatcherEvent::TaskEvent(event));
            }
        }
    } else if path.starts_with(todos_path) && path.extension().map_or(false, |e| e == "json") {
        // Todos file changed - read all todos
        let todos = read_all_todos(todos_path);
        tracing::debug!("Todos updated: {} items", todos.len());
        let _ = tx.send(WatcherEvent::TodosUpdated(todos));
    } else if path == download_path {
        // Download progress changed
        if let Some(progress) = read_download_progress(download_path) {
            tracing::debug!("Download progress: {}%", progress.percent);
            let _ = tx.send(WatcherEvent::DownloadProgress(progress));
        }
    }
}

/// Read new events from the JSONL file (incremental)
fn read_new_events(path: &Path, state: &mut FileState) -> Vec<TaskEvent> {
    let mut events = Vec::new();

    if !path.exists() {
        return events;
    }

    // Check current file size
    let current_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    // Handle file truncation (e.g., when cleared)
    if current_size < state.last_size {
        tracing::debug!("Events file truncated, resetting position");
        state.last_position = 0;
    }

    // No new data
    if current_size <= state.last_position {
        state.last_size = current_size;
        return events;
    }

    // Open and seek to last position
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("Failed to open events file: {}", e);
            return events;
        }
    };

    let mut reader = BufReader::new(file);

    if reader.seek(SeekFrom::Start(state.last_position)).is_err() {
        return events;
    }

    // Read new lines
    let mut line = String::new();
    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            match serde_json::from_str::<TaskEvent>(trimmed) {
                Ok(event) => events.push(event),
                Err(e) => tracing::warn!("Failed to parse event: {} - line: {}", e, trimmed),
            }
        }
        line.clear();
    }

    // Update position
    state.last_position = reader.stream_position().unwrap_or(state.last_position);
    state.last_size = current_size;

    events
}

/// Read all todos from the todos directory
fn read_all_todos(todos_dir: &Path) -> Vec<GlobalTodoItem> {
    let mut all_todos = Vec::new();

    if !todos_dir.exists() {
        return all_todos;
    }

    let entries = match fs::read_dir(todos_dir) {
        Ok(e) => e,
        Err(_) => return all_todos,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "json") {
            if let Some(todos) = read_todos_file(&path) {
                // Only include files with active todos
                let has_active = todos.iter().any(|t| t.status != "completed");
                if has_active {
                    let session_id = extract_session_id(&path);

                    for todo in todos {
                        if todo.status != "completed" {
                            all_todos.push(GlobalTodoItem {
                                content: todo.content,
                                status: todo.status,
                                active_form: todo.active_form,
                                session_id: session_id.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    all_todos
}

/// Read a single todos JSON file
fn read_todos_file(path: &Path) -> Option<Vec<TodoItem>> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Extract session ID from filename
fn extract_session_id(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| {
            if let Some(pos) = name.find("-agent-") {
                name[..pos].to_string()
            } else {
                name.trim_end_matches(".json").to_string()
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Read download progress from file
fn read_download_progress(path: &Path) -> Option<DownloadProgress> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Watcher errors
#[derive(Debug, Clone)]
pub enum WatcherError {
    IoError(String),
    WatchError(String),
}

impl std::fmt::Display for WatcherError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WatcherError::IoError(e) => write!(f, "IO error: {}", e),
            WatcherError::WatchError(e) => write!(f, "Watch error: {}", e),
        }
    }
}

impl std::error::Error for WatcherError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_read_new_events() {
        let dir = tempdir().unwrap();
        let events_path = dir.path().join("events.jsonl");

        // Create file with initial event
        let mut file = File::create(&events_path).unwrap();
        writeln!(file, r#"{{"type":"task_started","task_id":"t1","timestamp":1000}}"#).unwrap();

        let mut state = FileState {
            last_position: 0,
            last_size: 0,
        };

        let events = read_new_events(&events_path, &mut state);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].task_id, "t1");

        // Add another event
        writeln!(file, r#"{{"type":"task_complete","task_id":"t1","timestamp":2000}}"#).unwrap();

        let events = read_new_events(&events_path, &mut state);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "task_complete");
    }

    #[test]
    fn test_extract_session_id() {
        let path = PathBuf::from("/tmp/abc123-agent-def456.json");
        assert_eq!(extract_session_id(&path), "abc123");

        let path = PathBuf::from("/tmp/session-id.json");
        assert_eq!(extract_session_id(&path), "session-id");
    }
}
