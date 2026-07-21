mod commands;
mod diagnostics;
mod distribution;
mod error;
mod game_server;
mod mods;
mod redaction;
mod secure_storage;
mod sessions;
mod storage;

use redaction::{DefaultRedactor, SensitiveDataRedactor};
use secure_storage::{SecureSessionStore, SystemSecureSessionStore};
use sessions::SessionManager;
use std::sync::{Arc, atomic::AtomicBool};
use storage::StorageService;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

pub struct AppState {
    storage: StorageService,
    secure_store: Arc<dyn SecureSessionStore>,
    sessions: SessionManager,
    mods: mods::ModSupervisor,
    redactor: Arc<dyn SensitiveDataRedactor>,
    game_server: game_server::GameServer,
    client_installing: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("twelia".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .max_file_size(5_000_000)
                .build(),
        )
        .setup(|app| {
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let storage = StorageService::new(root).map_err(|error| error.to_string())?;
            let paths = storage.paths();
            let game_server = game_server::GameServer::start(paths.client_runtime.clone())
                .map_err(|error| error.to_string())?;
            let mods = mods::ModSupervisor::with_app(paths.mods.clone(), app.handle().clone())
                .map_err(|error| error.to_string())?;
            let redactor: Arc<dyn SensitiveDataRedactor> = Arc::new(DefaultRedactor);
            log::info!(
                "{}",
                redactor.redact_log_message("Twelia backend initialized")
            );
            app.manage(AppState {
                storage,
                secure_store: Arc::new(SystemSecureSessionStore),
                sessions: SessionManager::default(),
                mods,
                redactor,
                game_server,
                client_installing: AtomicBool::new(false),
            });
            match distribution::installer::ensure_runtime_compatibility(&paths) {
                Ok(true) => log::info!("couche de compatibilité du jeu mise à niveau"),
                Ok(false) => {}
                Err(error) => log::warn!("mise à niveau de la compatibilité impossible: {error}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::save_state,
            commands::list_installed_mods,
            commands::create_mod_project,
            commands::open_mod_entry,
            commands::open_mod_game_entry,
            commands::get_mods_enabled,
            commands::set_mods_enabled,
            commands::set_mod_enabled,
            commands::get_mod_settings,
            commands::set_mod_setting,
            commands::reset_mod_settings,
            commands::complete_mod_file_dialog,
            commands::load_mod_instance,
            commands::unload_mod_instance,
            commands::reload_mod_instance,
            commands::reload_mod_instances,
            commands::list_mod_instances,
            commands::list_mod_logs,
            commands::clear_mod_logs,
            commands::list_mod_commands,
            commands::dispatch_mod_command,
            commands::list_mod_ui_panels,
            commands::dispatch_mod_ui_action,
            commands::create_game_session,
            commands::start_game_session,
            commands::get_game_session_url,
            commands::open_external_auth_url,
            commands::layout_game_session,
            commands::set_game_session_visibility,
            commands::set_game_session_muted,
            commands::configure_game_shortcuts,
            commands::suspend_game_session,
            commands::keep_game_session_active,
            commands::resume_game_session,
            commands::reload_game_session,
            commands::stop_game_session,
            commands::destroy_game_session,
            commands::save_secure_session,
            commands::get_secure_session_status,
            commands::delete_secure_session,
            commands::delete_account_data,
            commands::get_client_status,
            commands::install_game_client,
            commands::verify_client_integrity,
            commands::list_modified_client_files,
            commands::get_system_diagnostic,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Twelia");
}
