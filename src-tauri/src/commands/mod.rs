use crate::{
    AppState, diagnostics,
    distribution::{
        ClientIntegrityService, FileIntegrity, FileSystemIntegrityService, IntegrityReport,
        directory_size,
        installer::{InstallOutcome, InstallProgress, install_client},
    },
    error::{AppError, CommandResult},
    mods::{
        InstalledMod, ModCommandSnapshot, ModInstanceSnapshot, ModLogEntry, ModUiPanelSnapshot,
    },
    secure_storage::StoredSession,
    sessions::{GameSession, GameSessionStatus, GameViewBounds},
};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn load_state(document: String, state: State<'_, AppState>) -> CommandResult<Option<Value>> {
    state.storage.load_state(&document).map_err(Into::into)
}

#[tauri::command]
pub fn save_state(document: String, value: Value, state: State<'_, AppState>) -> CommandResult<()> {
    state
        .storage
        .save_state(&document, &value)
        .map_err(Into::into)
}

#[tauri::command]
pub fn create_game_session(
    account_id: String,
    state: State<'_, AppState>,
) -> CommandResult<GameSession> {
    state
        .sessions
        .create(&state.storage, &account_id)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .start(&app, &state.storage, &state.game_server, &session_id)?;
    let session = state.sessions.get(&session_id)?;
    match state.mods.reconcile_session(&session) {
        Ok(report) if !report.errors.is_empty() => {
            log::warn!(
                "{} mod(s) n'ont pas démarré pour la session {}",
                report.errors.len(),
                session_id
            );
        }
        Ok(_) => {}
        Err(error) => log::warn!("supervision des mods indisponible: {error}"),
    }
    Ok(())
}

#[tauri::command]
pub fn list_installed_mods(state: State<'_, AppState>) -> CommandResult<Vec<InstalledMod>> {
    state.mods.list_installed().map_err(Into::into)
}

#[tauri::command]
pub fn create_mod_project(name: String, state: State<'_, AppState>) -> CommandResult<InstalledMod> {
    let installed = state.mods.create_project(&name)?;
    if state.mods.globally_enabled()? {
        for session in state.sessions.list().into_iter().filter(|session| {
            matches!(
                session.status,
                GameSessionStatus::Running
                    | GameSessionStatus::Background
                    | GameSessionStatus::Suspended
            )
        }) {
            if let Err(error) = state.mods.reconcile_session(&session) {
                log::warn!(
                    "nouveau mod non démarré pour la session {}: {error}",
                    session.id
                );
            }
        }
    }
    Ok(installed)
}

#[tauri::command]
pub fn open_mod_entry(
    mod_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let path = state.mods.project_entry(&mod_id)?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::Platform(format!("ouverture du mod impossible: {error}")).into())
}

#[tauri::command]
pub fn open_mod_game_entry(
    mod_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let path = state.mods.project_game_entry(&mod_id)?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::Platform(format!("ouverture du mod impossible: {error}")).into())
}

#[tauri::command]
pub fn get_mods_enabled(state: State<'_, AppState>) -> CommandResult<bool> {
    state.mods.globally_enabled().map_err(Into::into)
}

#[tauri::command]
pub fn set_mods_enabled(enabled: bool, state: State<'_, AppState>) -> CommandResult<()> {
    state.mods.set_globally_enabled(enabled)?;
    if enabled {
        for session in state.sessions.list().into_iter().filter(|session| {
            matches!(
                session.status,
                GameSessionStatus::Running
                    | GameSessionStatus::Background
                    | GameSessionStatus::Suspended
            )
        }) {
            if let Err(error) = state.mods.reconcile_session(&session) {
                log::warn!(
                    "activation globale des mods non appliquée à la session {}: {error}",
                    session.id
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_mod_enabled(
    mod_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.mods.set_mod_enabled(&mod_id, enabled)?;
    if state.mods.globally_enabled()? {
        for session in state.sessions.list().into_iter().filter(|session| {
            matches!(
                session.status,
                GameSessionStatus::Running
                    | GameSessionStatus::Background
                    | GameSessionStatus::Suspended
            )
        }) {
            if let Err(error) = state.mods.reconcile_session(&session) {
                log::warn!(
                    "activation du mod {mod_id} non appliquée à la session {}: {error}",
                    session.id
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_mod_settings(mod_id: String, state: State<'_, AppState>) -> CommandResult<Value> {
    state.mods.mod_settings(&mod_id).map_err(Into::into)
}

#[tauri::command]
pub fn set_mod_setting(
    mod_id: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> CommandResult<Value> {
    state
        .mods
        .set_mod_setting(&mod_id, &key, value)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reset_mod_settings(mod_id: String, state: State<'_, AppState>) -> CommandResult<Value> {
    state.mods.reset_mod_settings(&mod_id).map_err(Into::into)
}

#[tauri::command]
pub fn complete_mod_file_dialog(
    request_id: String,
    path: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .mods
        .complete_file_dialog(&request_id, path)
        .map_err(Into::into)
}

#[tauri::command]
pub fn load_mod_instance(
    session_id: String,
    mod_id: String,
    state: State<'_, AppState>,
) -> CommandResult<ModInstanceSnapshot> {
    let session = state.sessions.get(&session_id)?;
    if !matches!(
        session.status,
        GameSessionStatus::Running | GameSessionStatus::Background | GameSessionStatus::Suspended
    ) {
        return Err(AppError::Mods(format!("la session {session_id} n’est pas active")).into());
    }
    state.mods.load_mod(&session, &mod_id).map_err(Into::into)
}

#[tauri::command]
pub fn unload_mod_instance(
    session_id: String,
    mod_id: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.get(&session_id)?;
    state
        .mods
        .unload_mod(&session_id, &mod_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reload_mod_instance(
    session_id: String,
    mod_id: String,
    state: State<'_, AppState>,
) -> CommandResult<ModInstanceSnapshot> {
    let session = state.sessions.get(&session_id)?;
    state.mods.unload_mod(&session_id, &mod_id)?;
    state.mods.load_mod(&session, &mod_id).map_err(Into::into)
}

#[tauri::command]
pub fn reload_mod_instances(
    mod_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ModInstanceSnapshot>> {
    let session_ids = state
        .mods
        .snapshots()?
        .into_iter()
        .filter(|snapshot| snapshot.mod_id == mod_id)
        .map(|snapshot| snapshot.session_id)
        .collect::<Vec<_>>();
    let mut reloaded = Vec::new();
    for session_id in session_ids {
        let session = state.sessions.get(&session_id)?;
        state.mods.unload_mod(&session_id, &mod_id)?;
        reloaded.push(state.mods.load_mod(&session, &mod_id)?);
    }
    Ok(reloaded)
}

#[tauri::command]
pub fn list_mod_instances(state: State<'_, AppState>) -> CommandResult<Vec<ModInstanceSnapshot>> {
    state.mods.snapshots().map_err(Into::into)
}

#[tauri::command]
pub fn list_mod_logs(session_id: Option<String>, state: State<'_, AppState>) -> Vec<ModLogEntry> {
    state.mods.logs(session_id.as_deref())
}

#[tauri::command]
pub fn clear_mod_logs(session_id: Option<String>, state: State<'_, AppState>) {
    state.mods.clear_logs(session_id.as_deref());
}

#[tauri::command]
pub fn list_mod_commands(state: State<'_, AppState>) -> Vec<ModCommandSnapshot> {
    state.mods.commands()
}

#[tauri::command]
pub fn dispatch_mod_command(
    mod_id: String,
    session_id: String,
    command_id: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .mods
        .dispatch_command(&mod_id, &session_id, &command_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_mod_ui_panels(
    session_id: String,
    state: State<'_, AppState>,
) -> Vec<ModUiPanelSnapshot> {
    state.mods.ui_panels(&session_id)
}

#[tauri::command]
pub fn dispatch_mod_ui_action(
    session_id: String,
    mod_id: String,
    panel_id: String,
    action_id: String,
    value: Option<Value>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.get(&session_id)?;
    state
        .mods
        .dispatch_ui_action(&session_id, &mod_id, &panel_id, &action_id, value)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_game_session_url(
    session_id: String,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let session = state.sessions.get(&session_id)?;
    state
        .game_server
        .isolated_index_url(&session.account_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn open_external_auth_url(url: String, app: AppHandle) -> CommandResult<()> {
    let parsed = tauri::Url::parse(&url)
        .map_err(|_| AppError::InvalidInput("URL d’authentification invalide".into()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::InvalidInput(
            "seules les URL HTTPS peuvent être ouvertes pour l’authentification".into(),
        )
        .into());
    }
    log::info!(
        "OAuth mobile: ouverture du navigateur système ({})",
        parsed.host_str().unwrap_or("hôte inconnu")
    );
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| {
            AppError::Platform(format!(
                "impossible d’ouvrir le navigateur pour l’authentification: {error}"
            ))
            .into()
        })
}
#[tauri::command]
pub fn layout_game_session(
    session_id: String,
    bounds: GameViewBounds,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .layout(&app, &session_id, bounds)
        .map_err(Into::into)
}
#[tauri::command]
pub fn set_game_session_visibility(
    session_id: String,
    visible: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .set_visibility(&app, &session_id, visible)
        .map_err(Into::into)
}
#[tauri::command]
pub fn set_game_session_muted(
    session_id: String,
    muted: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .set_muted(&app, &session_id, muted)
        .map_err(Into::into)
}
#[tauri::command]
pub fn configure_game_shortcuts(
    session_id: String,
    accelerators: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .configure_shortcuts(&app, &session_id, &accelerators)
        .map_err(Into::into)
}
#[tauri::command]
pub fn suspend_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.suspend(&app, &session_id)?;
    let _ = state
        .mods
        .dispatch_session(&session_id, "session.suspended", &serde_json::json!({}));
    Ok(())
}
#[tauri::command]
pub fn keep_game_session_active(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .sessions
        .keep_active(&app, &session_id)
        .map_err(Into::into)
}
#[tauri::command]
pub fn resume_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.resume(&app, &session_id)?;
    let _ = state
        .mods
        .dispatch_session(&session_id, "session.resumed", &serde_json::json!({}));
    Ok(())
}
#[tauri::command]
pub fn reload_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.reload(&app, &session_id)?;
    let _ = state
        .mods
        .dispatch_session(&session_id, "session.reloaded", &serde_json::json!({}));
    Ok(())
}
#[tauri::command]
pub fn stop_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.mods.stop_session(&session_id)?;
    state.sessions.stop(&app, &session_id).map_err(Into::into)
}
#[tauri::command]
pub fn destroy_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.mods.stop_session(&session_id)?;
    state
        .sessions
        .destroy(&app, &session_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_secure_session(
    account_id: String,
    session: StoredSession,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state
        .secure_store
        .save_session(&account_id, &session)
        .map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecureSessionStatus {
    Missing,
    Valid,
    Expired,
}

#[tauri::command]
pub fn get_secure_session_status(
    account_id: String,
    state: State<'_, AppState>,
) -> CommandResult<SecureSessionStatus> {
    state
        .secure_store
        .load_session(&account_id)
        .map(|session| match session {
            None => SecureSessionStatus::Missing,
            Some(session) if session.is_expired() => SecureSessionStatus::Expired,
            Some(_) => SecureSessionStatus::Valid,
        })
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_secure_session(account_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state
        .secure_store
        .delete_session(&account_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_account_data(account_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.mods.clear_account(&account_id)?;
    state.secure_store.delete_session(&account_id)?;
    state
        .storage
        .delete_account_space(&account_id)
        .map_err(Into::into)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    installed: bool,
    version: Option<String>,
    path: String,
    used_bytes: u64,
    update_available: bool,
    integrity: &'static str,
}

#[tauri::command]
pub fn get_client_status(state: State<'_, AppState>) -> CommandResult<ClientStatus> {
    let paths = state.storage.paths();
    let path = paths.client;
    let runtime_ready = paths.client_runtime.join("index.html").is_file()
        && paths.client_runtime.join("versions.json").is_file();
    let service = FileSystemIntegrityService::new(path.clone());
    let manifest = service.load_manifest()?;
    let (version, integrity) = match manifest.as_ref() {
        None => (None, "unknown"),
        Some(manifest) => (
            Some(manifest.version.clone()),
            if service.verify_installation(manifest)?.valid && runtime_ready {
                "valid"
            } else {
                "issues"
            },
        ),
    };
    Ok(ClientStatus {
        installed: manifest.is_some() && runtime_ready,
        version,
        path: path.to_string_lossy().into_owned(),
        used_bytes: directory_size(&path),
        update_available: false,
        integrity,
    })
}

#[tauri::command]
pub async fn install_game_client(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<InstallOutcome> {
    if state.sessions.has_active() {
        return Err(AppError::Distribution(
            "fermez les fenêtres de jeu avant d’installer ou réparer le client".into(),
        )
        .into());
    }
    if state
        .client_installing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(
            AppError::Distribution("une installation du client est déjà en cours".into()).into(),
        );
    }

    let paths = state.storage.paths();
    let progress_app = app.clone();
    let operation = tauri::async_runtime::spawn_blocking(move || {
        install_client(paths, |progress: InstallProgress| {
            let _ = progress_app.emit("client-install-progress", progress);
        })
    })
    .await;
    state.client_installing.store(false, Ordering::Release);

    match operation {
        Ok(result) => result.map_err(Into::into),
        Err(error) => Err(AppError::Runtime(format!(
            "la tâche d’installation s’est interrompue: {error}"
        ))
        .into()),
    }
}

#[tauri::command]
pub fn verify_client_integrity(state: State<'_, AppState>) -> CommandResult<IntegrityReport> {
    let service = FileSystemIntegrityService::new(state.storage.paths().client);
    let manifest = service.load_manifest()?.ok_or_else(|| {
        AppError::Distribution("no local installed-client manifest is available".into())
    })?;
    service.verify_installation(&manifest).map_err(Into::into)
}

#[tauri::command]
pub fn list_modified_client_files(state: State<'_, AppState>) -> CommandResult<Vec<FileIntegrity>> {
    let service = FileSystemIntegrityService::new(state.storage.paths().client);
    let manifest = service.load_manifest()?.ok_or_else(|| {
        AppError::Distribution("no local installed-client manifest is available".into())
    })?;
    service.list_modified_files(&manifest).map_err(Into::into)
}

#[tauri::command]
pub fn get_system_diagnostic(state: State<'_, AppState>) -> CommandResult<Value> {
    let report = serde_json::to_value(diagnostics::collect(
        state.storage.paths(),
        state.sessions.list(),
        state.secure_store.as_ref(),
    ))
    .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(state.redactor.sanitize_diagnostic_report(report))
}
