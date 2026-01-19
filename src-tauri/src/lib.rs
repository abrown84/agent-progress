use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

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

struct FileWatcherState {
    last_position: u64,
    last_size: u64,
}

fn get_events_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("progress-events.jsonl")
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_window,
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

    // Ensure parent directory exists
    if let Some(parent) = events_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Create file if it doesn't exist
    if !events_path.exists() {
        let _ = File::create(&events_path);
    }

    // Start from end of file - only show new events from this point forward
    let initial_size = fs::metadata(&events_path).map(|m| m.len()).unwrap_or(0);

    let state = Arc::new(Mutex::new(FileWatcherState {
        last_position: initial_size,  // Start from end - only new events
        last_size: initial_size,
    }));

    // Simple polling loop - check every 200ms
    loop {
        std::thread::sleep(Duration::from_millis(200));

        if let Ok(mut s) = state.lock() {
            let events = read_new_events(&events_path, &mut s);
            if !events.is_empty() {
                println!("[Overlay] Read {} events", events.len());
            }
            for event in events {
                println!("[Overlay] Emitting: {} - {}", event.event_type, event.task_id);
                if let Err(e) = app.emit("task-event", &event) {
                    eprintln!("[Overlay] Emit error: {}", e);
                }
            }
        }
    }
}
