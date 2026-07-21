use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

const MAX_COMMANDS_PER_INSTANCE: usize = 32;
const MAX_COMMAND_PAYLOAD_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModCommandDefinition {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModCommandSnapshot {
    pub mod_id: String,
    pub session_id: String,
    #[serde(flatten)]
    pub command: ModCommandDefinition,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ModCommandKey {
    mod_id: String,
    session_id: String,
    command_id: String,
}

#[derive(Debug, Default)]
pub struct ModCommandStore {
    commands: Mutex<HashMap<ModCommandKey, ModCommandDefinition>>,
}

impl ModCommandStore {
    pub fn register(&self, mod_id: &str, session_id: &str, payload: &str) -> Result<(), AppError> {
        if payload.len() > MAX_COMMAND_PAYLOAD_BYTES {
            return Err(command_error("commande trop volumineuse"));
        }
        let command: ModCommandDefinition = serde_json::from_str(payload)
            .map_err(|error| command_error(format!("commande invalide: {error}")))?;
        validate_identifier(&command.id, "identifiant de commande")?;
        validate_text(&command.title, 120, "titre de commande")?;
        if let Some(description) = &command.description {
            validate_text(description, 300, "description de commande")?;
        }
        if let Some(shortcut) = &command.shortcut {
            validate_shortcut(shortcut)?;
        }
        let key = ModCommandKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
            command_id: command.id.clone(),
        };
        let mut commands = self
            .commands
            .lock()
            .map_err(|_| command_error("verrou des commandes de mods empoisonné"))?;
        if !commands.contains_key(&key)
            && commands
                .keys()
                .filter(|candidate| {
                    candidate.mod_id == mod_id && candidate.session_id == session_id
                })
                .count()
                >= MAX_COMMANDS_PER_INSTANCE
        {
            return Err(command_error("trop de commandes pour ce mod"));
        }
        commands.insert(key, command);
        Ok(())
    }

    pub fn unregister(
        &self,
        mod_id: &str,
        session_id: &str,
        command_id: &str,
    ) -> Result<(), AppError> {
        validate_identifier(command_id, "identifiant de commande")?;
        self.commands
            .lock()
            .map_err(|_| command_error("verrou des commandes de mods empoisonné"))?
            .remove(&ModCommandKey {
                mod_id: mod_id.to_owned(),
                session_id: session_id.to_owned(),
                command_id: command_id.to_owned(),
            });
        Ok(())
    }

    pub fn contains(&self, mod_id: &str, session_id: &str, command_id: &str) -> bool {
        self.commands.lock().is_ok_and(|commands| {
            commands.contains_key(&ModCommandKey {
                mod_id: mod_id.to_owned(),
                session_id: session_id.to_owned(),
                command_id: command_id.to_owned(),
            })
        })
    }

    pub fn list(&self) -> Vec<ModCommandSnapshot> {
        let mut snapshots = self
            .commands
            .lock()
            .map(|commands| {
                commands
                    .iter()
                    .map(|(key, command)| ModCommandSnapshot {
                        mod_id: key.mod_id.clone(),
                        session_id: key.session_id.clone(),
                        command: command.clone(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        snapshots.sort_by(|left, right| {
            left.command
                .title
                .cmp(&right.command.title)
                .then_with(|| left.mod_id.cmp(&right.mod_id))
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        snapshots
    }

    pub fn clear_instance(&self, mod_id: &str, session_id: &str) {
        if let Ok(mut commands) = self.commands.lock() {
            commands.retain(|key, _| key.mod_id != mod_id || key.session_id != session_id);
        }
    }
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        Err(command_error(format!("{label} invalide")))
    } else {
        Ok(())
    }
}

fn validate_text(value: &str, max_chars: usize, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty()
        || value.chars().count() > max_chars
        || value.chars().any(char::is_control)
    {
        Err(command_error(format!("{label} invalide")))
    } else {
        Ok(())
    }
}

fn validate_shortcut(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'_' | b' '))
    {
        return Err(command_error("raccourci de commande invalide"));
    }
    let mut modifiers = HashSet::new();
    let mut keys = 0;
    for part in value.split('+').map(str::trim) {
        if part.is_empty()
            || !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(command_error("raccourci de commande invalide"));
        }
        let normalized_modifier = match part.to_ascii_lowercase().as_str() {
            "control" | "ctrl" => Some("ctrl"),
            "cmd" | "command" | "meta" => Some("meta"),
            "option" | "alt" => Some("alt"),
            "shift" => Some("shift"),
            _ => None,
        };
        if let Some(modifier) = normalized_modifier {
            if !modifiers.insert(modifier) {
                return Err(command_error("modificateur de raccourci dupliqué"));
            }
        } else {
            keys += 1;
        }
    }
    if keys != 1 {
        return Err(command_error(
            "un raccourci doit contenir exactement une touche principale",
        ));
    }
    Ok(())
}

fn command_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_lists_and_clears_scoped_commands() {
        let store = ModCommandStore::default();
        store
            .register(
                "dev.test",
                "session-a",
                r#"{"id":"open","title":"Ouvrir","shortcut":"Ctrl+Shift+M"}"#,
            )
            .unwrap();
        assert!(store.contains("dev.test", "session-a", "open"));
        assert_eq!(store.list().len(), 1);
        store.clear_instance("dev.test", "session-a");
        assert!(store.list().is_empty());
    }

    #[test]
    fn rejects_ambiguous_shortcuts() {
        let store = ModCommandStore::default();
        assert!(
            store
                .register(
                    "dev.test",
                    "session-a",
                    r#"{"id":"bad","title":"Invalide","shortcut":"Ctrl+A+B"}"#,
                )
                .is_err()
        );
        assert!(
            store
                .register(
                    "dev.test",
                    "session-a",
                    r#"{"id":"bad","title":"Invalide","shortcut":"Ctrl+Shift"}"#,
                )
                .is_err()
        );
    }
}
