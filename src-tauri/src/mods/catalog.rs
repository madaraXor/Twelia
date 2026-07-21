use super::manifest::{ModManifest, validate_mod_id};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const ACTIVATIONS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct ModPackage {
    pub manifest: ModManifest,
    pub root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub manifest: ModManifest,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivationDocument {
    schema_version: u32,
    #[serde(default)]
    globally_enabled: bool,
    #[serde(default)]
    disabled_mods: BTreeSet<String>,
}

impl Default for ActivationDocument {
    fn default() -> Self {
        Self {
            schema_version: ACTIVATIONS_SCHEMA_VERSION,
            globally_enabled: false,
            disabled_mods: BTreeSet::new(),
        }
    }
}

#[derive(Debug)]
pub struct ModCatalog {
    packages: PathBuf,
    activations: PathBuf,
}

impl ModCatalog {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        let packages = root.join("packages");
        let data = root.join("data");
        fs::create_dir_all(&packages).map_err(mod_io)?;
        fs::create_dir_all(data).map_err(mod_io)?;
        Ok(Self {
            activations: root.join("enabled.json"),
            packages,
        })
    }

    pub fn list(&self) -> Result<Vec<InstalledMod>, AppError> {
        let activations = self.load_activations()?;
        let mut mods = self
            .packages()?
            .into_iter()
            .map(|package| {
                let enabled = !activations.disabled_mods.contains(&package.manifest.id);
                InstalledMod {
                    manifest: package.manifest,
                    enabled,
                }
            })
            .collect::<Vec<_>>();
        mods.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(mods)
    }

    pub fn create_project(&self, name: &str) -> Result<InstalledMod, AppError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::Mods("nom de mod invalide".into()));
        }

        let unique = uuid::Uuid::new_v4().simple().to_string();
        let mod_id = format!("local.mod-{}", &unique[..12]);
        let destination = self.packages.join(&mod_id);
        let staging = self.packages.join(format!(".creating-{unique}"));
        let result = (|| {
            fs::create_dir(&staging).map_err(mod_io)?;
            fs::create_dir(staging.join("dist")).map_err(mod_io)?;
            fs::write(staging.join("dist/main.js"), project_template(name)).map_err(mod_io)?;
            fs::write(staging.join("dist/game.js"), game_project_template(name)).map_err(mod_io)?;
            let manifest = ModManifest {
                schema_version: super::manifest::MOD_MANIFEST_SCHEMA_VERSION,
                id: mod_id.clone(),
                name: name.to_owned(),
                version: "0.1.0".into(),
                api_version: super::manifest::MOD_API_VERSION,
                entry: "dist/main.js".into(),
                game_entry: Some("dist/game.js".into()),
                network: Vec::new(),
                capabilities: vec!["game-entry".into()],
                settings: BTreeMap::from([(
                    "showGreeting".into(),
                    super::manifest::ModSettingDefinition {
                        kind: "boolean".into(),
                        label: "Afficher le message de bienvenue".into(),
                        description: Some("Exemple de réglage déclaré dans manifest.json".into()),
                        default: Some(serde_json::json!(true)),
                        placeholder: None,
                        minimum: None,
                        maximum: None,
                        step: None,
                        options: Vec::new(),
                    },
                )]),
                description: Some("Mod Twelia local généré depuis l’atelier".into()),
                author: None,
                homepage: None,
                license: None,
                repository: None,
                min_twelia_version: Some(env!("CARGO_PKG_VERSION").into()),
            };
            fs::write(
                staging.join("manifest.json"),
                serde_json::to_vec_pretty(&manifest).map_err(|error| {
                    AppError::Mods(format!("sérialisation du manifeste impossible: {error}"))
                })?,
            )
            .map_err(mod_io)?;
            fs::write(
                staging.join("README.md"),
                format!(
                    "# {name}\n\nMod Twelia local. `dist/main.js` gère la logique isolée et `dist/game.js` s’exécute dans la vue du jeu.\n"
                ),
            )
            .map_err(mod_io)?;
            manifest.validate(&staging)?;
            fs::rename(&staging, &destination).map_err(mod_io)?;
            Ok(InstalledMod {
                manifest,
                enabled: true,
            })
        })();
        if result.is_err() && staging.exists() {
            let _ = fs::remove_dir_all(staging);
        }
        result
    }

    pub fn globally_enabled(&self) -> Result<bool, AppError> {
        Ok(self.load_activations()?.globally_enabled)
    }

    pub fn set_globally_enabled(&self, enabled: bool) -> Result<(), AppError> {
        let mut document = self.load_activations()?;
        document.globally_enabled = enabled;
        atomic_json_write(&self.activations, &document)
    }

    pub fn set_mod_enabled(&self, mod_id: &str, enabled: bool) -> Result<(), AppError> {
        self.package(mod_id)?;
        let mut document = self.load_activations()?;
        if enabled {
            document.disabled_mods.remove(mod_id);
        } else {
            document.disabled_mods.insert(mod_id.to_owned());
        }
        atomic_json_write(&self.activations, &document)
    }

    pub fn enabled_packages(&self) -> Result<Vec<ModPackage>, AppError> {
        let activations = self.load_activations()?;
        Ok(self
            .packages()?
            .into_iter()
            .filter(|package| !activations.disabled_mods.contains(&package.manifest.id))
            .collect())
    }

    pub fn packages(&self) -> Result<Vec<ModPackage>, AppError> {
        let mut packages = Vec::new();
        for entry in fs::read_dir(&self.packages).map_err(mod_io)? {
            let entry = entry.map_err(mod_io)?;
            let file_type = entry.file_type().map_err(mod_io)?;
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let Some(directory_id) = entry.file_name().to_str().map(str::to_owned) else {
                log::warn!("dossier de mod non UTF-8 ignoré");
                continue;
            };
            if validate_mod_id(&directory_id).is_err() {
                log::warn!("dossier de mod invalide ignoré: {directory_id}");
                continue;
            }
            match ModManifest::load(&entry.path()) {
                Ok(manifest) if manifest.id == directory_id => packages.push(ModPackage {
                    manifest,
                    root: entry.path(),
                }),
                Ok(manifest) => log::warn!(
                    "mod ignoré: le dossier {directory_id} ne correspond pas à l'identifiant {}",
                    manifest.id
                ),
                Err(error) => log::warn!("mod {directory_id} ignoré: {error}"),
            }
        }
        packages.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(packages)
    }

    pub fn package(&self, mod_id: &str) -> Result<ModPackage, AppError> {
        validate_mod_id(mod_id)?;
        let root = self.packages.join(mod_id);
        if !root.is_dir() {
            return Err(AppError::Mods(format!("mod non installé: {mod_id}")));
        }
        let manifest = ModManifest::load(&root)?;
        if manifest.id != mod_id {
            return Err(AppError::Mods(format!(
                "l'identifiant du manifeste ne correspond pas au dossier {mod_id}"
            )));
        }
        Ok(ModPackage { manifest, root })
    }

    fn load_activations(&self) -> Result<ActivationDocument, AppError> {
        let backup = self.activations.with_extension("json.bak");
        let document = match read_activation_document(&self.activations) {
            Ok(Some(document)) => document,
            Ok(None) if backup.exists() => read_activation_document(&backup)?.ok_or_else(|| {
                AppError::Mods("sauvegarde des activations de mods absente".into())
            })?,
            Ok(None) => ActivationDocument::default(),
            Err(primary_error) if backup.exists() => {
                log::warn!("activations de mods restaurées depuis la sauvegarde: {primary_error}");
                read_activation_document(&backup)?.ok_or(primary_error)?
            }
            Err(error) => return Err(error),
        };
        if document.schema_version != ACTIVATIONS_SCHEMA_VERSION {
            return Err(AppError::Mods(format!(
                "version d'activations non prise en charge: {}",
                document.schema_version
            )));
        }
        for mod_id in &document.disabled_mods {
            validate_mod_id(mod_id)?;
        }
        Ok(document)
    }
}

fn project_template(name: &str) -> String {
    let name_json = serde_json::to_string(name).expect("un nom de mod est toujours sérialisable");
    format!(
        r#"// Mod Twelia généré automatiquement.
// Chaque session de jeu active dispose de son propre runtime isolé.

const modName = {name_json};
let clicks = 0;
let settings = twelia.settings.get();

function renderPanel() {{
  twelia.ui.update({{
    id: "main",
    title: modName,
    components: [
      {{
        type: "text",
        text: `Runtime actif pour ${{twelia.session.id}}`,
        tone: "success",
      }},
      {{ type: "text", text: `Actions reçues : ${{clicks}}`, style: "caption" }},
      {{
        type: "badge",
        text: settings.showGreeting ? "Bienvenue active" : "Bienvenue desactivee",
        tone: settings.showGreeting ? "success" : "muted",
      }},
      {{ type: "button", id: "hello", label: "Tester le mod", variant: "primary" }},
    ],
  }});
}}

twelia.log.info(`${{modName}} chargé pour la session ${{twelia.session.id}}`);
renderPanel();

twelia.commands.register({{
  id: "hello",
  title: `${{modName}} : tester`,
  description: "Declenche l'action de demonstration",
  execute: () => {{
    clicks += 1;
    renderPanel();
  }},
}});

twelia.settings.onChange((nextSettings) => {{
  settings = nextSettings;
  renderPanel();
}});

twelia.on("session.ready", (session) => {{
  twelia.log.info(`Session prête : ${{session.sessionId}}`);
  twelia.gameSide.send("hello", {{ from: "main.js" }});
}});

twelia.on("game-side.message", (message) => {{
  twelia.log.info(`Message de game.js : ${{message.type}}`);
}});

twelia.on("ui.action", (action) => {{
  if (action.panelId === "main" && action.actionId === "hello") {{
    clicks += 1;
    twelia.log.info("Action reçue depuis l’interface");
    renderPanel();
  }}
}});

twelia.on("unload", () => {{
  twelia.log.info("Mod arrêté");
}});
"#
    )
}

fn game_project_template(name: &str) -> String {
    let name_json = serde_json::to_string(name).expect("un nom de mod est toujours sérialisable");
    format!(
        r#"// Script exécuté dans la vue du jeu pour ce mod.
// Ce fichier a accès à window, document et aux objets du client.

const modName = {name_json};

tweliaGame.log.info(`${{modName}} : game.js chargé`);

tweliaGame.on("hello", (payload) => {{
  tweliaGame.log.info(`Message reçu de ${{payload.from || "main.js"}}`);
  tweliaGame.emit("hello.reply", {{ from: "game.js" }});
}});

tweliaGame.on("unload", () => {{
  tweliaGame.log.info(`${{modName}} : game.js déchargé`);
}});
"#
    )
}

fn read_activation_document(path: &Path) -> Result<Option<ActivationDocument>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(mod_io)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| AppError::Mods(format!("activations de mods invalides: {error}")))
}

fn atomic_json_write<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Mods("chemin d'activation sans parent".into()))?;
    fs::create_dir_all(parent).map_err(mod_io)?;
    let temporary = parent.join(format!("enabled-{}.tmp", uuid::Uuid::new_v4()));
    let backup = parent.join("enabled.json.bak");
    let payload = serde_json::to_vec_pretty(value)
        .map_err(|error| AppError::Mods(format!("sérialisation des activations: {error}")))?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(mod_io)?;
    file.write_all(&payload).map_err(mod_io)?;
    file.sync_all().map_err(mod_io)?;
    drop(file);
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(mod_io)?;
        }
        fs::rename(path, &backup).map_err(mod_io)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(mod_io(error));
    }
    if backup.exists() {
        fs::remove_file(backup).map_err(mod_io)?;
    }
    Ok(())
}

fn mod_io(error: std::io::Error) -> AppError {
    AppError::Mods(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install_test_mod(root: &Path, id: &str) {
        let package = root.join("packages").join(id);
        fs::create_dir_all(package.join("dist")).unwrap();
        fs::write(package.join("dist/main.js"), "export default {};").unwrap();
        fs::write(
            package.join("manifest.json"),
            serde_json::to_vec_pretty(&ModManifest {
                schema_version: 1,
                id: id.into(),
                name: "Test".into(),
                version: "1.0.0".into(),
                api_version: 1,
                entry: "dist/main.js".into(),
                game_entry: None,
                network: Vec::new(),
                capabilities: Vec::new(),
                settings: BTreeMap::new(),
                description: None,
                author: None,
                homepage: None,
                license: None,
                repository: None,
                min_twelia_version: None,
            })
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn discovers_installed_packages() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        install_test_mod(root.path(), "dev.twelia.test");

        let installed = catalog.list().unwrap();
        assert_eq!(installed.len(), 1);
        assert!(installed[0].enabled);
    }

    #[test]
    fn mods_are_globally_disabled_by_default() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        assert!(!catalog.globally_enabled().unwrap());
        catalog.set_globally_enabled(true).unwrap();
        assert!(catalog.globally_enabled().unwrap());
    }

    #[test]
    fn creates_a_valid_local_project() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        let installed = catalog.create_project("Mon premier mod").unwrap();
        assert!(installed.enabled);
        let package = catalog.package(&installed.manifest.id).unwrap();
        assert_eq!(package.manifest.name, "Mon premier mod");
        assert!(package.root.join("dist/main.js").is_file());
        assert!(package.root.join("dist/game.js").is_file());
        assert_eq!(package.manifest.game_entry.as_deref(), Some("dist/game.js"));
        assert!(package.root.join("README.md").is_file());
    }

    #[test]
    fn persists_individual_mod_activation() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        install_test_mod(root.path(), "dev.twelia.test");

        catalog.set_mod_enabled("dev.twelia.test", false).unwrap();
        assert!(!catalog.list().unwrap()[0].enabled);
        assert!(catalog.enabled_packages().unwrap().is_empty());

        let reloaded = ModCatalog::new(root.path().to_path_buf()).unwrap();
        assert!(!reloaded.list().unwrap()[0].enabled);
        reloaded.set_mod_enabled("dev.twelia.test", true).unwrap();
        assert!(reloaded.list().unwrap()[0].enabled);
    }

    #[test]
    fn recovers_activations_from_a_backup_document() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        catalog.set_globally_enabled(true).unwrap();
        fs::copy(
            root.path().join("enabled.json"),
            root.path().join("enabled.json.bak"),
        )
        .unwrap();
        fs::write(root.path().join("enabled.json"), "{broken").unwrap();
        assert!(catalog.globally_enabled().unwrap());
    }

    #[test]
    fn ignores_a_package_whose_directory_does_not_match_its_id() {
        let root = tempfile::tempdir().unwrap();
        let catalog = ModCatalog::new(root.path().to_path_buf()).unwrap();
        install_test_mod(root.path(), "dev.twelia.test");
        let manifest_path = root.path().join("packages/dev.twelia.test/manifest.json");
        let mut manifest: ModManifest =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.id = "dev.twelia.other".into();
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(catalog.list().unwrap().is_empty());
    }
}
