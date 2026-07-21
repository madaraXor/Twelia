use crate::error::AppError;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

const STATE_DOCUMENTS: &[&str] = &["accounts", "workspace", "settings", "shortcuts"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data: PathBuf,
    pub cache: PathBuf,
    pub logs: PathBuf,
    pub mods: PathBuf,
    pub client: PathBuf,
    pub client_runtime: PathBuf,
    pub downloads: PathBuf,
}

#[derive(Debug)]
pub struct StorageService {
    root: PathBuf,
}

impl StorageService {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        let service = Self { root };
        service.initialize()?;
        Ok(service)
    }

    fn initialize(&self) -> Result<(), AppError> {
        for directory in [
            self.root.join("database"),
            self.root.join("pending-deletions"),
            self.root.join("accounts"),
            self.root.join("mods").join("packages"),
            self.root.join("mods").join("data"),
            self.root.join("client-officiel"),
            self.root.join("client-runtime"),
            self.root.join("downloads"),
            self.root.join("logs"),
            self.root.join("cache-twelia"),
            self.root.join("temp"),
        ] {
            fs::create_dir_all(directory).map_err(storage_error)?;
        }
        self.cleanup_pending_account_deletions();
        Ok(())
    }

    pub fn paths(&self) -> AppPaths {
        AppPaths {
            data: self.root.clone(),
            cache: self.root.join("cache-twelia"),
            logs: self.root.join("logs"),
            mods: self.root.join("mods"),
            client: self.root.join("client-officiel"),
            client_runtime: self.root.join("client-runtime"),
            downloads: self.root.join("downloads"),
        }
    }

    pub fn load_state(&self, document: &str) -> Result<Option<Value>, AppError> {
        let path = self.state_path(document)?;
        let backup = path.with_extension("json.bak");
        match read_json(&path) {
            Ok(value) => Ok(value),
            Err(primary_error) if backup.exists() => {
                log::warn!("state document {document} restored from backup: {primary_error}");
                read_json(&backup)
            }
            Err(error) => Err(error),
        }
    }

    pub fn save_state(&self, document: &str, value: &Value) -> Result<(), AppError> {
        let path = self.state_path(document)?;
        atomic_json_write(&path, value)
    }

    pub fn account_runtime_dir(&self, account_id: &str) -> Result<PathBuf, AppError> {
        validate_identifier(account_id)?;
        let account_root = self.root.join("accounts").join(account_id);
        for folder in ["cache", "runtime", "logs", "temp"] {
            fs::create_dir_all(account_root.join(folder)).map_err(storage_error)?;
        }
        Ok(account_root.join("runtime"))
    }

    pub fn delete_account_space(&self, account_id: &str) -> Result<(), AppError> {
        validate_identifier(account_id)?;
        let accounts_root = self.root.join("accounts");
        let target = accounts_root.join(account_id);
        ensure_direct_child(&accounts_root, &target)?;
        if target.exists()
            && let Err(error) = fs::remove_dir_all(&target)
        {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(32)
            {
                fs::write(
                    self.root.join("pending-deletions").join(account_id),
                    b"pending",
                )
                .map_err(storage_error)?;
                log::info!("suppression du profil {account_id} reportée au prochain démarrage");
                return Ok(());
            }
            return Err(storage_error(error));
        }
        let marker = self.root.join("pending-deletions").join(account_id);
        if marker.exists() {
            fs::remove_file(marker).map_err(storage_error)?;
        }
        Ok(())
    }

    fn cleanup_pending_account_deletions(&self) {
        let pending_root = self.root.join("pending-deletions");
        let accounts_root = self.root.join("accounts");
        let Ok(entries) = fs::read_dir(&pending_root) else {
            return;
        };
        for entry in entries.flatten() {
            let Some(account_id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if validate_identifier(&account_id).is_err() {
                log::warn!("marqueur de suppression de profil invalide ignoré");
                continue;
            }
            let target = accounts_root.join(&account_id);
            if target.exists() && fs::remove_dir_all(&target).is_err() {
                continue;
            }
            let _ = fs::remove_file(entry.path());
        }
    }

    fn state_path(&self, document: &str) -> Result<PathBuf, AppError> {
        if !STATE_DOCUMENTS.contains(&document) {
            return Err(AppError::InvalidInput(format!(
                "unknown state document: {document}"
            )));
        }
        Ok(self.root.join("database").join(format!("{document}.json")))
    }
}

fn read_json(path: &Path) -> Result<Option<Value>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(storage_error)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| AppError::Storage(format!("invalid JSON in {}: {error}", path.display())))
}

fn atomic_json_write(path: &Path, value: &Value) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Storage("state path has no parent".into()))?;
    fs::create_dir_all(parent).map_err(storage_error)?;
    let temporary = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    let backup = path.with_extension("json.bak");
    let payload =
        serde_json::to_vec_pretty(value).map_err(|error| AppError::Storage(error.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(storage_error)?;
    file.write_all(&payload).map_err(storage_error)?;
    file.sync_all().map_err(storage_error)?;
    drop(file);

    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(storage_error)?;
        }
        fs::rename(path, &backup).map_err(storage_error)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(storage_error(error));
    }
    if backup.exists() {
        fs::remove_file(backup).map_err(storage_error)?;
    }
    Ok(())
}

pub fn validate_identifier(identifier: &str) -> Result<(), AppError> {
    if identifier.is_empty()
        || identifier.len() > 128
        || !identifier.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(AppError::InvalidInput(
            "identifier contains unsafe characters".into(),
        ));
    }
    Ok(())
}

fn ensure_direct_child(root: &Path, target: &Path) -> Result<(), AppError> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidInput("path escapes its root".into()))?;
    let components: Vec<_> = relative.components().collect();
    if components.len() != 1 || !matches!(components[0], Component::Normal(_)) {
        return Err(AppError::InvalidInput("path is not a direct child".into()));
    }
    Ok(())
}

fn storage_error(error: std::io::Error) -> AppError {
    AppError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_directory_traversal_and_isolates_accounts() {
        let root = tempfile::tempdir().unwrap();
        let storage = StorageService::new(root.path().to_path_buf()).unwrap();
        assert!(storage.account_runtime_dir("../other").is_err());
        let first = storage.account_runtime_dir("account-a").unwrap();
        let second = storage.account_runtime_dir("account-b").unwrap();
        assert_ne!(first, second);
        assert!(first.ends_with(Path::new("account-a/runtime")));
    }

    #[test]
    fn state_write_is_valid_and_recovers_from_backup() {
        let root = tempfile::tempdir().unwrap();
        let storage = StorageService::new(root.path().to_path_buf()).unwrap();
        storage
            .save_state("workspace", &json!({"schemaVersion": 1}))
            .unwrap();
        assert_eq!(
            storage.load_state("workspace").unwrap().unwrap()["schemaVersion"],
            1
        );
        let path = root.path().join("database/workspace.json");
        fs::copy(&path, path.with_extension("json.bak")).unwrap();
        fs::write(&path, b"{incomplete").unwrap();
        assert_eq!(
            storage.load_state("workspace").unwrap().unwrap()["schemaVersion"],
            1
        );
    }
}
