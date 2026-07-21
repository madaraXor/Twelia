#[cfg(test)]
use super::game::unavailable_game_control;
use super::{
    catalog::{InstalledMod, ModCatalog, ModPackage},
    commands::{ModCommandSnapshot, ModCommandStore},
    data::ModDataStore,
    game::{ModGameControl, TauriModGameControl},
    http::ModHttpClient,
    logs::{ModLogBuffer, ModLogEntry},
    platform::ModPlatformServices,
    runtime::{ModGroupBus, ModInstanceSnapshot, ModInstanceState, ModRuntimeHandle},
    secrets::ModSecretStore,
    settings::ModSettingsStore,
    ui::{ModUiPanelSnapshot, ModUiStore},
};
use crate::{error::AppError, sessions::GameSession};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::AppHandle;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ModInstanceKey {
    mod_id: String,
    session_id: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModReconcileReport {
    pub started: Vec<String>,
    pub stopped: Vec<String>,
    pub errors: Vec<String>,
}

pub struct ModSupervisor {
    catalog: ModCatalog,
    instances: Mutex<HashMap<ModInstanceKey, ModRuntimeHandle>>,
    starting_game_side: Mutex<HashSet<ModInstanceKey>>,
    pending_game_side: Mutex<HashMap<ModInstanceKey, Vec<(String, Value)>>>,
    manual_overrides: Mutex<HashMap<ModInstanceKey, bool>>,
    logs: Arc<ModLogBuffer>,
    ui: Arc<ModUiStore>,
    commands: Arc<ModCommandStore>,
    game: Arc<dyn ModGameControl>,
    data: Arc<ModDataStore>,
    settings: Arc<ModSettingsStore>,
    secrets: Arc<ModSecretStore>,
    http: Arc<ModHttpClient>,
    platform: Option<Arc<ModPlatformServices>>,
    group: Arc<ModGroupBus>,
    operation_lock: Mutex<()>,
}

impl ModSupervisor {
    #[cfg(test)]
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        Self::with_game_control(root, unavailable_game_control())
    }

    pub fn with_app(root: PathBuf, app: AppHandle) -> Result<Self, AppError> {
        Self::with_services(
            root,
            Arc::new(TauriModGameControl::new(app.clone())),
            Some(Arc::new(ModPlatformServices::new(app))),
        )
    }

    #[cfg(test)]
    fn with_game_control(root: PathBuf, game: Arc<dyn ModGameControl>) -> Result<Self, AppError> {
        Self::with_services(root, game, None)
    }

    fn with_services(
        root: PathBuf,
        game: Arc<dyn ModGameControl>,
        platform: Option<Arc<ModPlatformServices>>,
    ) -> Result<Self, AppError> {
        let data = Arc::new(ModDataStore::new(root.join("data"))?);
        let settings = Arc::new(ModSettingsStore::new(root.join("settings"))?);
        let secrets = Arc::new(ModSecretStore::new(root.join("secrets"))?);
        Ok(Self {
            catalog: ModCatalog::new(root)?,
            instances: Mutex::new(HashMap::new()),
            starting_game_side: Mutex::new(HashSet::new()),
            pending_game_side: Mutex::new(HashMap::new()),
            manual_overrides: Mutex::new(HashMap::new()),
            logs: Arc::new(ModLogBuffer::default()),
            ui: Arc::new(ModUiStore::default()),
            commands: Arc::new(ModCommandStore::default()),
            game,
            data,
            settings,
            secrets,
            http: Arc::new(ModHttpClient::new()?),
            platform,
            group: Arc::new(ModGroupBus::default()),
            operation_lock: Mutex::new(()),
        })
    }

    pub fn list_installed(&self) -> Result<Vec<InstalledMod>, AppError> {
        self.catalog.list()
    }

    pub fn create_project(&self, name: &str) -> Result<InstalledMod, AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        self.catalog.create_project(name)
    }

    pub fn mod_settings(&self, mod_id: &str) -> Result<Value, AppError> {
        let package = self.catalog.package(mod_id)?;
        serde_json::to_value(self.settings.get(&package.manifest)?)
            .map_err(|error| AppError::Mods(format!("réglages de mod invalides: {error}")))
    }

    pub fn set_mod_setting(
        &self,
        mod_id: &str,
        key: &str,
        value: Value,
    ) -> Result<Value, AppError> {
        let package = self.catalog.package(mod_id)?;
        let values = self.settings.set(&package.manifest, key, value)?;
        let payload = serde_json::to_value(&values)
            .map_err(|error| AppError::Mods(format!("réglages de mod invalides: {error}")))?;
        self.dispatch_to_mod(mod_id, "settings.changed", &payload)?;
        Ok(payload)
    }

    pub fn reset_mod_settings(&self, mod_id: &str) -> Result<Value, AppError> {
        let package = self.catalog.package(mod_id)?;
        let values = self.settings.reset(&package.manifest)?;
        let payload = serde_json::to_value(&values)
            .map_err(|error| AppError::Mods(format!("réglages de mod invalides: {error}")))?;
        self.dispatch_to_mod(mod_id, "settings.changed", &payload)?;
        Ok(payload)
    }

    pub fn complete_file_dialog(
        &self,
        request_id: &str,
        path: Option<String>,
    ) -> Result<(), AppError> {
        self.platform
            .as_ref()
            .ok_or_else(|| AppError::Mods("services de plateforme indisponibles".into()))?
            .complete_file_dialog(request_id, path)
    }

    pub fn project_entry(&self, mod_id: &str) -> Result<PathBuf, AppError> {
        let package = self.catalog.package(mod_id)?;
        package.manifest.entry_path(&package.root)
    }

    pub fn project_game_entry(&self, mod_id: &str) -> Result<PathBuf, AppError> {
        let package = self.catalog.package(mod_id)?;
        package
            .manifest
            .game_entry_path(&package.root)?
            .ok_or_else(|| AppError::Mods(format!("le mod {mod_id} ne déclare aucun gameEntry")))
    }

    pub fn globally_enabled(&self) -> Result<bool, AppError> {
        self.catalog.globally_enabled()
    }

    pub fn set_globally_enabled(&self, enabled: bool) -> Result<(), AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        self.catalog.set_globally_enabled(enabled)?;
        if !enabled {
            self.manual_overrides
                .lock()
                .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
                .clear();
            self.pending_game_side
                .lock()
                .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?
                .clear();
            self.starting_game_side
                .lock()
                .map_err(|_| AppError::Mods("verrou des gameEntry en démarrage empoisonné".into()))?
                .clear();
            let removed = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>();
            for runtime in removed {
                runtime.stop();
            }
        }
        Ok(())
    }

    pub fn set_mod_enabled(&self, mod_id: &str, enabled: bool) -> Result<(), AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        self.catalog.set_mod_enabled(mod_id, enabled)?;
        self.manual_overrides
            .lock()
            .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
            .retain(|key, _| key.mod_id != mod_id);
        Ok(())
    }

    pub fn load_mod(
        &self,
        session: &GameSession,
        mod_id: &str,
    ) -> Result<ModInstanceSnapshot, AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        if !self.catalog.globally_enabled()? {
            return Err(AppError::Mods(
                "l’exécution globale des mods est désactivée".into(),
            ));
        }
        let package = self.catalog.package(mod_id)?;
        let key = ModInstanceKey {
            mod_id: mod_id.to_owned(),
            session_id: session.id.clone(),
        };
        let previous = {
            let mut instances = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
            if let Some(runtime) = instances.get(&key) {
                let snapshot = runtime.snapshot();
                if matches!(
                    snapshot.state,
                    ModInstanceState::Starting | ModInstanceState::Running
                ) {
                    self.manual_overrides
                        .lock()
                        .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
                        .insert(key.clone(), true);
                    return Ok(snapshot);
                }
            }
            instances.remove(&key)
        };
        if let Some(runtime) = previous {
            runtime.stop();
        }

        let (key, runtime) = self.start_instance(package, session)?;
        let snapshot = runtime.snapshot();
        self.instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
            .insert(key.clone(), runtime);
        self.flush_pending_game_side(&key)?;
        self.manual_overrides
            .lock()
            .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
            .insert(
                ModInstanceKey {
                    mod_id: mod_id.to_owned(),
                    session_id: session.id.clone(),
                },
                true,
            );
        Ok(snapshot)
    }

    pub fn unload_mod(&self, session_id: &str, mod_id: &str) -> Result<(), AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        self.catalog.package(mod_id)?;
        let key = ModInstanceKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
        };
        self.manual_overrides
            .lock()
            .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
            .insert(key.clone(), false);
        let runtime = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
            .remove(&key);
        self.pending_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?
            .remove(&key);
        self.starting_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des gameEntry en démarrage empoisonné".into()))?
            .remove(&key);
        if let Some(runtime) = runtime {
            runtime.stop();
        }
        Ok(())
    }

    pub fn clear_account(&self, account_id: &str) -> Result<(), AppError> {
        self.stop_account(account_id)?;
        self.data.clear_account(account_id)?;
        self.secrets.clear_account(account_id)
    }

    pub fn reconcile_session(&self, session: &GameSession) -> Result<ModReconcileReport, AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        let packages = if self.catalog.globally_enabled()? {
            let overrides = self
                .manual_overrides
                .lock()
                .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
                .iter()
                .filter(|(key, _)| key.session_id == session.id)
                .map(|(key, enabled)| (key.mod_id.clone(), *enabled))
                .collect::<HashMap<_, _>>();
            let mut packages = self.catalog.enabled_packages()?;
            for (mod_id, enabled) in &overrides {
                if *enabled
                    && !packages
                        .iter()
                        .any(|package| package.manifest.id == *mod_id)
                {
                    match self.catalog.package(mod_id) {
                        Ok(package) => packages.push(package),
                        Err(error) => log::warn!(
                            "dérogation de session ignorée pour le mod {mod_id}: {error}"
                        ),
                    }
                }
            }
            packages.retain(|package| overrides.get(&package.manifest.id).copied().unwrap_or(true));
            packages.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
            packages
        } else {
            Vec::new()
        };
        let available = packages
            .iter()
            .map(|package| package.manifest.id.clone())
            .collect::<HashSet<_>>();
        let mut report = ModReconcileReport::default();

        let removed = {
            let mut instances = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
            let keys = instances
                .keys()
                .filter(|key| key.session_id == session.id && !available.contains(&key.mod_id))
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| instances.remove(&key).map(|runtime| (key, runtime)))
                .collect::<Vec<_>>()
        };
        for (key, runtime) in removed {
            self.pending_game_side
                .lock()
                .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?
                .remove(&key);
            runtime.stop();
            report.stopped.push(key.mod_id);
        }

        for package in packages {
            let key = ModInstanceKey {
                mod_id: package.manifest.id.clone(),
                session_id: session.id.clone(),
            };
            let already_running = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
                .contains_key(&key);
            if already_running {
                continue;
            }
            match self.start_instance(package, session) {
                Ok((key, runtime)) => {
                    report.started.push(key.mod_id.clone());
                    self.instances
                        .lock()
                        .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
                        .insert(key.clone(), runtime);
                    self.flush_pending_game_side(&key)?;
                }
                Err(error) => {
                    let message = error.to_string();
                    log::error!(
                        "impossible de démarrer un mod pour la session {}: {message}",
                        session.id
                    );
                    report.errors.push(message);
                }
            }
        }
        Ok(report)
    }

    pub fn stop_session(&self, session_id: &str) -> Result<(), AppError> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| AppError::Mods("verrou du superviseur empoisonné".into()))?;
        self.manual_overrides
            .lock()
            .map_err(|_| AppError::Mods("verrou des dérogations empoisonné".into()))?
            .retain(|key, _| key.session_id != session_id);
        self.pending_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?
            .retain(|key, _| key.session_id != session_id);
        self.starting_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des gameEntry en démarrage empoisonné".into()))?
            .retain(|key| key.session_id != session_id);
        let removed = {
            let mut instances = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
            let keys = instances
                .keys()
                .filter(|key| key.session_id == session_id)
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| instances.remove(&key))
                .collect::<Vec<_>>()
        };
        for runtime in removed {
            runtime.stop();
        }
        Ok(())
    }

    pub fn stop_account(&self, account_id: &str) -> Result<(), AppError> {
        let sessions = self
            .snapshots()?
            .into_iter()
            .filter(|snapshot| snapshot.account_id == account_id)
            .map(|snapshot| snapshot.session_id)
            .collect::<HashSet<_>>();
        for session_id in sessions {
            self.stop_session(&session_id)?;
        }
        Ok(())
    }

    pub fn dispatch_session(
        &self,
        session_id: &str,
        event: &str,
        payload: &Value,
    ) -> Result<(), AppError> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
        for (key, runtime) in instances.iter() {
            if key.session_id == session_id
                && let Err(error) = runtime.dispatch(event, payload)
            {
                log::warn!(
                    "événement {event} non transmis au mod {}: {error}",
                    key.mod_id
                );
            }
        }
        Ok(())
    }

    fn dispatch_to_mod(&self, mod_id: &str, event: &str, payload: &Value) -> Result<(), AppError> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
        for (key, runtime) in instances.iter() {
            if key.mod_id == mod_id
                && let Err(error) = runtime.dispatch(event, payload)
            {
                log::warn!(
                    "événement {event} non transmis au mod {} pour {}: {error}",
                    key.mod_id,
                    key.session_id
                );
            }
        }
        Ok(())
    }

    pub fn dispatch_game_side(
        &self,
        session_id: &str,
        mod_id: &str,
        event: &str,
        payload: &Value,
    ) -> Result<(), AppError> {
        let key = ModInstanceKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
        };
        if event == "log" {
            let package = self.catalog.package(mod_id)?;
            if package.manifest.game_entry.is_none() {
                return Err(AppError::Mods(format!(
                    "le mod {mod_id} ne déclare aucun gameEntry"
                )));
            }
            let level = payload
                .get("level")
                .and_then(Value::as_str)
                .unwrap_or("info");
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Mods("message de log gameEntry invalide".into()))?;
            self.logs.push(mod_id, session_id, level, message);
            return Ok(());
        }
        {
            let instances = self
                .instances
                .lock()
                .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
            if let Some(runtime) = instances.get(&key) {
                return runtime.dispatch(
                    "game-side.message",
                    &json!({
                        "type": event,
                        "payload": payload,
                    }),
                );
            }
        }

        let package = self.catalog.package(mod_id)?;
        if package.manifest.game_entry.is_none() {
            return Err(AppError::Mods(format!(
                "le mod {mod_id} ne déclare aucun gameEntry"
            )));
        }
        let is_starting = self
            .starting_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des gameEntry en démarrage empoisonné".into()))?
            .contains(&key);
        if !is_starting {
            return Err(AppError::Mods("runtime destinataire introuvable".into()));
        }
        let mut pending = self
            .pending_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?;
        let messages = pending.entry(key).or_default();
        if messages.len() >= 64 {
            return Err(AppError::Mods("file de messages gameEntry saturée".into()));
        }
        messages.push((event.to_owned(), payload.clone()));
        Ok(())
    }

    pub fn reload_game_entries(&self, session_id: &str) -> Result<(), AppError> {
        let entries = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
            .iter()
            .filter(|(key, _)| key.session_id == session_id)
            .filter_map(|(key, runtime)| {
                runtime
                    .game_entry_source()
                    .map(|source| (key.mod_id.clone(), source))
            })
            .collect::<Vec<_>>();
        for (mod_id, source) in entries {
            if let Err(error) = self.game.install_game_entry(&mod_id, session_id, &source) {
                log::warn!("gameEntry du mod {mod_id} non réinjecté pour {session_id}: {error}");
            }
        }
        Ok(())
    }

    pub fn snapshots(&self) -> Result<Vec<ModInstanceSnapshot>, AppError> {
        let mut snapshots = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?
            .values()
            .map(ModRuntimeHandle::snapshot)
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| {
            left.session_id
                .cmp(&right.session_id)
                .then_with(|| left.mod_id.cmp(&right.mod_id))
        });
        Ok(snapshots)
    }

    pub fn logs(&self, session_id: Option<&str>) -> Vec<ModLogEntry> {
        self.logs.list(session_id)
    }

    pub fn clear_logs(&self, session_id: Option<&str>) {
        self.logs.clear(session_id);
    }

    pub fn ui_panels(&self, session_id: &str) -> Vec<ModUiPanelSnapshot> {
        self.ui.list(session_id)
    }

    pub fn commands(&self) -> Vec<ModCommandSnapshot> {
        self.commands.list()
    }

    pub fn dispatch_command(
        &self,
        mod_id: &str,
        session_id: &str,
        command_id: &str,
    ) -> Result<(), AppError> {
        if !self.commands.contains(mod_id, session_id, command_id) {
            return Err(AppError::Mods("commande de mod introuvable".into()));
        }
        let key = ModInstanceKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
        };
        let instances = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
        let runtime = instances
            .get(&key)
            .ok_or_else(|| AppError::Mods("runtime de mod introuvable".into()))?;
        runtime.dispatch(
            "command.execute",
            &json!({
                "commandId": command_id,
                "sessionId": session_id,
            }),
        )
    }

    pub fn dispatch_ui_action(
        &self,
        session_id: &str,
        mod_id: &str,
        panel_id: &str,
        action_id: &str,
        value: Option<Value>,
    ) -> Result<(), AppError> {
        self.ui
            .validate_action(mod_id, session_id, panel_id, action_id)?;
        let value = value.unwrap_or(Value::Null);
        if serde_json::to_vec(&value)
            .map_err(|error| AppError::Mods(format!("valeur d’action invalide: {error}")))?
            .len()
            > 16 * 1024
        {
            return Err(AppError::Mods("valeur d’action trop volumineuse".into()));
        }
        let key = ModInstanceKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
        };
        let instances = self
            .instances
            .lock()
            .map_err(|_| AppError::Mods("verrou des instances empoisonné".into()))?;
        let runtime = instances
            .get(&key)
            .ok_or_else(|| AppError::Mods("runtime de mod introuvable".into()))?;
        runtime.dispatch(
            "ui.action",
            &json!({
                "panelId": panel_id,
                "actionId": action_id,
                "value": value,
            }),
        )
    }

    fn start_instance(
        &self,
        package: ModPackage,
        session: &GameSession,
    ) -> Result<(ModInstanceKey, ModRuntimeHandle), AppError> {
        let key = ModInstanceKey {
            mod_id: package.manifest.id.clone(),
            session_id: session.id.clone(),
        };
        self.starting_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des gameEntry en démarrage empoisonné".into()))?
            .insert(key.clone());
        let runtime = ModRuntimeHandle::start(
            package,
            &session.id,
            &session.account_id,
            Arc::clone(&self.logs),
            Arc::clone(&self.ui),
            Arc::clone(&self.commands),
            Arc::clone(&self.game),
            Arc::clone(&self.data),
            Arc::clone(&self.settings),
            Arc::clone(&self.secrets),
            Arc::clone(&self.http),
            self.platform.clone(),
            Arc::clone(&self.group),
        );
        let runtime = match runtime {
            Ok(runtime) => runtime,
            Err(error) => {
                self.discard_starting_game_side(&key);
                return Err(error);
            }
        };
        if let Err(error) = runtime.dispatch(
            "session.ready",
            &json!({
                "sessionId": session.id,
                "accountId": session.account_id,
            }),
        ) {
            self.discard_starting_game_side(&key);
            return Err(error);
        }
        Ok((key, runtime))
    }

    fn flush_pending_game_side(&self, key: &ModInstanceKey) -> Result<(), AppError> {
        self.clear_starting_game_side(key);
        let messages = self
            .pending_game_side
            .lock()
            .map_err(|_| AppError::Mods("verrou des messages gameEntry empoisonné".into()))?
            .remove(key)
            .unwrap_or_default();
        for (event, payload) in messages {
            self.dispatch_game_side(&key.session_id, &key.mod_id, &event, &payload)?;
        }
        Ok(())
    }

    fn clear_starting_game_side(&self, key: &ModInstanceKey) {
        if let Ok(mut starting) = self.starting_game_side.lock() {
            starting.remove(key);
        }
    }

    fn discard_starting_game_side(&self, key: &ModInstanceKey) {
        self.clear_starting_game_side(key);
        if let Ok(mut pending) = self.pending_game_side.lock() {
            pending.remove(key);
        }
    }
}

impl Drop for ModSupervisor {
    fn drop(&mut self) {
        if let Ok(mut instances) = self.instances.lock() {
            let runtimes = instances
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>();
            drop(instances);
            for runtime in runtimes {
                runtime.stop();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        mods::{game::ModGameCommand, manifest::ModManifest},
        sessions::GameSessionStatus,
    };
    use chrono::Utc;
    use std::{fs, path::Path};

    struct AvailableGameControl;

    impl ModGameControl for AvailableGameControl {
        fn execute(
            &self,
            _mod_id: &str,
            _session_id: &str,
            _command: ModGameCommand,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn install_game_entry(
            &self,
            _mod_id: &str,
            _session_id: &str,
            _source: &str,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn send_game_entry_message(
            &self,
            _mod_id: &str,
            _session_id: &str,
            _event: &str,
            _payload: &str,
        ) -> Result<(), AppError> {
            Ok(())
        }
    }

    fn install_test_mod(root: &Path) {
        let package = root.join("packages/dev.twelia.test");
        fs::create_dir_all(package.join("dist")).unwrap();
        fs::write(
            package.join("dist/main.js"),
            "twelia.on('session.ready', () => twelia.log.info('ready'));",
        )
        .unwrap();
        fs::write(
            package.join("manifest.json"),
            serde_json::to_vec(&ModManifest {
                schema_version: 1,
                id: "dev.twelia.test".into(),
                name: "Test".into(),
                version: "1.0.0".into(),
                api_version: 1,
                entry: "dist/main.js".into(),
                game_entry: None,
                network: Vec::new(),
                capabilities: Vec::new(),
                settings: std::collections::BTreeMap::new(),
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

    fn session(id: &str, account_id: &str) -> GameSession {
        GameSession {
            id: id.into(),
            account_id: account_id.into(),
            runtime_directory: PathBuf::new(),
            status: GameSessionStatus::Running,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            error: None,
        }
    }

    #[test]
    fn creates_one_isolated_runtime_per_session_when_mods_are_globally_enabled() {
        let root = tempfile::tempdir().unwrap();
        install_test_mod(root.path());
        let supervisor = ModSupervisor::new(root.path().to_path_buf()).unwrap();
        supervisor.set_globally_enabled(true).unwrap();

        supervisor
            .reconcile_session(&session("session-a", "account-a"))
            .unwrap();
        supervisor
            .reconcile_session(&session("session-b", "account-b"))
            .unwrap();
        let snapshots = supervisor.snapshots().unwrap();
        assert_eq!(snapshots.len(), 2);
        assert_ne!(snapshots[0].session_id, snapshots[1].session_id);

        supervisor.stop_session("session-a").unwrap();
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);
    }

    #[test]
    fn global_disable_stops_every_runtime() {
        let root = tempfile::tempdir().unwrap();
        install_test_mod(root.path());
        let supervisor = ModSupervisor::new(root.path().to_path_buf()).unwrap();
        supervisor.set_globally_enabled(true).unwrap();
        supervisor
            .reconcile_session(&session("session-a", "account-a"))
            .unwrap();
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);

        supervisor.set_globally_enabled(false).unwrap();
        assert!(supervisor.snapshots().unwrap().is_empty());
    }

    #[test]
    fn individual_activation_controls_automatic_runtimes() {
        let root = tempfile::tempdir().unwrap();
        install_test_mod(root.path());
        let supervisor = ModSupervisor::new(root.path().to_path_buf()).unwrap();
        supervisor.set_globally_enabled(true).unwrap();
        supervisor
            .set_mod_enabled("dev.twelia.test", false)
            .unwrap();

        supervisor
            .reconcile_session(&session("session-a", "account-a"))
            .unwrap();
        assert!(supervisor.snapshots().unwrap().is_empty());

        supervisor.set_mod_enabled("dev.twelia.test", true).unwrap();
        supervisor
            .reconcile_session(&session("session-a", "account-a"))
            .unwrap();
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);
    }

    #[test]
    fn manually_loads_and_unloads_a_disabled_mod_for_one_session() {
        let root = tempfile::tempdir().unwrap();
        install_test_mod(root.path());
        let supervisor = ModSupervisor::new(root.path().to_path_buf()).unwrap();
        supervisor.set_globally_enabled(true).unwrap();
        supervisor
            .set_mod_enabled("dev.twelia.test", false)
            .unwrap();
        let game_session = session("session-a", "account-a");

        let snapshot = supervisor
            .load_mod(&game_session, "dev.twelia.test")
            .unwrap();
        assert_eq!(snapshot.mod_id, "dev.twelia.test");
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);

        supervisor.reconcile_session(&game_session).unwrap();
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);

        supervisor
            .unload_mod("session-a", "dev.twelia.test")
            .unwrap();
        assert!(supervisor.snapshots().unwrap().is_empty());

        supervisor.reconcile_session(&game_session).unwrap();
        assert!(supervisor.snapshots().unwrap().is_empty());
    }

    #[test]
    fn manual_unload_overrides_automatic_activation_until_session_stops() {
        let root = tempfile::tempdir().unwrap();
        install_test_mod(root.path());
        let supervisor = ModSupervisor::new(root.path().to_path_buf()).unwrap();
        supervisor.set_globally_enabled(true).unwrap();
        let game_session = session("session-a", "account-a");
        supervisor.reconcile_session(&game_session).unwrap();

        supervisor
            .unload_mod("session-a", "dev.twelia.test")
            .unwrap();
        supervisor.reconcile_session(&game_session).unwrap();
        assert!(supervisor.snapshots().unwrap().is_empty());

        supervisor.stop_session("session-a").unwrap();
        supervisor.reconcile_session(&game_session).unwrap();
        assert_eq!(supervisor.snapshots().unwrap().len(), 1);
    }

    #[test]
    fn generated_project_runs_without_profile_activation() {
        let root = tempfile::tempdir().unwrap();
        let supervisor = ModSupervisor::with_game_control(
            root.path().to_path_buf(),
            Arc::new(AvailableGameControl),
        )
        .unwrap();
        let installed = supervisor.create_project("Mod de base").unwrap();
        supervisor.set_globally_enabled(true).unwrap();

        supervisor
            .reconcile_session(&session("session-a", "account-a"))
            .unwrap();

        let snapshots = supervisor.snapshots().unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].mod_id, installed.manifest.id);
        assert!(
            supervisor
                .logs(Some("session-a"))
                .iter()
                .any(|entry| entry.message.contains("Mod de base chargé"))
        );
    }
}
