use crate::{
    AppState, diagnostics,
    distribution::{
        ClientIntegrityService, FileIntegrity, FileSystemIntegrityService, IntegrityReport,
        directory_size,
        installer::{InstallOutcome, InstallProgress, install_client},
    },
    error::{AppError, CommandResult},
    secure_storage::StoredSession,
    sessions::{GameSession, GameViewBounds},
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
        .start(&app, &state.storage, &state.game_server, &session_id)
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
    state
        .sessions
        .suspend(&app, &session_id)
        .map_err(Into::into)
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
    state.sessions.resume(&app, &session_id).map_err(Into::into)
}
#[tauri::command]
pub fn reload_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.reload(&app, &session_id).map_err(Into::into)
}
#[tauri::command]
pub fn stop_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.sessions.stop(&app, &session_id).map_err(Into::into)
}
#[tauri::command]
pub fn destroy_game_session(
    session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
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
