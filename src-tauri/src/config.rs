//! Configuration system for the Agent Progress Overlay
//!
//! Loads settings from ~/.claude/overlay-config.toml with sensible defaults.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub window: WindowConfig,
    #[serde(default)]
    pub behavior: BehaviorConfig,
    #[serde(default)]
    pub shortcuts: ShortcutsConfig,
    #[serde(default)]
    pub paths: PathsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_position")]
    pub position: String,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_theme")]
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorConfig {
    #[serde(default = "default_max_recent_tasks")]
    pub max_recent_tasks: usize,
    #[serde(default)]
    pub auto_hide: bool,
    #[serde(default = "default_auto_hide_delay")]
    pub auto_hide_delay_ms: u64,
    #[serde(default = "default_stale_threshold")]
    pub stale_task_threshold_ms: u64,
    #[serde(default = "default_notification_duration")]
    pub notification_duration_ms: u64,
    #[serde(default = "default_debounce")]
    pub file_watch_debounce_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutsConfig {
    #[serde(default = "default_toggle_shortcut")]
    pub toggle_visibility: String,
    #[serde(default = "default_clear_shortcut")]
    pub clear_tasks: String,
    #[serde(default = "default_settings_shortcut")]
    pub open_settings: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathsConfig {
    #[serde(default = "default_events_file")]
    pub events_file: String,
    #[serde(default = "default_todos_dir")]
    pub todos_dir: String,
    #[serde(default = "default_database_file")]
    pub database_file: String,
}

// Default value functions
fn default_width() -> u32 { 320 }
fn default_height() -> u32 { 400 }
fn default_position() -> String { "bottom-right".to_string() }
fn default_true() -> bool { true }
fn default_opacity() -> f64 { 0.95 }
fn default_theme() -> String { "dark".to_string() }
fn default_max_recent_tasks() -> usize { 10 }
fn default_auto_hide_delay() -> u64 { 3000 }
fn default_stale_threshold() -> u64 { 300_000 } // 5 minutes
fn default_notification_duration() -> u64 { 2000 }
fn default_debounce() -> u64 { 100 }
fn default_toggle_shortcut() -> String { "Ctrl+Shift+P".to_string() }
fn default_clear_shortcut() -> String { "Ctrl+Shift+C".to_string() }
fn default_settings_shortcut() -> String { "Ctrl+,".to_string() }

fn default_events_file() -> String {
    get_claude_dir()
        .join("progress-events.jsonl")
        .to_string_lossy()
        .to_string()
}

fn default_todos_dir() -> String {
    get_claude_dir()
        .join("todos")
        .to_string_lossy()
        .to_string()
}

fn default_database_file() -> String {
    get_claude_dir()
        .join("overlay-history.db")
        .to_string_lossy()
        .to_string()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            window: WindowConfig::default(),
            behavior: BehaviorConfig::default(),
            shortcuts: ShortcutsConfig::default(),
            paths: PathsConfig::default(),
        }
    }
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            width: default_width(),
            height: default_height(),
            position: default_position(),
            always_on_top: default_true(),
            opacity: default_opacity(),
            theme: default_theme(),
        }
    }
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        Self {
            max_recent_tasks: default_max_recent_tasks(),
            auto_hide: false,
            auto_hide_delay_ms: default_auto_hide_delay(),
            stale_task_threshold_ms: default_stale_threshold(),
            notification_duration_ms: default_notification_duration(),
            file_watch_debounce_ms: default_debounce(),
        }
    }
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        Self {
            toggle_visibility: default_toggle_shortcut(),
            clear_tasks: default_clear_shortcut(),
            open_settings: default_settings_shortcut(),
        }
    }
}

impl Default for PathsConfig {
    fn default() -> Self {
        Self {
            events_file: default_events_file(),
            todos_dir: default_todos_dir(),
            database_file: default_database_file(),
        }
    }
}

/// Get the .claude directory path
pub fn get_claude_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
}

/// Get the config file path
pub fn get_config_path() -> PathBuf {
    get_claude_dir().join("overlay-config.toml")
}

impl Config {
    /// Load configuration from file or create default
    pub fn load() -> Result<Self, ConfigError> {
        let path = get_config_path();

        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| ConfigError::ReadError(e.to_string()))?;

            let config: Config = toml::from_str(&content)
                .map_err(|e| ConfigError::ParseError(e.to_string()))?;

            tracing::info!("Loaded config from {:?}", path);
            Ok(config)
        } else {
            tracing::info!("No config file found, using defaults");
            let default = Self::default();
            // Optionally save default config
            if let Err(e) = default.save() {
                tracing::warn!("Failed to save default config: {}", e);
            }
            Ok(default)
        }
    }

    /// Save configuration to file
    pub fn save(&self) -> Result<(), ConfigError> {
        let path = get_config_path();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| ConfigError::WriteError(e.to_string()))?;
        }

        let content = toml::to_string_pretty(self)
            .map_err(|e| ConfigError::SerializeError(e.to_string()))?;

        fs::write(&path, content)
            .map_err(|e| ConfigError::WriteError(e.to_string()))?;

        tracing::info!("Saved config to {:?}", path);
        Ok(())
    }

    /// Get events file path as PathBuf
    pub fn events_path(&self) -> PathBuf {
        PathBuf::from(&self.paths.events_file)
    }

    /// Get todos directory path as PathBuf
    pub fn todos_path(&self) -> PathBuf {
        PathBuf::from(&self.paths.todos_dir)
    }

    /// Get database file path as PathBuf
    pub fn database_path(&self) -> PathBuf {
        PathBuf::from(&self.paths.database_file)
    }
}

#[derive(Debug, Clone)]
pub enum ConfigError {
    ReadError(String),
    WriteError(String),
    ParseError(String),
    SerializeError(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::ReadError(e) => write!(f, "Failed to read config: {}", e),
            ConfigError::WriteError(e) => write!(f, "Failed to write config: {}", e),
            ConfigError::ParseError(e) => write!(f, "Failed to parse config: {}", e),
            ConfigError::SerializeError(e) => write!(f, "Failed to serialize config: {}", e),
        }
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.window.width, 320);
        assert_eq!(config.window.height, 400);
        assert!(config.window.always_on_top);
    }

    #[test]
    fn test_config_serialization() {
        let config = Config::default();
        let toml_str = toml::to_string_pretty(&config).unwrap();
        let parsed: Config = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.window.width, config.window.width);
    }
}
