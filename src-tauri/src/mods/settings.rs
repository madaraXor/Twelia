use super::manifest::{ModManifest, validate_mod_id};
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

const SETTINGS_SCHEMA_VERSION: u32 = 1;
const MAX_SETTINGS_DOCUMENT_BYTES: u64 = 256 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModSettingsDocument {
    schema_version: u32,
    #[serde(default)]
    values: BTreeMap<String, Value>,
}

pub struct ModSettingsStore {
    root: PathBuf,
    lock: Mutex<()>,
}

impl ModSettingsStore {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).map_err(settings_io)?;
        Ok(Self {
            root,
            lock: Mutex::new(()),
        })
    }

    pub fn get(&self, manifest: &ModManifest) -> Result<BTreeMap<String, Value>, AppError> {
        let _operation = self
            .lock
            .lock()
            .map_err(|_| settings_error("verrou des réglages de mods empoisonné"))?;
        let mut values = manifest.settings_defaults();
        let document = read_document(&self.path(&manifest.id)?)?;
        for (key, value) in document.values {
            let Some(definition) = manifest.settings.get(&key) else {
                continue;
            };
            if definition.kind != "secret" && definition.validate_value(&key, &value).is_ok() {
                values.insert(key, value);
            }
        }
        values.retain(|key, _| {
            manifest
                .settings
                .get(key)
                .is_some_and(|definition| definition.kind != "secret")
        });
        Ok(values)
    }

    pub fn set(
        &self,
        manifest: &ModManifest,
        key: &str,
        value: Value,
    ) -> Result<BTreeMap<String, Value>, AppError> {
        let _operation = self
            .lock
            .lock()
            .map_err(|_| settings_error("verrou des réglages de mods empoisonné"))?;
        let definition = manifest
            .settings
            .get(key)
            .ok_or_else(|| settings_error(format!("réglage inconnu: {key}")))?;
        if definition.kind == "secret" {
            return Err(settings_error(
                "les secrets se configurent depuis une session via twelia.secrets",
            ));
        }
        definition.validate_value(key, &value)?;
        let path = self.path(&manifest.id)?;
        let mut document = read_document(&path)?;
        document.values.insert(key.to_owned(), value);
        write_document(&path, &document)?;
        drop(_operation);
        self.get(manifest)
    }

    pub fn reset(&self, manifest: &ModManifest) -> Result<BTreeMap<String, Value>, AppError> {
        let _operation = self
            .lock
            .lock()
            .map_err(|_| settings_error("verrou des réglages de mods empoisonné"))?;
        let path = self.path(&manifest.id)?;
        if path.exists() {
            fs::remove_file(path).map_err(settings_io)?;
        }
        drop(_operation);
        self.get(manifest)
    }

    fn path(&self, mod_id: &str) -> Result<PathBuf, AppError> {
        validate_mod_id(mod_id)?;
        Ok(self.root.join(format!("{mod_id}.json")))
    }
}

impl Default for ModSettingsDocument {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            values: BTreeMap::new(),
        }
    }
}

fn read_document(path: &Path) -> Result<ModSettingsDocument, AppError> {
    if !path.exists() {
        return Ok(ModSettingsDocument::default());
    }
    if fs::metadata(path).map_err(settings_io)?.len() > MAX_SETTINGS_DOCUMENT_BYTES {
        return Err(settings_error("document de réglages trop volumineux"));
    }
    let document: ModSettingsDocument =
        serde_json::from_slice(&fs::read(path).map_err(settings_io)?)
            .map_err(|error| settings_error(format!("réglages invalides: {error}")))?;
    if document.schema_version != SETTINGS_SCHEMA_VERSION {
        return Err(settings_error(format!(
            "version de réglages non prise en charge: {}",
            document.schema_version
        )));
    }
    Ok(document)
}

fn write_document(path: &Path, document: &ModSettingsDocument) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(document)
        .map_err(|error| settings_error(format!("réglages invalides: {error}")))?;
    if bytes.len() as u64 > MAX_SETTINGS_DOCUMENT_BYTES {
        return Err(settings_error("document de réglages trop volumineux"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| settings_error("dossier de réglages introuvable"))?;
    fs::create_dir_all(parent).map_err(settings_io)?;
    let temporary = parent.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(settings_io)?;
    file.write_all(&bytes).map_err(settings_io)?;
    file.sync_all().map_err(settings_io)?;
    drop(file);
    let backup = path.with_extension("json.bak");
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(settings_io)?;
        }
        fs::rename(path, &backup).map_err(settings_io)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(settings_io(error));
    }
    if backup.exists() {
        fs::remove_file(backup).map_err(settings_io)?;
    }
    Ok(())
}

fn settings_io(error: std::io::Error) -> AppError {
    settings_error(error.to_string())
}

fn settings_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::manifest::ModSettingDefinition;

    fn manifest() -> ModManifest {
        let mut settings = BTreeMap::new();
        settings.insert(
            "refresh".into(),
            ModSettingDefinition {
                kind: "number".into(),
                label: "Actualisation".into(),
                description: None,
                default: Some(serde_json::json!(30)),
                placeholder: None,
                minimum: Some(5.0),
                maximum: Some(60.0),
                step: Some(1.0),
                options: Vec::new(),
            },
        );
        ModManifest {
            schema_version: 1,
            id: "dev.twelia.settings".into(),
            name: "Settings".into(),
            version: "1.0.0".into(),
            api_version: 1,
            entry: "main.js".into(),
            game_entry: None,
            network: Vec::new(),
            capabilities: Vec::new(),
            settings,
            description: None,
            author: None,
            homepage: None,
            license: None,
            repository: None,
            min_twelia_version: None,
        }
    }

    #[test]
    fn merges_defaults_and_validates_overrides() {
        let root = tempfile::tempdir().unwrap();
        let store = ModSettingsStore::new(root.path().to_path_buf()).unwrap();
        let manifest = manifest();
        assert_eq!(store.get(&manifest).unwrap()["refresh"], 30);
        assert_eq!(
            store
                .set(&manifest, "refresh", serde_json::json!(45))
                .unwrap()["refresh"],
            45
        );
        assert!(
            store
                .set(&manifest, "refresh", serde_json::json!(100))
                .is_err()
        );
    }
}
