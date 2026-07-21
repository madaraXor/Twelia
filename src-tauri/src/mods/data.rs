use super::manifest::validate_mod_id;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

const DATA_SCHEMA_VERSION: u32 = 1;
const MAX_KEYS: usize = 32;
const MAX_VALUE_BYTES: usize = 32 * 1024;
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModDataDocument {
    schema_version: u32,
    #[serde(default)]
    data_version: u32,
    #[serde(default)]
    values: BTreeMap<String, Value>,
}

impl Default for ModDataDocument {
    fn default() -> Self {
        Self {
            schema_version: DATA_SCHEMA_VERSION,
            data_version: 0,
            values: BTreeMap::new(),
        }
    }
}

pub struct ModDataStore {
    root: PathBuf,
    operation_lock: Mutex<()>,
}

impl ModDataStore {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).map_err(data_io)?;
        Ok(Self {
            root,
            operation_lock: Mutex::new(()),
        })
    }

    pub fn get(
        &self,
        mod_id: &str,
        account_id: &str,
        key: &str,
    ) -> Result<Option<Value>, AppError> {
        let _operation = self.lock()?;
        let path = self.path(mod_id, account_id)?;
        validate_key(key)?;
        Ok(read_document(&path)?.values.remove(key))
    }

    pub fn set(
        &self,
        mod_id: &str,
        account_id: &str,
        key: &str,
        value: Value,
    ) -> Result<(), AppError> {
        let _operation = self.lock()?;
        let path = self.path(mod_id, account_id)?;
        validate_key(key)?;
        let value_size = serde_json::to_vec(&value).map_err(data_json)?.len();
        if value_size > MAX_VALUE_BYTES {
            return Err(data_error("valeur persistante trop volumineuse"));
        }
        let mut document = read_document(&path)?;
        if !document.values.contains_key(key) && document.values.len() >= MAX_KEYS {
            return Err(data_error("trop de valeurs persistantes pour ce mod"));
        }
        document.values.insert(key.to_owned(), value);
        write_document(&path, &document)
    }

    pub fn remove(&self, mod_id: &str, account_id: &str, key: &str) -> Result<(), AppError> {
        let _operation = self.lock()?;
        let path = self.path(mod_id, account_id)?;
        validate_key(key)?;
        let mut document = read_document(&path)?;
        if document.values.remove(key).is_some() {
            write_document(&path, &document)?;
        }
        Ok(())
    }

    pub fn snapshot(
        &self,
        mod_id: &str,
        account_id: &str,
    ) -> Result<(u32, BTreeMap<String, Value>), AppError> {
        let _operation = self.lock()?;
        let document = read_document(&self.path(mod_id, account_id)?)?;
        Ok((document.data_version, document.values))
    }

    pub fn replace(
        &self,
        mod_id: &str,
        account_id: &str,
        data_version: u32,
        values: BTreeMap<String, Value>,
    ) -> Result<(), AppError> {
        let _operation = self.lock()?;
        let path = self.path(mod_id, account_id)?;
        validate_values(&values)?;
        write_document(
            &path,
            &ModDataDocument {
                schema_version: DATA_SCHEMA_VERSION,
                data_version,
                values,
            },
        )
    }

    pub fn quota(
        &self,
        mod_id: &str,
        account_id: &str,
    ) -> Result<(usize, usize, usize, usize), AppError> {
        let _operation = self.lock()?;
        let document = read_document(&self.path(mod_id, account_id)?)?;
        let used_bytes = serde_json::to_vec(&document).map_err(data_json)?.len();
        Ok((
            document.values.len(),
            MAX_KEYS,
            used_bytes,
            MAX_DOCUMENT_BYTES,
        ))
    }

    pub fn clear_account(&self, account_id: &str) -> Result<(), AppError> {
        let _operation = self.lock()?;
        validate_identifier(account_id, "compte")?;
        for entry in fs::read_dir(&self.root).map_err(data_io)? {
            let entry = entry.map_err(data_io)?;
            if !entry.file_type().map_err(data_io)?.is_dir() {
                continue;
            }
            let path = entry.path().join(format!("{account_id}.json"));
            let backup = backup_path(&path);
            if path.is_file() {
                fs::remove_file(path).map_err(data_io)?;
            }
            if backup.is_file() {
                fs::remove_file(backup).map_err(data_io)?;
            }
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>, AppError> {
        self.operation_lock
            .lock()
            .map_err(|_| data_error("verrou du stockage des mods empoisonné"))
    }

    fn path(&self, mod_id: &str, account_id: &str) -> Result<PathBuf, AppError> {
        validate_mod_id(mod_id)?;
        validate_identifier(account_id, "compte")?;
        Ok(self.root.join(mod_id).join(format!("{account_id}.json")))
    }
}

fn read_document(path: &Path) -> Result<ModDataDocument, AppError> {
    let backup = backup_path(path);
    let document = match read_existing_document(path) {
        Ok(Some(document)) => document,
        Ok(None) if backup.exists() => read_existing_document(&backup)?
            .ok_or_else(|| data_error("sauvegarde des données du mod absente"))?,
        Ok(None) => ModDataDocument::default(),
        Err(primary_error) if backup.exists() => {
            log::warn!("données de mod restaurées depuis une sauvegarde: {primary_error}");
            read_existing_document(&backup)?.ok_or(primary_error)?
        }
        Err(error) => return Err(error),
    };
    if document.schema_version != DATA_SCHEMA_VERSION {
        return Err(data_error(format!(
            "version de données de mod non prise en charge: {}",
            document.schema_version
        )));
    }
    if document.values.len() > MAX_KEYS {
        return Err(data_error("trop de valeurs persistantes dans le document"));
    }
    validate_values(&document.values)?;
    Ok(document)
}

fn validate_values(values: &BTreeMap<String, Value>) -> Result<(), AppError> {
    if values.len() > MAX_KEYS {
        return Err(data_error("trop de valeurs persistantes pour ce mod"));
    }
    for (key, value) in values {
        validate_key(key)?;
        if serde_json::to_vec(value).map_err(data_json)?.len() > MAX_VALUE_BYTES {
            return Err(data_error(format!(
                "valeur persistante trop volumineuse: {key}"
            )));
        }
    }
    Ok(())
}

fn read_existing_document(path: &Path) -> Result<Option<ModDataDocument>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(path).map_err(data_io)?;
    if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err(data_error("document de données de mod trop volumineux"));
    }
    let bytes = fs::read(path).map_err(data_io)?;
    serde_json::from_slice(&bytes).map(Some).map_err(data_json)
}

fn write_document(path: &Path, document: &ModDataDocument) -> Result<(), AppError> {
    let payload = serde_json::to_vec_pretty(document).map_err(data_json)?;
    if payload.len() > MAX_DOCUMENT_BYTES {
        return Err(data_error("document de données de mod trop volumineux"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| data_error("chemin de données de mod sans parent"))?;
    fs::create_dir_all(parent).map_err(data_io)?;
    let temporary = parent.join(format!(".data-{}.tmp", uuid::Uuid::new_v4()));
    let backup = backup_path(path);
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(data_io)?;
    file.write_all(&payload).map_err(data_io)?;
    file.sync_all().map_err(data_io)?;
    drop(file);
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(data_io)?;
        }
        fs::rename(path, &backup).map_err(data_io)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(data_io(error));
    }
    if backup.exists() {
        fs::remove_file(backup).map_err(data_io)?;
    }
    Ok(())
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn validate_key(key: &str) -> Result<(), AppError> {
    validate_identifier(key, "clé")
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(data_error(format!("identifiant de {label} invalide")));
    }
    Ok(())
}

fn data_json(error: serde_json::Error) -> AppError {
    data_error(format!("données de mod invalides: {error}"))
}

fn data_io(error: std::io::Error) -> AppError {
    data_error(error.to_string())
}

fn data_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_and_isolates_values_by_mod_and_account() {
        let root = tempfile::tempdir().unwrap();
        let store = ModDataStore::new(root.path().to_path_buf()).unwrap();
        let profile = serde_json::json!({ "movement": "approach", "tempoMs": 900 });

        store
            .set("dev.twelia.hunt", "account-a", "profile", profile.clone())
            .unwrap();

        assert_eq!(
            store
                .get("dev.twelia.hunt", "account-a", "profile")
                .unwrap(),
            Some(profile)
        );
        assert_eq!(
            store
                .get("dev.twelia.hunt", "account-b", "profile")
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .get("dev.twelia.other", "account-a", "profile")
                .unwrap(),
            None
        );
    }

    #[test]
    fn removes_values_and_rejects_unsafe_keys() {
        let root = tempfile::tempdir().unwrap();
        let store = ModDataStore::new(root.path().to_path_buf()).unwrap();
        store
            .set(
                "dev.twelia.hunt",
                "account-a",
                "profile",
                serde_json::json!({ "version": 1 }),
            )
            .unwrap();
        store
            .remove("dev.twelia.hunt", "account-a", "profile")
            .unwrap();
        assert_eq!(
            store
                .get("dev.twelia.hunt", "account-a", "profile")
                .unwrap(),
            None
        );
        assert!(
            store
                .set("dev.twelia.hunt", "account-a", "../profile", Value::Null)
                .is_err()
        );
    }
}
