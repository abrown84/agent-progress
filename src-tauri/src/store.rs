//! SQLite-based event store for task history persistence
//!
//! Provides persistent storage for tasks, sessions, and todos with full search capability.

use rusqlite::{Connection, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// Task record stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTask {
    pub id: String,
    pub session_id: String,
    pub tool: String,
    pub description: Option<String>,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub is_background: bool,
    pub subagent_type: Option<String>,
}

/// Session record stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSession {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub project_path: Option<String>,
}

/// Todo record stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTodo {
    pub id: i64,
    pub session_id: String,
    pub content: String,
    pub active_form: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// SQLite-based event store
pub struct EventStore {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    project_path TEXT
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'error', 'canceled')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    is_background INTEGER DEFAULT 0,
    subagent_type TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Todos table
CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    active_form TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_tool ON tasks(tool);
CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);

-- Full-text search for task descriptions
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    id,
    description,
    tool,
    content='tasks',
    content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(id, description, tool)
    VALUES (new.id, new.description, new.tool);
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, id, description, tool)
    VALUES ('delete', old.id, old.description, old.tool);
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, id, description, tool)
    VALUES ('delete', old.id, old.description, old.tool);
    INSERT INTO tasks_fts(id, description, tool)
    VALUES (new.id, new.description, new.tool);
END;
"#;

impl EventStore {
    /// Create a new event store at the given path
    pub fn new(path: &Path) -> Result<Self, StoreError> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| StoreError::IoError(e.to_string()))?;
        }

        let conn = Connection::open(path)
            .map_err(|e| StoreError::ConnectionError(e.to_string()))?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| StoreError::SchemaError(e.to_string()))?;

        // Initialize schema
        conn.execute_batch(SCHEMA)
            .map_err(|e| StoreError::SchemaError(e.to_string()))?;

        tracing::info!("Initialized event store at {:?}", path);

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Create an in-memory store (for testing)
    pub fn in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| StoreError::ConnectionError(e.to_string()))?;

        conn.execute_batch(SCHEMA)
            .map_err(|e| StoreError::SchemaError(e.to_string()))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ========== Session Operations ==========

    /// Insert or update a session
    pub fn upsert_session(&self, session: &StoredSession) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        conn.execute(
            "INSERT INTO sessions (id, started_at, ended_at, project_path)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                ended_at = COALESCE(?3, ended_at),
                project_path = COALESCE(?4, project_path)",
            params![session.id, session.started_at, session.ended_at, session.project_path],
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(())
    }

    /// Get a session by ID
    pub fn get_session(&self, id: &str) -> Result<Option<StoredSession>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let result = conn.query_row(
            "SELECT id, started_at, ended_at, project_path FROM sessions WHERE id = ?1",
            params![id],
            |row| Ok(StoredSession {
                id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
                project_path: row.get(3)?,
            }),
        ).optional().map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(result)
    }

    // ========== Task Operations ==========

    /// Insert a new task
    pub fn insert_task(&self, task: &StoredTask) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        // Ensure session exists
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?1, ?2)",
            params![task.session_id, task.started_at],
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        conn.execute(
            "INSERT INTO tasks (id, session_id, tool, description, status, started_at, is_background, subagent_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                task.id,
                task.session_id,
                task.tool,
                task.description,
                task.status,
                task.started_at,
                task.is_background as i32,
                task.subagent_type
            ],
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(())
    }

    /// Update task status (complete or error)
    pub fn update_task_status(
        &self,
        task_id: &str,
        status: &str,
        ended_at: i64,
    ) -> Result<(), StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        conn.execute(
            "UPDATE tasks SET
                status = ?1,
                ended_at = ?2,
                duration_ms = ?2 - started_at
             WHERE id = ?3",
            params![status, ended_at, task_id],
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(())
    }

    /// Get a task by ID
    pub fn get_task(&self, id: &str) -> Result<Option<StoredTask>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let result = conn.query_row(
            "SELECT id, session_id, tool, description, status, started_at, ended_at, duration_ms, is_background, subagent_type
             FROM tasks WHERE id = ?1",
            params![id],
            |row| Ok(StoredTask {
                id: row.get(0)?,
                session_id: row.get(1)?,
                tool: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                duration_ms: row.get(7)?,
                is_background: row.get::<_, i32>(8)? != 0,
                subagent_type: row.get(9)?,
            }),
        ).optional().map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(result)
    }

    /// Get recent tasks
    pub fn get_recent_tasks(&self, limit: usize) -> Result<Vec<StoredTask>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, tool, description, status, started_at, ended_at, duration_ms, is_background, subagent_type
             FROM tasks
             ORDER BY started_at DESC
             LIMIT ?1"
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let tasks = stmt.query_map(params![limit as i64], |row| {
            Ok(StoredTask {
                id: row.get(0)?,
                session_id: row.get(1)?,
                tool: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                duration_ms: row.get(7)?,
                is_background: row.get::<_, i32>(8)? != 0,
                subagent_type: row.get(9)?,
            })
        }).map_err(|e| StoreError::QueryError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(tasks)
    }

    /// Get tasks by session
    pub fn get_tasks_by_session(&self, session_id: &str) -> Result<Vec<StoredTask>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, tool, description, status, started_at, ended_at, duration_ms, is_background, subagent_type
             FROM tasks
             WHERE session_id = ?1
             ORDER BY started_at DESC"
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let tasks = stmt.query_map(params![session_id], |row| {
            Ok(StoredTask {
                id: row.get(0)?,
                session_id: row.get(1)?,
                tool: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                duration_ms: row.get(7)?,
                is_background: row.get::<_, i32>(8)? != 0,
                subagent_type: row.get(9)?,
            })
        }).map_err(|e| StoreError::QueryError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(tasks)
    }

    /// Search tasks by description (full-text search)
    pub fn search_tasks(&self, query: &str, limit: usize) -> Result<Vec<StoredTask>, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let mut stmt = conn.prepare(
            "SELECT t.id, t.session_id, t.tool, t.description, t.status, t.started_at, t.ended_at, t.duration_ms, t.is_background, t.subagent_type
             FROM tasks t
             JOIN tasks_fts fts ON t.id = fts.id
             WHERE tasks_fts MATCH ?1
             ORDER BY t.started_at DESC
             LIMIT ?2"
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let tasks = stmt.query_map(params![query, limit as i64], |row| {
            Ok(StoredTask {
                id: row.get(0)?,
                session_id: row.get(1)?,
                tool: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                duration_ms: row.get(7)?,
                is_background: row.get::<_, i32>(8)? != 0,
                subagent_type: row.get(9)?,
            })
        }).map_err(|e| StoreError::QueryError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(tasks)
    }

    /// Get active tasks count
    pub fn get_active_task_count(&self) -> Result<i64, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = 'active'",
            [],
            |row| row.get(0),
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(count)
    }

    /// Get task statistics
    pub fn get_task_stats(&self) -> Result<TaskStats, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks",
            [],
            |row| row.get(0),
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let completed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = 'completed'",
            [],
            |row| row.get(0),
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let errors: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = 'error'",
            [],
            |row| row.get(0),
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        let avg_duration: Option<f64> = conn.query_row(
            "SELECT AVG(duration_ms) FROM tasks WHERE duration_ms IS NOT NULL",
            [],
            |row| row.get(0),
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(TaskStats {
            total_tasks: total,
            completed_tasks: completed,
            error_tasks: errors,
            avg_duration_ms: avg_duration,
        })
    }

    /// Cleanup old tasks (older than days_to_keep)
    pub fn cleanup_old_tasks(&self, days_to_keep: i64) -> Result<i64, StoreError> {
        let conn = self.conn.lock().map_err(|_| StoreError::LockError)?;

        let cutoff_ms = chrono_now_ms() - (days_to_keep * 24 * 60 * 60 * 1000);

        let deleted = conn.execute(
            "DELETE FROM tasks WHERE started_at < ?1 AND status != 'active'",
            params![cutoff_ms],
        ).map_err(|e| StoreError::QueryError(e.to_string()))?;

        Ok(deleted as i64)
    }
}

/// Task statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStats {
    pub total_tasks: i64,
    pub completed_tasks: i64,
    pub error_tasks: i64,
    pub avg_duration_ms: Option<f64>,
}

/// Store errors
#[derive(Debug, Clone)]
pub enum StoreError {
    ConnectionError(String),
    SchemaError(String),
    QueryError(String),
    IoError(String),
    LockError,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::ConnectionError(e) => write!(f, "Database connection error: {}", e),
            StoreError::SchemaError(e) => write!(f, "Schema error: {}", e),
            StoreError::QueryError(e) => write!(f, "Query error: {}", e),
            StoreError::IoError(e) => write!(f, "IO error: {}", e),
            StoreError::LockError => write!(f, "Failed to acquire database lock"),
        }
    }
}

impl std::error::Error for StoreError {}

/// Get current time in milliseconds (similar to JS Date.now())
fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_creation() {
        let store = EventStore::in_memory().unwrap();
        assert!(store.get_active_task_count().unwrap() == 0);
    }

    #[test]
    fn test_task_lifecycle() {
        let store = EventStore::in_memory().unwrap();

        // Insert task
        let task = StoredTask {
            id: "task-1".to_string(),
            session_id: "session-1".to_string(),
            tool: "Bash".to_string(),
            description: Some("npm install".to_string()),
            status: "active".to_string(),
            started_at: 1000,
            ended_at: None,
            duration_ms: None,
            is_background: false,
            subagent_type: None,
        };

        store.insert_task(&task).unwrap();
        assert_eq!(store.get_active_task_count().unwrap(), 1);

        // Complete task
        store.update_task_status("task-1", "completed", 2000).unwrap();
        assert_eq!(store.get_active_task_count().unwrap(), 0);

        // Verify task updated
        let retrieved = store.get_task("task-1").unwrap().unwrap();
        assert_eq!(retrieved.status, "completed");
        assert_eq!(retrieved.ended_at, Some(2000));
        assert_eq!(retrieved.duration_ms, Some(1000));
    }

    #[test]
    fn test_search_tasks() {
        let store = EventStore::in_memory().unwrap();

        store.insert_task(&StoredTask {
            id: "task-1".to_string(),
            session_id: "session-1".to_string(),
            tool: "Bash".to_string(),
            description: Some("npm install lodash".to_string()),
            status: "completed".to_string(),
            started_at: 1000,
            ended_at: Some(2000),
            duration_ms: Some(1000),
            is_background: false,
            subagent_type: None,
        }).unwrap();

        store.insert_task(&StoredTask {
            id: "task-2".to_string(),
            session_id: "session-1".to_string(),
            tool: "Bash".to_string(),
            description: Some("cargo build".to_string()),
            status: "completed".to_string(),
            started_at: 2000,
            ended_at: Some(3000),
            duration_ms: Some(1000),
            is_background: false,
            subagent_type: None,
        }).unwrap();

        let results = store.search_tasks("npm", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "task-1");

        let results = store.search_tasks("cargo", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "task-2");
    }
}
