mod catalog;
mod commands;
mod data;
mod game;
mod http;
mod logs;
pub mod manifest;
#[cfg(not(test))]
mod platform;
#[cfg(test)]
mod platform {
    use super::manifest::ModManifest;
    use crate::error::AppError;
    use serde_json::Value;
    use tauri::AppHandle;

    pub struct ModPlatformServices;

    impl ModPlatformServices {
        pub fn new(_app: AppHandle) -> Self {
            Self
        }

        pub fn execute(
            &self,
            _manifest: &ModManifest,
            _mod_id: &str,
            _session_id: &str,
            _service: &str,
            _payload: &str,
        ) -> Result<Value, AppError> {
            Err(AppError::Mods(
                "services de plateforme indisponibles dans les tests".into(),
            ))
        }

        pub fn complete_file_dialog(
            &self,
            _request_id: &str,
            _path: Option<String>,
        ) -> Result<(), AppError> {
            Err(AppError::Mods(
                "services de plateforme indisponibles dans les tests".into(),
            ))
        }
    }
}
mod runtime;
mod secrets;
mod settings;
mod supervisor;
mod ui;

pub use catalog::InstalledMod;
pub use commands::ModCommandSnapshot;
#[cfg(desktop)]
pub use game::{mod_game_side_ready_sequence, parse_mod_game_event, parse_mod_game_side_event};
pub use logs::ModLogEntry;
pub use runtime::ModInstanceSnapshot;
pub use supervisor::ModSupervisor;
pub use ui::ModUiPanelSnapshot;
