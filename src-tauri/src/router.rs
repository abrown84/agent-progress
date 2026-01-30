//! Event router - central hub for dispatching events to plugins and UI
//!
//! Connects the file watcher to the store and Tauri frontend.

use std::sync::Arc;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::store::{EventStore, StoredTask, StoreError};
use crate::watcher::{TaskEvent, GlobalTodoItem, DownloadProgress, WatcherEvent};

/// Application events that can be broadcast
#[derive(Debug, Clone)]
pub enum AppEvent {
    TaskStarted(TaskEvent),
    TaskCompleted { task_id: String, timestamp: u64 },
    TaskError { task_id: String, timestamp: u64 },
    TaskCanceled { task_id: String },
    SessionStopped { session_id: Option<String> },
    TodosUpdated(Vec<GlobalTodoItem>),
    DownloadProgress(DownloadProgress),
}

/// Event router that processes events and dispatches to subscribers
pub struct EventRouter {
    store: Arc<EventStore>,
    #[allow(dead_code)]
    config: Arc<Config>,  // Reserved for future plugin configuration
    sender: broadcast::Sender<AppEvent>,
}

impl EventRouter {
    /// Create a new event router
    pub fn new(store: Arc<EventStore>, config: Arc<Config>) -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { store, config, sender }
    }

    /// Get a receiver for subscribing to events
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }

    /// Process a watcher event and dispatch to subscribers
    pub fn process_watcher_event(&self, event: WatcherEvent) {
        match event {
            WatcherEvent::TaskEvent(task_event) => {
                self.handle_task_event(task_event);
            }
            WatcherEvent::TodosUpdated(todos) => {
                let _ = self.sender.send(AppEvent::TodosUpdated(todos));
            }
            WatcherEvent::DownloadProgress(progress) => {
                let _ = self.sender.send(AppEvent::DownloadProgress(progress));
            }
            WatcherEvent::Error(e) => {
                tracing::error!("Watcher error: {}", e);
            }
        }
    }

    /// Handle a task event
    fn handle_task_event(&self, event: TaskEvent) {
        match event.event_type.as_str() {
            "task_started" => {
                // Store the task
                let stored_task = StoredTask {
                    id: event.task_id.clone(),
                    session_id: event.session_id.clone().unwrap_or_else(|| "unknown".to_string()),
                    tool: event.tool.clone().unwrap_or_else(|| "Unknown".to_string()),
                    description: event.description.clone(),
                    status: "active".to_string(),
                    started_at: event.timestamp as i64,
                    ended_at: None,
                    duration_ms: None,
                    is_background: event.background.unwrap_or(false),
                    subagent_type: event.subagent_type.clone(),
                };

                if let Err(e) = self.store.insert_task(&stored_task) {
                    tracing::error!("Failed to store task: {}", e);
                }

                let _ = self.sender.send(AppEvent::TaskStarted(event));
            }

            "task_complete" => {
                // Update task in store
                if let Err(e) = self.store.update_task_status(
                    &event.task_id,
                    "completed",
                    event.timestamp as i64,
                ) {
                    tracing::error!("Failed to update task: {}", e);
                }

                let _ = self.sender.send(AppEvent::TaskCompleted {
                    task_id: event.task_id,
                    timestamp: event.timestamp,
                });
            }

            "task_error" => {
                // Update task in store
                if let Err(e) = self.store.update_task_status(
                    &event.task_id,
                    "error",
                    event.timestamp as i64,
                ) {
                    tracing::error!("Failed to update task: {}", e);
                }

                let _ = self.sender.send(AppEvent::TaskError {
                    task_id: event.task_id,
                    timestamp: event.timestamp,
                });
            }

            "task_canceled" => {
                // Update task in store
                if let Err(e) = self.store.update_task_status(
                    &event.task_id,
                    "canceled",
                    event.timestamp as i64,
                ) {
                    tracing::error!("Failed to update task: {}", e);
                }

                let _ = self.sender.send(AppEvent::TaskCanceled {
                    task_id: event.task_id,
                });
            }

            "session_stopped" => {
                let _ = self.sender.send(AppEvent::SessionStopped {
                    session_id: event.session_id,
                });
            }

            other => {
                tracing::warn!("Unknown event type: {}", other);
            }
        }
    }

    /// Get task statistics from the store
    pub fn get_stats(&self) -> Result<crate::store::TaskStats, StoreError> {
        self.store.get_task_stats()
    }

    /// Search tasks
    pub fn search_tasks(&self, query: &str, limit: usize) -> Result<Vec<StoredTask>, StoreError> {
        self.store.search_tasks(query, limit)
    }

    /// Get recent tasks from history
    pub fn get_recent_tasks(&self, limit: usize) -> Result<Vec<StoredTask>, StoreError> {
        self.store.get_recent_tasks(limit)
    }
}

/// Plugin trait for extending functionality
#[async_trait::async_trait]
pub trait Plugin: Send + Sync {
    /// Plugin name
    fn name(&self) -> &str;

    /// Plugin version
    fn version(&self) -> &str;

    /// Called when the plugin is initialized
    async fn on_init(&mut self) -> Result<(), PluginError>;

    /// Called for each event
    async fn on_event(&self, event: &AppEvent) -> Result<(), PluginError>;

    /// Called when the plugin is shutting down
    async fn on_shutdown(&self) -> Result<(), PluginError>;
}

/// Plugin errors
#[derive(Debug, Clone)]
pub enum PluginError {
    InitError(String),
    EventError(String),
    ShutdownError(String),
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PluginError::InitError(e) => write!(f, "Plugin init error: {}", e),
            PluginError::EventError(e) => write!(f, "Plugin event error: {}", e),
            PluginError::ShutdownError(e) => write!(f, "Plugin shutdown error: {}", e),
        }
    }
}

impl std::error::Error for PluginError {}

/// Plugin manager for loading and running plugins
pub struct PluginManager {
    plugins: Vec<Box<dyn Plugin>>,
    event_rx: broadcast::Receiver<AppEvent>,
}

impl PluginManager {
    /// Create a new plugin manager
    pub fn new(router: &EventRouter) -> Self {
        Self {
            plugins: Vec::new(),
            event_rx: router.subscribe(),
        }
    }

    /// Register a plugin
    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        tracing::info!("Registered plugin: {} v{}", plugin.name(), plugin.version());
        self.plugins.push(plugin);
    }

    /// Initialize all plugins
    pub async fn init_all(&mut self) -> Result<(), PluginError> {
        for plugin in &mut self.plugins {
            plugin.on_init().await?;
        }
        Ok(())
    }

    /// Start processing events (runs in a loop)
    pub async fn run(&mut self) {
        loop {
            match self.event_rx.recv().await {
                Ok(event) => {
                    for plugin in &self.plugins {
                        if let Err(e) = plugin.on_event(&event).await {
                            tracing::error!("Plugin {} error: {}", plugin.name(), e);
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("Plugin manager lagged by {} events", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::info!("Event channel closed, shutting down plugins");
                    break;
                }
            }
        }

        // Shutdown plugins
        for plugin in &self.plugins {
            if let Err(e) = plugin.on_shutdown().await {
                tracing::error!("Plugin {} shutdown error: {}", plugin.name(), e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::EventStore;

    #[test]
    fn test_router_creation() {
        let store = Arc::new(EventStore::in_memory().unwrap());
        let config = Arc::new(Config::default());
        let router = EventRouter::new(store, config);

        // Should be able to subscribe
        let _rx = router.subscribe();
    }
}
