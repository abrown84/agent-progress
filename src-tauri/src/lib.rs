//! Agent Progress Overlay v2
//!
//! A lightweight desktop overlay for visualizing AI agent task progress in real-time.
//!
//! ## Architecture (v2)
//!
//! - **Config**: TOML-based configuration system
//! - **Store**: SQLite for task history persistence
//! - **Watcher**: Event-driven file watching (notify crate)
//! - **Router**: Central event hub with plugin support

pub mod config;
pub mod store;
pub mod watcher;
pub mod router;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewUrl, WebviewWindowBuilder};

use config::Config;
use store::EventStore;
use watcher::{FileWatcher, WatcherEvent, TaskEvent};
use router::EventRouter;

// ============================================================================
// Notification Window Management (kept from v1 for UI compatibility)
// ============================================================================

struct NotificationManager {
    active_windows: HashMap<String, (String, Instant)>,
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

const NOTIFICATION_WIDTH: f64 = 320.0;
const NOTIFICATION_HEIGHT: f64 = 70.0;
const NOTIFICATION_PADDING: f64 = 10.0;
const NOTIFICATION_GAP: f64 = 8.0;
const TASKBAR_HEIGHT: f64 = 40.0;
const MIN_NOTIFICATION_DISPLAY_MS: u64 = 2000;

fn create_notification_window(
    app: &AppHandle,
    manager: &mut NotificationManager,
    event: &TaskEvent,
) -> Option<String> {
    let label = manager.next_label();

    let task_data = serde_json::json!({
        "task_id": event.task_id,
        "tool": event.tool,
        "description": event.description,
        "subagent_type": event.subagent_type,
        "background": event.background,
    });
    let task_data_str = task_data.to_string();
    let encoded = urlencoding::encode(&task_data_str);

    let stack_index = manager.active_windows.len();

    let (x, y) = if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let screen_width = size.width as f64 / scale;
            let screen_height = size.height as f64 / scale;

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
        .visible(false)
        .build()
    {
        Ok(_) => {
            manager.active_windows.insert(
                event.task_id.clone(),
                (label.clone(), Instant::now()),
            );
            tracing::debug!("Created notification window: {} for task {}", label, event.task_id);
            Some(label)
        }
        Err(e) => {
            tracing::error!("Failed to create notification: {}", e);
            None
        }
    }
}

fn close_notification_window(
    app: &AppHandle,
    manager: &mut NotificationManager,
    task_id: &str,
) {
    if let Some((label, created_at)) = manager.active_windows.remove(task_id) {
        let elapsed = created_at.elapsed().as_millis() as u64;

        if elapsed < MIN_NOTIFICATION_DISPLAY_MS {
            let remaining = MIN_NOTIFICATION_DISPLAY_MS - elapsed;
            let app_clone = app.clone();
            let label_clone = label.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(remaining));
                if let Some(window) = app_clone.get_webview_window(&label_clone) {
                    let _ = window.close();
                }
            });
        } else {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }

    reposition_notification_windows(app, manager);
}

fn reposition_notification_windows(app: &AppHandle, manager: &NotificationManager) {
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

    for (index, (label, _)) in manager.active_windows.values().enumerate() {
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

// ============================================================================
// Window Positioning
// ============================================================================

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
                ),
            };

            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(x, y),
            ));
        }
    }
}

// ============================================================================
// Tauri Commands (kept for frontend compatibility)
// ============================================================================

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
fn clear_events(_app: AppHandle) -> Result<(), String> {
    let config = Config::load().map_err(|e| e.to_string())?;
    let path = config.events_path();
    if path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

// New v2 commands

#[tauri::command]
fn get_task_stats(_app: AppHandle) -> Result<store::TaskStats, String> {
    let config = Config::load().map_err(|e| e.to_string())?;
    let store = EventStore::new(&config.database_path()).map_err(|e| e.to_string())?;
    store.get_task_stats().map_err(|e| e.to_string())
}

#[tauri::command]
fn search_tasks(_app: AppHandle, query: String, limit: usize) -> Result<Vec<store::StoredTask>, String> {
    let config = Config::load().map_err(|e| e.to_string())?;
    let store = EventStore::new(&config.database_path()).map_err(|e| e.to_string())?;
    store.search_tasks(&query, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recent_tasks(_app: AppHandle, limit: usize) -> Result<Vec<store::StoredTask>, String> {
    let config = Config::load().map_err(|e| e.to_string())?;
    let store = EventStore::new(&config.database_path()).map_err(|e| e.to_string())?;
    store.get_recent_tasks(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config() -> Result<Config, String> {
    Config::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

// ============================================================================
// Application Entry Point
// ============================================================================

pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("agent_progress_overlay=debug".parse().unwrap())
                .add_directive("progress_overlay_lib=debug".parse().unwrap())
        )
        .init();

    tracing::info!("Starting Agent Progress Overlay v2");

    // Load configuration
    let config = Config::load().unwrap_or_else(|e| {
        tracing::warn!("Failed to load config: {}, using defaults", e);
        Config::default()
    });

    let config = Arc::new(config);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // v1 commands (backward compatible)
            hide_window,
            show_window,
            show_notification_ready,
            close_app,
            clear_events,
            toggle_devtools,
            set_window_position,
            set_always_on_top,
            set_opacity,
            // v2 commands
            get_task_stats,
            search_tasks,
            get_recent_tasks,
            get_config,
            save_config,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Position window based on config
            position_window(&window, &config.window.position);

            // Set always on top
            if config.window.always_on_top {
                let _ = window.set_always_on_top(true);
            }

            // Create system tray
            setup_system_tray(app)?;

            // Initialize store
            let store = match EventStore::new(&config.database_path()) {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    tracing::error!("Failed to initialize store: {}", e);
                    // Continue without persistence
                    Arc::new(EventStore::in_memory().unwrap())
                }
            };

            // Create event router
            let router = Arc::new(EventRouter::new(store.clone(), config.clone()));

            // Start file watcher
            let watcher = FileWatcher::new(&config);
            let app_handle = app.handle().clone();
            let notification_manager = Arc::new(Mutex::new(NotificationManager::new()));

            std::thread::spawn(move || {
                match watcher.start() {
                    Ok(rx) => {
                        tracing::info!("File watcher started successfully");

                        for event in rx {
                            // Process through router (stores to DB)
                            router.process_watcher_event(event.clone());

                            // Emit to frontend and handle notifications
                            match event {
                                WatcherEvent::TaskEvent(ref task_event) => {
                                    // Emit to frontend
                                    if let Err(e) = app_handle.emit("task-event", task_event) {
                                        tracing::error!("Failed to emit task event: {}", e);
                                    }

                                    // Handle notification windows
                                    if let Ok(mut nm) = notification_manager.lock() {
                                        match task_event.event_type.as_str() {
                                            "task_started" => {
                                                create_notification_window(&app_handle, &mut nm, task_event);
                                            }
                                            "task_complete" | "task_error" => {
                                                close_notification_window(&app_handle, &mut nm, &task_event.task_id);
                                            }
                                            "task_canceled" => {
                                                if let Some((label, _)) = nm.active_windows.remove(&task_event.task_id) {
                                                    if let Some(window) = app_handle.get_webview_window(&label) {
                                                        let _ = window.close();
                                                    }
                                                    reposition_notification_windows(&app_handle, &nm);
                                                }
                                            }
                                            "session_stopped" => {
                                                let labels: Vec<String> = nm.active_windows.values()
                                                    .map(|(label, _)| label.clone())
                                                    .collect();
                                                for label in labels {
                                                    if let Some(window) = app_handle.get_webview_window(&label) {
                                                        let _ = window.close();
                                                    }
                                                }
                                                nm.active_windows.clear();
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                WatcherEvent::TodosUpdated(ref todos) => {
                                    if let Err(e) = app_handle.emit("todos-update", todos) {
                                        tracing::error!("Failed to emit todos: {}", e);
                                    }
                                }
                                WatcherEvent::DownloadProgress(ref progress) => {
                                    // Emit to all windows
                                    for window in app_handle.webview_windows().values() {
                                        let _ = window.emit("download-progress", progress);
                                    }
                                }
                                WatcherEvent::Error(e) => {
                                    tracing::error!("Watcher error: {}", e);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to start file watcher: {}", e);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
        .tooltip("Agent Progress Overlay")
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
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
