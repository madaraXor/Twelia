use crate::{
    distribution::directory_size, secure_storage::SecureSessionStore, sessions::GameSession,
    storage::AppPaths,
};
use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnostic {
    pub twelia_version: &'static str,
    pub platform: &'static str,
    pub architecture: &'static str,
    pub system_version: Option<String>,
    pub tauri_version: &'static str,
    pub webview_version: Option<String>,
    pub paths: AppPaths,
    pub memory_bytes: Option<u64>,
    pub sessions: Vec<GameSession>,
    pub secure_store_status: &'static str,
    pub client_bytes: u64,
}

pub fn collect(
    paths: AppPaths,
    sessions: Vec<GameSession>,
    secure_store: &dyn SecureSessionStore,
) -> SystemDiagnostic {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let pid = Pid::from_u32(std::process::id());
    SystemDiagnostic {
        twelia_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        system_version: System::long_os_version(),
        tauri_version: tauri::VERSION,
        webview_version: None,
        memory_bytes: system.process(pid).map(|process| process.memory()),
        client_bytes: directory_size(&paths.client),
        paths,
        sessions,
        secure_store_status: secure_store.status(),
    }
}
