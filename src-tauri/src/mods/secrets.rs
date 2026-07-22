use super::manifest::validate_mod_id;
use crate::error::AppError;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_SECRET_BYTES: usize = 8 * 1024;

#[derive(Debug)]
pub struct ModSecretStore {
    root: PathBuf,
    index_lock: Mutex<()>,
}

impl ModSecretStore {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).map_err(secret_io)?;
        Ok(Self {
            root,
            index_lock: Mutex::new(()),
        })
    }

    pub fn get(
        &self,
        mod_id: &str,
        account_id: &str,
        key: &str,
    ) -> Result<Option<String>, AppError> {
        let entry = entry(mod_id, account_id, key)?;
        match get_secret(&entry) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| secret_error("le secret stocké n’est pas du texte UTF-8")),
            Err(error) if is_missing_entry(&error) => Ok(None),
            Err(error) => Err(secret_error(error.to_string())),
        }
    }

    pub fn set(
        &self,
        mod_id: &str,
        account_id: &str,
        key: &str,
        value: &str,
    ) -> Result<(), AppError> {
        if value.len() > MAX_SECRET_BYTES {
            return Err(secret_error("secret supérieur à 8 Kio"));
        }
        set_secret(&entry(mod_id, account_id, key)?, value.as_bytes())
            .map_err(|error| secret_error(error.to_string()))?;
        self.update_index(mod_id, account_id, key, true)
    }

    pub fn remove(&self, mod_id: &str, account_id: &str, key: &str) -> Result<(), AppError> {
        let entry = entry(mod_id, account_id, key)?;
        match delete_secret(&entry) {
            Ok(()) => Ok(()),
            Err(error) if is_missing_entry(&error) => Ok(()),
            Err(error) => Err(secret_error(error.to_string())),
        }?;
        self.update_index(mod_id, account_id, key, false)
    }

    pub fn clear_account(&self, account_id: &str) -> Result<(), AppError> {
        validate_identifier(account_id, "compte")?;
        let _operation = self
            .index_lock
            .lock()
            .map_err(|_| secret_error("verrou de l’index des secrets empoisonné"))?;
        for directory in fs::read_dir(&self.root).map_err(secret_io)? {
            let directory = directory.map_err(secret_io)?;
            if !directory.file_type().map_err(secret_io)?.is_dir() {
                continue;
            }
            let Some(mod_id) = directory.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if validate_mod_id(&mod_id).is_err() {
                continue;
            }
            let path = directory.path().join(format!("{account_id}.json"));
            for key in read_index(&path)? {
                let secret = entry(&mod_id, account_id, &key)?;
                match delete_secret(&secret) {
                    Ok(()) => {}
                    Err(error) if is_missing_entry(&error) => {}
                    Err(error) => return Err(secret_error(error.to_string())),
                }
            }
            if path.exists() {
                fs::remove_file(path).map_err(secret_io)?;
            }
        }
        Ok(())
    }

    fn update_index(
        &self,
        mod_id: &str,
        account_id: &str,
        key: &str,
        present: bool,
    ) -> Result<(), AppError> {
        let _operation = self
            .index_lock
            .lock()
            .map_err(|_| secret_error("verrou de l’index des secrets empoisonné"))?;
        let path = self.root.join(mod_id).join(format!("{account_id}.json"));
        let mut keys = read_index(&path)?;
        if present {
            keys.insert(key.to_owned());
        } else {
            keys.remove(key);
        }
        if keys.is_empty() {
            if path.exists() {
                fs::remove_file(path).map_err(secret_io)?;
            }
            return Ok(());
        }
        let parent = path
            .parent()
            .ok_or_else(|| secret_error("dossier de secrets introuvable"))?;
        fs::create_dir_all(parent).map_err(secret_io)?;
        let bytes = serde_json::to_vec(&keys)
            .map_err(|error| secret_error(format!("index de secrets invalide: {error}")))?;
        fs::write(path, bytes).map_err(secret_io)
    }
}

fn read_index(path: &Path) -> Result<BTreeSet<String>, AppError> {
    if !path.exists() {
        return Ok(BTreeSet::new());
    }
    let keys: BTreeSet<String> = serde_json::from_slice(&fs::read(path).map_err(secret_io)?)
        .map_err(|error| secret_error(format!("index de secrets invalide: {error}")))?;
    for key in &keys {
        validate_identifier(key, "secret")?;
    }
    Ok(keys)
}

fn username(mod_id: &str, account_id: &str, key: &str) -> Result<String, AppError> {
    validate_mod_id(mod_id)?;
    validate_identifier(account_id, "compte")?;
    validate_identifier(key, "secret")?;
    Ok(format!("{mod_id}:{account_id}:{key}"))
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(secret_error(format!("identifiant de {label} invalide")));
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
type PlatformEntry = keyring::Entry;
#[cfg(not(target_os = "android"))]
type PlatformError = keyring::Error;

#[cfg(not(target_os = "android"))]
fn entry(mod_id: &str, account_id: &str, key: &str) -> Result<PlatformEntry, AppError> {
    keyring::Entry::new("app.twelia.client.mod", &username(mod_id, account_id, key)?)
        .map_err(|error| secret_error(error.to_string()))
}

#[cfg(not(target_os = "android"))]
fn get_secret(entry: &PlatformEntry) -> Result<Vec<u8>, PlatformError> {
    entry.get_secret()
}

#[cfg(not(target_os = "android"))]
fn set_secret(entry: &PlatformEntry, value: &[u8]) -> Result<(), PlatformError> {
    entry.set_secret(value)
}

#[cfg(not(target_os = "android"))]
fn delete_secret(entry: &PlatformEntry) -> Result<(), PlatformError> {
    entry.delete_credential()
}

#[cfg(not(target_os = "android"))]
fn is_missing_entry(error: &PlatformError) -> bool {
    matches!(error, keyring::Error::NoEntry)
}

#[cfg(target_os = "android")]
type PlatformEntry = keyring_core::Entry;
#[cfg(target_os = "android")]
type PlatformError = keyring_core::Error;

#[cfg(target_os = "android")]
fn entry(mod_id: &str, account_id: &str, key: &str) -> Result<PlatformEntry, AppError> {
    use std::sync::OnceLock;
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
    let initialized = INITIALIZED.get_or_init(|| {
        android_native_keyring_store::Store::new()
            .map(|store| keyring_core::set_default_store(store))
            .map_err(|error| error.to_string())
    });
    if let Err(error) = initialized {
        return Err(secret_error(error.clone()));
    }
    keyring_core::Entry::new("app.twelia.client.mod", &username(mod_id, account_id, key)?)
        .map_err(|error| secret_error(error.to_string()))
}

#[cfg(target_os = "android")]
fn get_secret(entry: &PlatformEntry) -> Result<Vec<u8>, PlatformError> {
    entry.get_secret()
}

#[cfg(target_os = "android")]
fn set_secret(entry: &PlatformEntry, value: &[u8]) -> Result<(), PlatformError> {
    entry.set_secret(value)
}

#[cfg(target_os = "android")]
fn delete_secret(entry: &PlatformEntry) -> Result<(), PlatformError> {
    entry.delete_credential()
}

#[cfg(target_os = "android")]
fn is_missing_entry(error: &PlatformError) -> bool {
    matches!(error, keyring_core::Error::NoEntry)
}

fn secret_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

fn secret_io(error: std::io::Error) -> AppError {
    secret_error(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_and_validates_secret_names() {
        assert_eq!(
            username("dev.twelia.mod", "account-1", "api-key").unwrap(),
            "dev.twelia.mod:account-1:api-key"
        );
        assert!(username("dev.twelia.mod", "../account", "api-key").is_err());
        assert!(username("dev.twelia.mod", "account-1", "../key").is_err());
    }
}
