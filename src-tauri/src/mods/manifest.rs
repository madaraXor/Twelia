use crate::error::AppError;
use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

pub const MOD_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MOD_API_VERSION: u32 = 1;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024;

pub const MOD_CAPABILITIES: &[&str] = &[
    "network",
    "notifications",
    "clipboard.write",
    "files.user-selected",
    "secrets",
    "game-entry",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModSettingOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModSettingDefinition {
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ModSettingOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_entry: Option<String>,
    #[serde(default)]
    pub network: Vec<String>,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub settings: BTreeMap<String, ModSettingDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_twelia_version: Option<String>,
}

impl ModManifest {
    pub fn load(package_root: &Path) -> Result<Self, AppError> {
        let manifest_path = package_root.join("manifest.json");
        let bytes = fs::read(&manifest_path).map_err(|error| {
            AppError::Mods(format!(
                "impossible de lire {}: {error}",
                manifest_path.display()
            ))
        })?;
        let manifest: Self = serde_json::from_slice(&bytes).map_err(|error| {
            AppError::Mods(format!(
                "manifeste invalide dans {}: {error}",
                manifest_path.display()
            ))
        })?;
        manifest.validate(package_root)?;
        Ok(manifest)
    }

    pub fn validate(&self, package_root: &Path) -> Result<(), AppError> {
        if self.schema_version != MOD_MANIFEST_SCHEMA_VERSION {
            return Err(AppError::Mods(format!(
                "version de manifeste non prise en charge: {}",
                self.schema_version
            )));
        }
        if self.api_version != MOD_API_VERSION {
            return Err(AppError::Mods(format!(
                "version d'API de mod non prise en charge: {}",
                self.api_version
            )));
        }
        validate_mod_id(&self.id)?;
        let name = self.name.trim();
        if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::Mods("nom de mod invalide".into()));
        }
        Version::parse(&self.version)
            .map_err(|error| AppError::Mods(format!("version SemVer invalide: {error}")))?;

        validate_entry(package_root, &self.entry, "point d'entrée principal")?;
        if let Some(game_entry) = &self.game_entry {
            if game_entry == &self.entry {
                return Err(AppError::Mods(
                    "les points d'entrée principal et jeu doivent être distincts".into(),
                ));
            }
            validate_entry(package_root, game_entry, "point d'entrée jeu")?;
        }

        if self.network.len() > 32 {
            return Err(AppError::Mods("trop d’origines réseau déclarées".into()));
        }
        let mut network_origins = HashSet::new();
        for value in &self.network {
            let origin = validate_network_origin(value)?;
            if !network_origins.insert(origin) {
                return Err(AppError::Mods("origine réseau dupliquée".into()));
            }
        }
        let mut capabilities = HashSet::new();
        for capability in &self.capabilities {
            if !MOD_CAPABILITIES.contains(&capability.as_str()) {
                return Err(AppError::Mods(format!(
                    "capacité de mod inconnue: {capability}"
                )));
            }
            if !capabilities.insert(capability) {
                return Err(AppError::Mods(format!(
                    "capacité de mod dupliquée: {capability}"
                )));
            }
        }
        if !self.network.is_empty() && !self.allows_capability("network") {
            return Err(AppError::Mods(
                "une liste network nécessite la capacité network".into(),
            ));
        }
        if self.network.is_empty() && self.allows_capability("network") {
            return Err(AppError::Mods(
                "la capacité network nécessite au moins une origine HTTPS".into(),
            ));
        }
        if self.game_entry.is_some() && !self.allows_capability("game-entry") {
            return Err(AppError::Mods(
                "un gameEntry nécessite la capacité game-entry".into(),
            ));
        }
        if self.game_entry.is_none() && self.allows_capability("game-entry") {
            return Err(AppError::Mods(
                "la capacité game-entry nécessite un gameEntry".into(),
            ));
        }
        if self.settings.len() > 64 {
            return Err(AppError::Mods("trop de réglages déclarés".into()));
        }
        for (key, definition) in &self.settings {
            validate_setting_key(key)?;
            definition.validate(key)?;
        }
        if self
            .settings
            .values()
            .any(|definition| definition.kind == "secret")
            && !self.allows_capability("secrets")
        {
            return Err(AppError::Mods(
                "un réglage secret nécessite la capacité secrets".into(),
            ));
        }
        validate_optional_text(self.description.as_deref(), 500, "description")?;
        validate_optional_text(self.author.as_deref(), 120, "auteur")?;
        validate_optional_text(self.license.as_deref(), 80, "licence")?;
        if let Some(homepage) = &self.homepage {
            validate_https_url(homepage, "page d’accueil")?;
        }
        if let Some(repository) = &self.repository {
            validate_https_url(repository, "dépôt")?;
        }
        if let Some(minimum) = &self.min_twelia_version {
            let minimum = Version::parse(minimum).map_err(|error| {
                AppError::Mods(format!("version minimale de Twelia invalide: {error}"))
            })?;
            let current = Version::parse(env!("CARGO_PKG_VERSION"))
                .expect("la version du paquet Twelia est une version SemVer");
            if current < minimum {
                return Err(AppError::Mods(format!(
                    "ce mod nécessite Twelia {minimum} ou plus récent"
                )));
            }
        }
        Ok(())
    }

    pub fn allows_capability(&self, capability: &str) -> bool {
        self.capabilities
            .iter()
            .any(|candidate| candidate == capability)
    }

    pub fn settings_defaults(&self) -> BTreeMap<String, Value> {
        self.settings
            .iter()
            .filter_map(|(key, definition)| {
                definition.default.clone().map(|value| (key.clone(), value))
            })
            .collect()
    }

    pub fn entry_path(&self, package_root: &Path) -> Result<PathBuf, AppError> {
        Ok(package_root.join(safe_entry_path(&self.entry)?))
    }

    pub fn game_entry_path(&self, package_root: &Path) -> Result<Option<PathBuf>, AppError> {
        self.game_entry
            .as_deref()
            .map(safe_entry_path)
            .transpose()
            .map(|path| path.map(|path| package_root.join(path)))
    }
}

fn validate_entry(package_root: &Path, value: &str, label: &str) -> Result<(), AppError> {
    let entry = safe_entry_path(value)?;
    if entry.extension().and_then(|extension| extension.to_str()) != Some("js") {
        return Err(AppError::Mods(format!(
            "le {label} d'un mod doit être un fichier .js"
        )));
    }
    let entry_path = package_root.join(entry);
    let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
        AppError::Mods(format!(
            "{label} introuvable {}: {error}",
            entry_path.display()
        ))
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_ENTRY_BYTES
    {
        return Err(AppError::Mods(format!(
            "{label} invalide ou supérieur à 2 Mio"
        )));
    }
    let canonical_root = fs::canonicalize(package_root).map_err(|error| {
        AppError::Mods(format!(
            "dossier de mod inaccessible {}: {error}",
            package_root.display()
        ))
    })?;
    let canonical_entry = fs::canonicalize(&entry_path).map_err(|error| {
        AppError::Mods(format!(
            "point d'entrée inaccessible {}: {error}",
            entry_path.display()
        ))
    })?;
    if !canonical_entry.starts_with(canonical_root) {
        return Err(AppError::Mods(format!("le {label} sort du dossier du mod")));
    }
    Ok(())
}

pub fn validate_mod_id(id: &str) -> Result<(), AppError> {
    if id.is_empty()
        || id.len() > 128
        || id.starts_with(['.', '-'])
        || id.ends_with(['.', '-'])
        || id.contains("..")
        || !id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '-')
        })
    {
        return Err(AppError::Mods(
            "identifiant de mod invalide; utilisez des minuscules, chiffres, points et tirets"
                .into(),
        ));
    }
    Ok(())
}

fn safe_entry_path(value: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains('\\')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Mods(format!(
            "chemin de point d'entrée dangereux: {value}"
        )));
    }
    Ok(path.to_path_buf())
}

fn validate_network_origin(value: &str) -> Result<String, AppError> {
    let url = Url::parse(value)
        .map_err(|error| AppError::Mods(format!("origine réseau invalide '{value}': {error}")))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(AppError::Mods(format!("origine réseau non sûre: {value}")));
    }
    Ok(url.origin().ascii_serialization())
}

impl ModSettingDefinition {
    pub fn validate_value(&self, key: &str, value: &Value) -> Result<(), AppError> {
        match self.kind.as_str() {
            "boolean" if value.is_boolean() => Ok(()),
            "string" => {
                let value = value.as_str().ok_or_else(|| {
                    AppError::Mods(format!("le réglage {key} doit être une chaîne"))
                })?;
                if value.chars().count() > 4_096
                    || value.chars().any(|character| {
                        character.is_control() && !matches!(character, '\n' | '\r' | '\t')
                    })
                {
                    Err(AppError::Mods(format!("valeur invalide pour {key}")))
                } else {
                    Ok(())
                }
            }
            "number" => {
                let number = value
                    .as_f64()
                    .filter(|number| number.is_finite())
                    .ok_or_else(|| {
                        AppError::Mods(format!("le réglage {key} doit être un nombre fini"))
                    })?;
                if self.minimum.is_some_and(|minimum| number < minimum)
                    || self.maximum.is_some_and(|maximum| number > maximum)
                {
                    Err(AppError::Mods(format!("le réglage {key} est hors limites")))
                } else {
                    Ok(())
                }
            }
            "select" => {
                let value = value.as_str().ok_or_else(|| {
                    AppError::Mods(format!("le réglage {key} doit être une chaîne"))
                })?;
                if self.options.iter().any(|option| option.value == value) {
                    Ok(())
                } else {
                    Err(AppError::Mods(format!("option inconnue pour {key}")))
                }
            }
            "secret" if value.is_string() => Ok(()),
            _ => Err(AppError::Mods(format!(
                "type de valeur invalide pour le réglage {key}"
            ))),
        }
    }

    fn validate(&self, key: &str) -> Result<(), AppError> {
        if !matches!(
            self.kind.as_str(),
            "boolean" | "string" | "number" | "select" | "secret"
        ) {
            return Err(AppError::Mods(format!(
                "type inconnu pour le réglage {key}: {}",
                self.kind
            )));
        }
        validate_text(&self.label, 120, "libellé de réglage")?;
        validate_optional_text(self.description.as_deref(), 500, "description de réglage")?;
        validate_optional_text(self.placeholder.as_deref(), 200, "placeholder de réglage")?;
        if self.kind == "select" {
            if self.options.is_empty() || self.options.len() > 100 {
                return Err(AppError::Mods(format!(
                    "le réglage {key} doit déclarer entre 1 et 100 options"
                )));
            }
            let mut values = HashSet::new();
            for option in &self.options {
                validate_text(&option.value, 128, "valeur d’option")?;
                validate_text(&option.label, 128, "libellé d’option")?;
                if !values.insert(&option.value) {
                    return Err(AppError::Mods(format!(
                        "option dupliquée pour le réglage {key}"
                    )));
                }
            }
        } else if !self.options.is_empty() {
            return Err(AppError::Mods(format!(
                "le réglage {key} ne peut pas déclarer d’options"
            )));
        }
        if self.kind == "number" {
            for value in [self.minimum, self.maximum, self.step]
                .into_iter()
                .flatten()
            {
                if !value.is_finite() {
                    return Err(AppError::Mods(format!(
                        "limite numérique invalide pour {key}"
                    )));
                }
            }
            if self
                .minimum
                .zip(self.maximum)
                .is_some_and(|(min, max)| min > max)
                || self.step.is_some_and(|step| step <= 0.0)
            {
                return Err(AppError::Mods(format!(
                    "bornes numériques invalides pour {key}"
                )));
            }
        } else if self.minimum.is_some() || self.maximum.is_some() || self.step.is_some() {
            return Err(AppError::Mods(format!(
                "le réglage {key} ne peut pas déclarer de bornes numériques"
            )));
        }
        if self.kind == "secret" && self.default.is_some() {
            return Err(AppError::Mods(
                "un secret ne peut pas avoir de valeur par défaut".into(),
            ));
        }
        if let Some(default) = &self.default {
            self.validate_value(key, default)?;
        }
        Ok(())
    }
}

fn validate_setting_key(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(AppError::Mods(format!(
            "identifiant de réglage invalide: {value}"
        )));
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty()
        || value.chars().count() > max_chars
        || value.chars().any(char::is_control)
    {
        Err(AppError::Mods(format!("{label} invalide")))
    } else {
        Ok(())
    }
}

fn validate_optional_text(
    value: Option<&str>,
    max_chars: usize,
    label: &str,
) -> Result<(), AppError> {
    value.map_or(Ok(()), |value| validate_text(value, max_chars, label))
}

fn validate_https_url(value: &str, label: &str) -> Result<(), AppError> {
    let url =
        Url::parse(value).map_err(|error| AppError::Mods(format!("{label} invalide: {error}")))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(AppError::Mods(format!("{label} doit utiliser HTTPS")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_manifest() -> ModManifest {
        ModManifest {
            schema_version: 1,
            id: "dev.twelia.example".into(),
            name: "Exemple".into(),
            version: "1.2.3".into(),
            api_version: 1,
            entry: "dist/main.js".into(),
            game_entry: None,
            network: vec!["https://prices.example.com".into()],
            capabilities: vec!["network".into()],
            settings: BTreeMap::new(),
            description: None,
            author: None,
            homepage: None,
            license: None,
            repository: None,
            min_twelia_version: None,
        }
    }

    #[test]
    fn validates_a_safe_manifest() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("dist")).unwrap();
        fs::write(root.path().join("dist/main.js"), "export default {};").unwrap();
        valid_manifest().validate(root.path()).unwrap();
    }

    #[test]
    fn rejects_unsafe_entry_and_network_paths() {
        let root = tempfile::tempdir().unwrap();
        let mut manifest = valid_manifest();
        manifest.entry = "../main.js".into();
        assert!(manifest.validate(root.path()).is_err());

        fs::create_dir_all(root.path().join("dist")).unwrap();
        fs::write(root.path().join("dist/main.js"), "export default {};").unwrap();
        manifest.entry = "dist/main.js".into();
        manifest.network = vec!["http://localhost:3000".into()];
        assert!(manifest.validate(root.path()).is_err());
    }

    #[test]
    fn rejects_ambiguous_mod_identifiers() {
        for id in ["Dev.Mod", ".hidden", "dev..mod", "dev_mod"] {
            assert!(validate_mod_id(id).is_err(), "{id} should be rejected");
        }
    }

    #[test]
    fn validates_flat_capabilities_and_declarative_settings() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("dist")).unwrap();
        fs::write(root.path().join("dist/main.js"), "export default {};").unwrap();
        let mut manifest = valid_manifest();
        manifest.settings.insert(
            "endpointMode".into(),
            ModSettingDefinition {
                kind: "select".into(),
                label: "Mode".into(),
                description: None,
                default: Some(serde_json::json!("safe")),
                placeholder: None,
                minimum: None,
                maximum: None,
                step: None,
                options: vec![ModSettingOption {
                    value: "safe".into(),
                    label: "Sûr".into(),
                }],
            },
        );
        manifest.validate(root.path()).unwrap();

        manifest.capabilities.push("network".into());
        assert!(manifest.validate(root.path()).is_err());
        manifest.capabilities.pop();
        manifest.capabilities.push("unknown".into());
        assert!(manifest.validate(root.path()).is_err());
    }

    #[test]
    fn requires_explicit_and_coherent_capabilities() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("dist")).unwrap();
        fs::write(root.path().join("dist/main.js"), "export default {};").unwrap();
        fs::write(root.path().join("dist/game.js"), "export default {};").unwrap();

        let mut manifest = valid_manifest();
        manifest.capabilities.clear();
        assert!(manifest.validate(root.path()).is_err());

        manifest.network.clear();
        manifest.capabilities = vec!["network".into()];
        assert!(manifest.validate(root.path()).is_err());

        manifest.capabilities = vec!["game-entry".into()];
        assert!(manifest.validate(root.path()).is_err());

        manifest.game_entry = Some("dist/game.js".into());
        manifest.capabilities.clear();
        assert!(manifest.validate(root.path()).is_err());

        let missing_capabilities = serde_json::json!({
            "schemaVersion": 1,
            "id": "dev.twelia.strict",
            "name": "Strict",
            "version": "1.0.0",
            "apiVersion": 1,
            "entry": "dist/main.js"
        });
        assert!(serde_json::from_value::<ModManifest>(missing_capabilities).is_err());
    }
}
