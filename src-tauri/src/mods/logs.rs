use chrono::{DateTime, Utc};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

const MAX_LOG_ENTRIES: usize = 1_000;
const MAX_LOG_MESSAGE_CHARS: usize = 4_096;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModLogEntry {
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub mod_id: String,
    pub session_id: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct ModLogBuffer {
    entries: Mutex<VecDeque<ModLogEntry>>,
    next_sequence: AtomicU64,
}

impl ModLogBuffer {
    pub fn push(&self, mod_id: &str, session_id: &str, level: &str, message: &str) {
        let level = match level {
            "debug" | "warn" | "error" => level,
            _ => "info",
        };
        let message = message
            .replace(['\r', '\n'], " ")
            .chars()
            .take(MAX_LOG_MESSAGE_CHARS)
            .collect::<String>();
        let entry = ModLogEntry {
            sequence: self.next_sequence.fetch_add(1, Ordering::Relaxed),
            timestamp: Utc::now(),
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
            level: level.to_owned(),
            message,
        };
        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() == MAX_LOG_ENTRIES {
                entries.pop_front();
            }
            entries.push_back(entry);
        }
    }

    pub fn list(&self, session_id: Option<&str>) -> Vec<ModLogEntry> {
        self.entries
            .lock()
            .map(|entries| {
                entries
                    .iter()
                    .filter(|entry| session_id.is_none_or(|id| entry.session_id == id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn clear(&self, session_id: Option<&str>) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(session_id) = session_id {
                entries.retain(|entry| entry.session_id != session_id);
            } else {
                entries.clear();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_and_clears_logs_by_session() {
        let logs = ModLogBuffer::default();
        logs.push("dev.test", "session-a", "info", "hello");
        logs.push("dev.test", "session-b", "warn", "world");

        assert_eq!(logs.list(Some("session-a")).len(), 1);
        logs.clear(Some("session-a"));
        assert!(logs.list(Some("session-a")).is_empty());
        assert_eq!(logs.list(None).len(), 1);
    }
}
