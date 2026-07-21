use super::manifest::ModManifest;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Mutex, mpsc},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAX_PLATFORM_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_USER_FILE_BYTES: u64 = 1024 * 1024;
const FILE_DIALOG_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ModPlatformServices {
    app: AppHandle,
    pending_file_dialogs: Mutex<HashMap<String, mpsc::SyncSender<Option<String>>>>,
}

impl ModPlatformServices {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending_file_dialogs: Mutex::new(HashMap::new()),
        }
    }

    pub fn execute(
        &self,
        manifest: &ModManifest,
        mod_id: &str,
        session_id: &str,
        service: &str,
        payload: &str,
    ) -> Result<Value, AppError> {
        if payload.len() > MAX_PLATFORM_PAYLOAD_BYTES {
            return Err(platform_error("requête de plateforme trop volumineuse"));
        }
        match service {
            "clipboard.write" => {
                require_capability(manifest, "clipboard.write")?;
                let request: TextPayload = parse(payload)?;
                self.app
                    .clipboard()
                    .write_text(request.text)
                    .map_err(|error| platform_error(error.to_string()))?;
                Ok(Value::Null)
            }
            "notifications.show" => {
                require_capability(manifest, "notifications")?;
                let request: NotificationPayload = parse(payload)?;
                validate_text(&request.title, 120, "titre de notification")?;
                validate_text(&request.body, 500, "contenu de notification")?;
                self.app
                    .emit(
                        "mod-notification",
                        serde_json::json!({
                            "modId": mod_id,
                            "sessionId": session_id,
                            "title": request.title,
                            "body": request.body,
                        }),
                    )
                    .map_err(|error| platform_error(error.to_string()))?;
                Ok(Value::Null)
            }
            "files.pick-text" => {
                require_capability(manifest, "files.user-selected")?;
                let Some(path) = self.request_file_dialog("open", None)? else {
                    return Ok(serde_json::json!({ "cancelled": true }));
                };
                let path = PathBuf::from(path);
                let metadata = fs::metadata(&path).map_err(platform_io)?;
                if !metadata.is_file() || metadata.len() > MAX_USER_FILE_BYTES {
                    return Err(platform_error(
                        "fichier sélectionné invalide ou supérieur à 1 Mio",
                    ));
                }
                let text = fs::read_to_string(&path).map_err(|_| {
                    platform_error("le fichier sélectionné n’est pas du texte UTF-8")
                })?;
                Ok(serde_json::json!({
                    "cancelled": false,
                    "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("document"),
                    "text": text,
                }))
            }
            "files.save-text" => {
                require_capability(manifest, "files.user-selected")?;
                let request: SaveTextPayload = parse(payload)?;
                if request.text.len() as u64 > MAX_USER_FILE_BYTES {
                    return Err(platform_error("document supérieur à 1 Mio"));
                }
                validate_file_name(&request.suggested_name)?;
                let Some(path) = self.request_file_dialog("save", Some(request.suggested_name))?
                else {
                    return Ok(serde_json::json!({ "cancelled": true }));
                };
                let path = PathBuf::from(path);
                fs::write(&path, request.text).map_err(platform_io)?;
                Ok(serde_json::json!({
                    "cancelled": false,
                    "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("document"),
                }))
            }
            _ => Err(platform_error(format!("service natif inconnu: {service}"))),
        }
    }

    pub fn complete_file_dialog(
        &self,
        request_id: &str,
        path: Option<String>,
    ) -> Result<(), AppError> {
        let sender = self
            .pending_file_dialogs
            .lock()
            .map_err(|_| platform_error("verrou des sélecteurs de fichiers empoisonné"))?
            .remove(request_id)
            .ok_or_else(|| platform_error("sélecteur de fichier inconnu ou expiré"))?;
        sender
            .send(path)
            .map_err(|_| platform_error("requête de fichier déjà terminée"))
    }

    fn request_file_dialog(
        &self,
        operation: &str,
        suggested_name: Option<String>,
    ) -> Result<Option<String>, AppError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::sync_channel(1);
        self.pending_file_dialogs
            .lock()
            .map_err(|_| platform_error("verrou des sélecteurs de fichiers empoisonné"))?
            .insert(request_id.clone(), sender);
        if let Err(error) = self.app.emit(
            "mod-file-dialog",
            ModFileDialogRequest {
                request_id: request_id.clone(),
                operation: operation.to_owned(),
                suggested_name,
            },
        ) {
            if let Ok(mut pending) = self.pending_file_dialogs.lock() {
                pending.remove(&request_id);
            }
            return Err(platform_error(error.to_string()));
        }
        match receiver.recv_timeout(FILE_DIALOG_TIMEOUT) {
            Ok(path) => Ok(path),
            Err(_) => {
                if let Ok(mut pending) = self.pending_file_dialogs.lock() {
                    pending.remove(&request_id);
                }
                Err(platform_error("sélection de fichier expirée"))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModFileDialogRequest {
    request_id: String,
    operation: String,
    suggested_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextPayload {
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationPayload {
    title: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveTextPayload {
    suggested_name: String,
    text: String,
}

fn require_capability(manifest: &ModManifest, capability: &str) -> Result<(), AppError> {
    if manifest.allows_capability(capability) {
        Ok(())
    } else {
        Err(platform_error(format!(
            "la capacité {capability} n’est pas accordée à ce mod"
        )))
    }
}

fn parse<'a, T: Deserialize<'a>>(payload: &'a str) -> Result<T, AppError> {
    serde_json::from_str(payload)
        .map_err(|error| platform_error(format!("requête de plateforme invalide: {error}")))
}

fn validate_text(value: &str, max_chars: usize, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty()
        || value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        Err(platform_error(format!("{label} invalide")))
    } else {
        Ok(())
    }
}

fn validate_file_name(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || value.contains(['/', '\\'])
        || value.chars().any(char::is_control)
    {
        Err(platform_error("nom de fichier suggéré invalide"))
    } else {
        Ok(())
    }
}

fn platform_io(error: std::io::Error) -> AppError {
    platform_error(error.to_string())
}

fn platform_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}
