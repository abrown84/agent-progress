use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub content: String,
    pub status: String,
    #[serde(rename = "activeForm")]
    pub active_form: String,
}

struct FileWatcherState {
    last_position: u64,
    last_size: u64,
    last_todos_modified: Option<std::time::SystemTime>,
    last_download_progress_modified: Option<std::time::SystemTime>,
}

// Track active notification windows
struct NotificationManager {
    // task_id -> window_label
    active_windows: HashMap<String, String>,
    // Counter for unique window labels
    window_counter: u64,
}

impl NotificationManager {
    fn new() -> Self {
        Self {
            active_windows: HashMap::new(),
            window_counter: 0,
        }
    }

    fn next_label(&mut self) -> String {
        self.window_counter += 1;
        format!("notification-{}", self.window_counter)
    }
}

fn get_events_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("progress-events.jsonl")
}

fn get_todos_dir_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("todos")
}

fn find_most_recent_todo_file() -> Option<PathBuf> {
    let todos_dir = get_todos_dir_path();
    if !todos_dir.exists() {
        return None;
    }

    let mut most_recent: Option<(PathBuf, std::time::SystemTime)> = None;

    if let Ok(entries) = fs::read_dir(&todos_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        match &most_recent {
                            None => most_recent = Some((path, modified)),
                            Some((_, best_time)) if modified > *best_time => {
                                most_recent = Some((path, modified));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    most_recent.map(|(path, _)| path)
}

fn get_download_progress_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("download-progress.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub timestamp: u64,
}

fn read_todos(path: &PathBuf) -> Option<Vec<TodoItem>> {
    if !path.exists() {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn read_new_events(path: &PathBuf, state: &mut FileWatcherState) -> Vec<TaskEvent> {
    let mut events = Vec::new();

    if !path.exists() {
        return events;
    }

    // Check if file size changed
    let current_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    // Handle file truncation (e.g., when cleared)
    if current_size < state.last_size {
        state.last_position = 0;
    }

    // No new data
    if current_size <= state.last_position {
        state.last_size = current_size;
        return events;
    }

    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return events,
    };

    let mut reader = BufReader::new(file);

    // Seek to last known position
    if reader.seek(SeekFrom::Start(state.last_position)).is_err() {
        return events;
    }

    let mut line = String::new();
    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        if let Ok(event) = serde_json::from_str::<TaskEvent>(&line) {
            events.push(event);
        }
        line.clear();
    }

    // Update position
    state.last_position = reader.stream_position().unwrap_or(state.last_position);
    state.last_size = current_size;

    events
}

fn position_window(window: &WebviewWindow, position: &str) {
    if let Ok(monitor) = window.current_monitor() {
        if let Some(monitor) = monitor {
            let size = monitor.size();
            let scale = monitor.scale_factor();

            let taskbar_height = 40.0;
            let padding = 20.0;
            let window_width = 320.0;
            let window_height = 400.0;

            let screen_width = size.width as f64 / scale;
            let screen_height = size.height as f64 / scale;

            let (x, y) = match position {
                "top-left" => (padding, padding),
                "top-right" => (screen_width - window_width - padding, padding),
                "bottom-left" => (padding, screen_height - window_height - taskbar_height - padding),
                _ => (
                    screen_width - window_width - padding,
                    screen_height - window_height - taskbar_height - padding,
                ), // bottom-right default
            };

            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(x, y),
            ));
        }
    }
}

#[tauri::command]
fn set_window_position(window: WebviewWindow, position: String) {
    position_window(&window, &position);
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, enabled: bool) {
    let _ = window.set_always_on_top(enabled);
}

#[tauri::command]
fn set_opacity(window: WebviewWindow, opacity: f64) {
    // Tauri doesn't have direct opacity API, but we can use alpha on the window
    // For now, we'll emit an event to handle it via CSS
    let _ = window.emit("opacity-change", opacity);
}

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn show_window(window: WebviewWindow) {
    let _ = window.show();
}

#[tauri::command]
fn show_notification_ready(window: WebviewWindow) {
    // Called by notification window when content is loaded
    let _ = window.show();
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn toggle_devtools(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn clear_events() -> Result<(), String> {
    let path = get_events_file_path();
    if path.exists() {
        fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Notification window dimensions
const NOTIFICATION_WIDTH: f64 = 320.0;
const NOTIFICATION_HEIGHT: f64 = 70.0;
const NOTIFICATION_PADDING: f64 = 10.0;
const NOTIFICATION_GAP: f64 = 8.0;
const TASKBAR_HEIGHT: f64 = 40.0;

fn create_notification_window(
    app: &AppHandle,
    manager: &mut NotificationManager,
    event: &TaskEvent,
) -> Option<String> {
    let label = manager.next_label();

    // Encode task data as URL parameter
    let task_data = serde_json::json!({
        "task_id": event.task_id,
        "tool": event.tool,
        "description": event.description,
        "subagent_type": event.subagent_type,
        "background": event.background,
    });
    let task_data_str = task_data.to_string();
    let encoded = urlencoding::encode(&task_data_str);

    // Calculate position based on number of active windows
    let stack_index = manager.active_windows.len();

    // Get monitor info for positioning
    let (x, y) = if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let screen_width = size.width as f64 / scale;
            let screen_height = size.height as f64 / scale;

            // Stack from bottom-right, going up
            let x = screen_width - NOTIFICATION_WIDTH - NOTIFICATION_PADDING;
            let y = screen_height - TASKBAR_HEIGHT - NOTIFICATION_PADDING
                - ((stack_index + 1) as f64 * (NOTIFICATION_HEIGHT + NOTIFICATION_GAP));
            (x, y)
        } else {
            (800.0, 400.0)
        }
    } else {
        (800.0, 400.0)
    };

    // Create the notification window
    let url = format!("/notification.html?task={}", encoded);

    match WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Task")
        .inner_size(NOTIFICATION_WIDTH, NOTIFICATION_HEIGHT)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .resizable(false)
        .visible(false)  // Start hidden, show when content is ready
        .build()
    {
        Ok(_) => {
            manager.active_windows.insert(event.task_id.clone(), label.clone());
            println!("[Overlay] Created notification window: {} for task {}", label, event.task_id);
            Some(label)
        }
        Err(e) => {
            eprintln!("[Overlay] Failed to create notification: {}", e);
            None
        }
    }
}

fn close_notification_window(
    app: &AppHandle,
    manager: &mut NotificationManager,
    task_id: &str,
    status: &str,
) {
    if let Some(label) = manager.active_windows.remove(task_id) {
        // Emit completion status to the window before closing
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit("task-complete", serde_json::json!({
                "task_id": task_id,
                "status": status
            }));

            // Close after delay to show completion state
            let window_clone = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2000));
                let _ = window_clone.close();
            });
        }
        println!("[Overlay] Closing notification: {} for task {}", label, task_id);
    }

    // Reposition remaining windows to fill gaps
    reposition_notification_windows(app, manager);
}

fn reposition_notification_windows(app: &AppHandle, manager: &NotificationManager) {
    // Get monitor info
    let (screen_width, screen_height) = if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            (size.width as f64 / scale, size.height as f64 / scale)
        } else {
            return;
        }
    } else {
        return;
    };

    // Reposition each window
    for (index, label) in manager.active_windows.values().enumerate() {
        if let Some(window) = app.get_webview_window(label) {
            let x = screen_width - NOTIFICATION_WIDTH - NOTIFICATION_PADDING;
            let y = screen_height - TASKBAR_HEIGHT - NOTIFICATION_PADDING
                - ((index + 1) as f64 * (NOTIFICATION_HEIGHT + NOTIFICATION_GAP));
            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(x, y),
            ));
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_window,
            show_notification_ready,
            close_app,
            clear_events,
            toggle_devtools,
            set_window_position,
            set_always_on_top,
            set_opacity,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Position window in bottom-right corner (default)
            position_window(&window, "bottom-right");

            // Create system tray icon
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};

            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let icon = app.default_window_icon().cloned().expect("no default icon");

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Agent Progress")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app: &AppHandle = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Start file poller
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                start_file_poller(app_handle);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_file_poller(app: AppHandle) {
    let events_path = get_events_file_path();
    let todos_dir = get_todos_dir_path();
    let download_progress_path = get_download_progress_path();

    // Ensure parent directory exists
    if let Some(parent) = events_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Create events file if it doesn't exist
    if !events_path.exists() {
        let _ = File::create(&events_path);
    }

    // Start from end of file - only show new events from this point forward
    let initial_size = fs::metadata(&events_path).map(|m| m.len()).unwrap_or(0);

    // Get initial todos directory modified time
    let initial_todos_modified = fs::metadata(&todos_dir)
        .and_then(|m| m.modified())
        .ok();

    // Get initial download progress modified time
    let initial_download_progress_modified = fs::metadata(&download_progress_path)
        .and_then(|m| m.modified())
        .ok();

    let state = Arc::new(Mutex::new(FileWatcherState {
        last_position: initial_size,  // Start from end - only new events
        last_size: initial_size,
        last_todos_modified: initial_todos_modified,
        last_download_progress_modified: initial_download_progress_modified,
    }));

    // Notification manager
    let notification_manager = Arc::new(Mutex::new(NotificationManager::new()));

    // Emit initial todos from most recent file
    if let Some(todo_file) = find_most_recent_todo_file() {
        if let Some(todos) = read_todos(&todo_file) {
            println!("[Overlay] Initial todos from {:?}: {} items", todo_file.file_name(), todos.len());
            let _ = app.emit("todos-update", &todos);
        }
    }

    // Simple polling loop - check every 200ms
    loop {
        std::thread::sleep(Duration::from_millis(200));

        if let Ok(mut s) = state.lock() {
            // Check for new task events
            let events = read_new_events(&events_path, &mut s);
            if !events.is_empty() {
                println!("[Overlay] Read {} events", events.len());
            }
            for event in events {
                println!("[Overlay] Emitting: {} - {}", event.event_type, event.task_id);
                if let Err(e) = app.emit("task-event", &event) {
                    eprintln!("[Overlay] Emit error: {}", e);
                }

                // Handle notification windows
                if let Ok(mut nm) = notification_manager.lock() {
                    match event.event_type.as_str() {
                        "task_started" => {
                            // Create notification window for new task
                            create_notification_window(&app, &mut nm, &event);
                        }
                        "task_complete" => {
                            // Close notification with success status
                            close_notification_window(&app, &mut nm, &event.task_id, "complete");
                        }
                        "task_error" => {
                            // Close notification with error status
                            close_notification_window(&app, &mut nm, &event.task_id, "error");
                        }
                        "task_canceled" => {
                            // Close notification immediately for canceled tasks
                            if let Some(label) = nm.active_windows.remove(&event.task_id) {
                                if let Some(window) = app.get_webview_window(&label) {
                                    let _ = window.close();
                                }
                                reposition_notification_windows(&app, &nm);
                            }
                        }
                        "session_stopped" => {
                            // Close all active notifications when session is stopped
                            let labels: Vec<String> = nm.active_windows.values().cloned().collect();
                            for label in labels {
                                if let Some(window) = app.get_webview_window(&label) {
                                    let _ = window.close();
                                }
                            }
                            nm.active_windows.clear();
                            println!("[Overlay] Session stopped - closed all notification windows");
                        }
                        _ => {}
                    }
                }
            }

            // Check for todos updates - watch the directory for changes
            let current_todos_modified = fs::metadata(&todos_dir)
                .and_then(|m| m.modified())
                .ok();

            // Also check if most recent file has changed
            let todo_file_changed = if let Some(todo_file) = find_most_recent_todo_file() {
                let file_modified = fs::metadata(&todo_file)
                    .and_then(|m| m.modified())
                    .ok();
                file_modified != s.last_todos_modified
            } else {
                false
            };

            if current_todos_modified != s.last_todos_modified || todo_file_changed {
                if let Some(todo_file) = find_most_recent_todo_file() {
                    s.last_todos_modified = fs::metadata(&todo_file)
                        .and_then(|m| m.modified())
                        .ok();
                    if let Some(todos) = read_todos(&todo_file) {
                        println!("[Overlay] Todos updated from {:?}: {} items", todo_file.file_name(), todos.len());
                        if let Err(e) = app.emit("todos-update", &todos) {
                            eprintln!("[Overlay] Todos emit error: {}", e);
                        }
                    }
                }
            }

            // Check for download progress updates
            let current_download_progress_modified = fs::metadata(&download_progress_path)
                .and_then(|m| m.modified())
                .ok();

            if current_download_progress_modified != s.last_download_progress_modified {
                s.last_download_progress_modified = current_download_progress_modified;
                if let Ok(content) = fs::read_to_string(&download_progress_path) {
                    if let Ok(progress) = serde_json::from_str::<DownloadProgress>(&content) {
                        println!("[Overlay] Download progress: {}%", progress.percent);
                        if let Err(e) = app.emit("download-progress", &progress) {
                            eprintln!("[Overlay] Download progress emit error: {}", e);
                        }
                    }
                }
            }
        }
    }
}
