#[cfg(desktop)]
use crate::distribution::installer::RuntimeVersions;
#[cfg(desktop)]
use crate::{
    AppState,
    mods::{mod_game_side_ready_sequence, parse_mod_game_event, parse_mod_game_side_event},
};
use crate::{error::AppError, game_server::GameServer, storage::StorageService};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
#[cfg(desktop)]
use std::{
    fs,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    webview::{NewWindowResponse, WebviewBuilder},
};
use uuid::Uuid;
#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
#[cfg(target_os = "windows")]
use windows_core::Interface;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GameSessionStatus {
    Created,
    Starting,
    Authenticating,
    Running,
    Background,
    Suspended,
    Disconnected,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSession {
    pub id: String,
    pub account_id: String,
    pub runtime_directory: PathBuf,
    pub status: GameSessionStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(mobile, allow(dead_code))]
pub struct GameViewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, GameSession>>,
    #[cfg(desktop)]
    start_lock: Mutex<()>,
}

impl SessionManager {
    pub fn create(
        &self,
        storage: &StorageService,
        account_id: &str,
    ) -> Result<GameSession, AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Runtime("session lock poisoned".into()))?;
        if let Some(existing) = sessions.values().find(|session| {
            session.account_id == account_id && session.status != GameSessionStatus::Stopped
        }) {
            return Ok(existing.clone());
        }
        let now = Utc::now();
        let session = GameSession {
            id: Uuid::new_v4().to_string(),
            account_id: account_id.to_string(),
            runtime_directory: storage.account_runtime_dir(account_id)?,
            status: GameSessionStatus::Created,
            created_at: now,
            updated_at: now,
            error: None,
        };
        sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    #[cfg(desktop)]
    pub fn start(
        &self,
        app: &AppHandle,
        storage: &StorageService,
        server: &GameServer,
        session_id: &str,
    ) -> Result<(), AppError> {
        let _start_guard = self
            .start_lock
            .lock()
            .map_err(|_| AppError::Runtime("verrou de démarrage empoisonné".into()))?;
        let session = self.get(session_id)?;
        let label = webview_label(session_id);
        if let Some(webview) = app.get_webview(&label) {
            webview.show().map_err(runtime_platform)?;
            webview.set_focus().map_err(runtime_platform)?;
            self.update(session_id, GameSessionStatus::Running, None)?;
            return Ok(());
        }

        self.update(session_id, GameSessionStatus::Starting, None)?;
        let paths = storage.paths();
        let index = paths.client_runtime.join("index.html");
        let versions_path = paths.client_runtime.join("versions.json");
        if !index.is_file() || !versions_path.is_file() {
            return self.start_failed(
                session_id,
                "Le client n’est pas installé. Ouvrez Paramètres > Client puis lancez l’installation.",
            );
        }
        let versions: RuntimeVersions = serde_json::from_slice(
            &fs::read(&versions_path).map_err(runtime_io)?,
        )
        .map_err(|error| AppError::Runtime(format!("versions du runtime invalides: {error}")))?;
        let data_directory = session.runtime_directory.join("webview");
        fs::create_dir_all(&data_directory).map_err(runtime_io)?;
        let url = server
            .index_url()
            .parse()
            .map_err(|error| AppError::Runtime(format!("URL du runtime invalide: {error}")))?;
        let user_agent = format!(
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 DofusTouch Client {}",
            versions.app_version
        );
        let oauth_app = app.clone();
        let oauth_game_label = label.clone();
        let attention_app = app.clone();
        let attention_session_id = session_id.to_owned();
        let mod_event_app = app.clone();
        let mod_event_session_id = session_id.to_owned();
        let mod_game_side_sequences = Arc::new(Mutex::new(HashMap::<(String, u64), u64>::new()));
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .user_agent(&user_agent)
            .data_directory(data_directory)
            .initialization_script(GAME_EVENT_BRIDGE_SCRIPT)
            .on_document_title_changed(move |webview, title| {
                if mod_game_side_ready_sequence(&title).is_some() {
                    if let Ok(mut sequences) = mod_game_side_sequences.lock() {
                        sequences.clear();
                    }
                    if let Some(state) = mod_event_app.try_state::<AppState>()
                        && let Err(error) = state
                            .mods
                            .reload_game_entries(&mod_event_session_id)
                    {
                        log::warn!("gameEntry non réinjectés après navigation: {error}");
                    }
                } else if let Some(message) = parse_mod_game_side_event(&title) {
                    let should_dispatch = mod_game_side_sequences
                        .lock()
                        .map(|mut sequences| {
                            let key = (message.mod_id.clone(), message.channel_id);
                            if sequences
                                .get(&key)
                                .is_some_and(|sequence| *sequence >= message.sequence)
                            {
                                false
                            } else {
                                sequences.insert(key, message.sequence);
                                true
                            }
                        })
                        .unwrap_or(true);
                    if should_dispatch
                        && let Some(state) = mod_event_app.try_state::<AppState>()
                        && let Err(error) = state.mods.dispatch_game_side(
                            &mod_event_session_id,
                            &message.mod_id,
                            &message.event,
                            &message.payload,
                        )
                    {
                        log::warn!("message gameEntry de {} non transmis: {error}", message.mod_id);
                    }
                    let _ = webview.eval(format!(
                        "window.__TWELIA_MOD_CONTENT_BRIDGE__?.ack({});",
                        message.sequence
                    ));
                } else if let Some((event, payload)) = parse_mod_game_event(&title) {
                    if let Some(state) = mod_event_app.try_state::<AppState>()
                        && let Err(error) = state.mods.dispatch_session(
                            &mod_event_session_id,
                            &event,
                            &payload,
                        )
                    {
                        log::warn!("événement de jeu non transmis aux mods: {error}");
                    }
                } else if let Some(kind) = game_attention_kind(&title) {
                    let payload = serde_json::json!({
                        "sessionId": attention_session_id,
                        "kind": kind,
                    });
                    if let Err(error) = attention_app.emit_to("main", "game-attention", payload) {
                        log::warn!("signal d’attention du jeu non transmis: {error}");
                    }
                } else if let Some(accelerator) = game_shortcut_accelerator(&title)
                    && let Err(error) = attention_app.emit_to("main", "game-shortcut", accelerator)
                {
                    log::warn!("raccourci du jeu non transmis: {error}");
                }
            })
            .on_navigation(|url| matches!(url.scheme(), "http" | "https" | "about" | "data"))
            .on_new_window(move |url, features| {
                if !matches!(url.scheme(), "http" | "https") {
                    return NewWindowResponse::Deny;
                }
                log::info!(
                    "OAuth: ouverture d'Ankama Connect pour {} ({})",
                    oauth_game_label,
                    url.host_str().unwrap_or("hôte inconnu")
                );
                let auth_label = format!("auth-{}", Uuid::new_v4());
                let callback_app = oauth_app.clone();
                let callback_auth_label = auth_label.clone();
                let callback_game_label = oauth_game_label.clone();
                let callback_consumed = Arc::new(AtomicBool::new(false));
                let builder = WebviewWindowBuilder::new(
                    &oauth_app,
                    auth_label,
                    WebviewUrl::External("about:blank".parse().expect("valid about URL")),
                )
                .title("Ankama Connect")
                .inner_size(980.0, 720.0)
                .min_inner_size(640.0, 520.0)
                .resizable(true)
                .window_features(features)
                .on_navigation(move |url| {
                    log::debug!(
                        "OAuth: navigation {}://{}",
                        url.scheme(),
                        url.host_str().unwrap_or("sans-hôte")
                    );
                    if url.scheme() == "dofustouch" && url.host_str() == Some("authorized") {
                        let outcome = url
                            .query_pairs()
                            .find(|(key, value)| {
                                matches!(key.as_ref(), "code" | "error") && !value.is_empty()
                            });
                        let Some((key, value)) = outcome else {
                            log::warn!("OAuth: retour Ankama sans résultat exploitable");
                            return false;
                        };
                        if callback_consumed.swap(true, Ordering::SeqCst) {
                            log::warn!("OAuth: retour dupliqué ignoré");
                            return false;
                        }
                        let outcome_name = key.as_ref().to_owned();
                        log::info!("OAuth: retour Ankama intercepté ({outcome_name})");
                        let payload = serde_json::json!({
                            key.into_owned(): value.into_owned()
                        });
                        if let Some(game) = callback_app.get_webview(&callback_game_label) {
                            let script = format!(
                                "if(window.__TWELIA_OAUTH_CALLBACK__){{window.__TWELIA_OAUTH_CALLBACK__({payload});}}"
                            );
                            match game.eval(script) {
                                Ok(()) => log::info!("OAuth: résultat transmis au jeu"),
                                Err(error) => {
                                    log::error!("OAuth: transmission au jeu impossible: {error}")
                                }
                            }
                        } else {
                            log::error!("OAuth: WebView du jeu introuvable au retour Ankama");
                        }
                        let close_app = callback_app.clone();
                        let close_label = callback_auth_label.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(250));
                            if let Some(window) = close_app.get_webview_window(&close_label)
                                && let Err(error) = window.close()
                            {
                                log::warn!("OAuth: fermeture d'Ankama Connect impossible: {error}");
                            }
                        });
                        return false;
                    }
                    matches!(url.scheme(), "http" | "https" | "about" | "data")
                })
                .on_document_title_changed(|window, title| {
                    let _ = window.set_title(&title);
                });
                match builder.build() {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(error) => {
                        log::error!("impossible d’ouvrir Ankama Connect: {error}");
                        NewWindowResponse::Deny
                    }
                }
            });
        #[cfg(target_os = "windows")]
        let builder = builder.additional_browser_args(
            "--disable-web-security --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        );
        let main_window = app
            .get_window("main")
            .ok_or_else(|| AppError::Runtime("fenêtre principale introuvable".into()))?;
        let scale_factor = main_window.scale_factor().map_err(runtime_platform)?;
        let inner_size = main_window.inner_size().map_err(runtime_platform)?;
        let initial_size = LogicalSize::new(
            (f64::from(inner_size.width) / scale_factor).max(1.0),
            (f64::from(inner_size.height) / scale_factor).max(1.0),
        );
        let initial_position = LogicalPosition::new(-initial_size.width, -initial_size.height);
        let webview = match main_window.add_child(builder, initial_position, initial_size) {
            Ok(webview) => webview,
            Err(error) => {
                return self.start_failed(
                    session_id,
                    &format!("Impossible d’intégrer la vue du jeu: {error}"),
                );
            }
        };
        webview.hide().map_err(runtime_platform)?;
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(desktop)]
    pub fn layout(
        &self,
        app: &AppHandle,
        session_id: &str,
        bounds: GameViewBounds,
    ) -> Result<(), AppError> {
        if !bounds.x.is_finite()
            || !bounds.y.is_finite()
            || !bounds.width.is_finite()
            || !bounds.height.is_finite()
            || bounds.width < 1.0
            || bounds.height < 1.0
        {
            return Err(AppError::Runtime(
                "dimensions de la vue du jeu invalides".into(),
            ));
        }
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(runtime_platform)?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(runtime_platform)?;
        let _ = webview.eval(
            "window.dispatchEvent(new Event('resize'));window.setTimeout(function(){if(window.gui&&typeof window.gui.forceResizeToolbar==='function'){window.gui.forceResizeToolbar();}},50);",
        );
        webview.show().map_err(runtime_platform)
    }

    #[cfg(desktop)]
    pub fn suspend(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        if let Some(webview) = app.get_webview(&webview_label(session_id)) {
            webview.hide().map_err(runtime_platform)?;
        }
        self.update(session_id, GameSessionStatus::Suspended, None)
    }

    #[cfg(desktop)]
    pub fn keep_active(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        let current = self.get(session_id)?;
        if current.status == GameSessionStatus::Error {
            return Err(AppError::Runtime(
                "impossible d’activer une session en erreur".into(),
            ));
        }
        app.get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(desktop)]
    pub fn set_visibility(
        &self,
        app: &AppHandle,
        session_id: &str,
        visible: bool,
    ) -> Result<(), AppError> {
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        if visible {
            webview.show().map_err(runtime_platform)
        } else {
            // Keep the WebView rendered so WebView2 does not freeze timers and network events.
            // The Chromium background-throttling flags above keep this off-screen view active.
            webview
                .set_position(LogicalPosition::new(-32_768.0, -32_768.0))
                .map_err(runtime_platform)?;
            webview.show().map_err(runtime_platform)
        }
    }

    #[cfg(desktop)]
    pub fn set_muted(
        &self,
        app: &AppHandle,
        session_id: &str,
        muted: bool,
    ) -> Result<(), AppError> {
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;

        #[cfg(target_os = "windows")]
        webview
            .with_webview(move |platform_webview| {
                let result = unsafe {
                    platform_webview
                        .controller()
                        .CoreWebView2()
                        .and_then(|core| core.cast::<ICoreWebView2_8>())
                        .and_then(|audio| audio.SetIsMuted(muted))
                };
                if let Err(error) = result {
                    log::warn!("impossible de régler le son natif de la vue du jeu: {error}");
                }
            })
            .map_err(runtime_platform)?;

        webview
            .eval(format!(
                "if(typeof window.__TWELIA_SET_MUTED__==='function'){{window.__TWELIA_SET_MUTED__({muted});}}"
            ))
            .map_err(runtime_platform)
    }

    #[cfg(desktop)]
    pub fn configure_shortcuts(
        &self,
        app: &AppHandle,
        session_id: &str,
        accelerators: &[String],
    ) -> Result<(), AppError> {
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        let payload = serde_json::to_string(accelerators)
            .map_err(|error| AppError::Runtime(format!("raccourcis invalides: {error}")))?;
        webview
            .eval(format!("window.__TWELIA_SHORTCUTS__={payload};"))
            .map_err(runtime_platform)
    }

    #[cfg(desktop)]
    pub fn resume(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        let current = self.get(session_id)?;
        if current.status == GameSessionStatus::Error {
            return Err(AppError::Runtime(
                "impossible de reprendre une session en erreur".into(),
            ));
        }
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        webview.show().map_err(runtime_platform)?;
        webview.set_focus().map_err(runtime_platform)?;
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(desktop)]
    pub fn reload(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        let webview = app
            .get_webview(&webview_label(session_id))
            .ok_or_else(|| AppError::Runtime("vue du jeu introuvable".into()))?;
        self.update(session_id, GameSessionStatus::Starting, None)?;
        webview.reload().map_err(runtime_platform)?;
        webview.show().map_err(runtime_platform)?;
        webview.set_focus().map_err(runtime_platform)?;
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(desktop)]
    pub fn stop(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        if let Some(webview) = app.get_webview(&webview_label(session_id)) {
            webview.close().map_err(runtime_platform)?;
        }
        self.update(session_id, GameSessionStatus::Stopped, None)
    }

    #[cfg(desktop)]
    pub fn destroy(&self, app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        if let Some(webview) = app.get_webview(&webview_label(session_id)) {
            webview.close().map_err(runtime_platform)?;
        }
        self.sessions
            .lock()
            .map_err(|_| AppError::Runtime("session lock poisoned".into()))?
            .remove(session_id);
        Ok(())
    }

    #[cfg(mobile)]
    pub fn start(
        &self,
        _app: &AppHandle,
        storage: &StorageService,
        _server: &GameServer,
        session_id: &str,
    ) -> Result<(), AppError> {
        self.get(session_id)?;
        let runtime = storage.paths().client_runtime;
        if !runtime.join("index.html").is_file() || !runtime.join("versions.json").is_file() {
            let message = "Le client n’est pas installé. Ouvrez Paramètres > Client puis lancez l’installation.";
            self.update(
                session_id,
                GameSessionStatus::Error,
                Some(message.to_owned()),
            )?;
            return Err(AppError::Runtime(message.to_owned()));
        }
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(mobile)]
    pub fn layout(
        &self,
        _app: &AppHandle,
        session_id: &str,
        _bounds: GameViewBounds,
    ) -> Result<(), AppError> {
        self.get(session_id).map(|_| ())
    }

    #[cfg(mobile)]
    pub fn suspend(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.update(session_id, GameSessionStatus::Suspended, None)
    }

    #[cfg(mobile)]
    pub fn keep_active(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(mobile)]
    pub fn set_visibility(
        &self,
        _app: &AppHandle,
        session_id: &str,
        _visible: bool,
    ) -> Result<(), AppError> {
        self.get(session_id).map(|_| ())
    }

    #[cfg(mobile)]
    pub fn set_muted(
        &self,
        _app: &AppHandle,
        session_id: &str,
        _muted: bool,
    ) -> Result<(), AppError> {
        // Android sessions live in front-end iframes. GameTab forwards the same
        // mute state through the embedded host bridge without suspending the game.
        self.get(session_id).map(|_| ())
    }

    #[cfg(mobile)]
    pub fn configure_shortcuts(
        &self,
        _app: &AppHandle,
        session_id: &str,
        _accelerators: &[String],
    ) -> Result<(), AppError> {
        self.get(session_id).map(|_| ())
    }

    #[cfg(mobile)]
    pub fn resume(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.update(session_id, GameSessionStatus::Running, None)
    }

    #[cfg(mobile)]
    pub fn reload(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.get(session_id).map(|_| ())
    }

    #[cfg(mobile)]
    pub fn stop(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.update(session_id, GameSessionStatus::Stopped, None)
    }

    #[cfg(mobile)]
    pub fn destroy(&self, _app: &AppHandle, session_id: &str) -> Result<(), AppError> {
        self.sessions
            .lock()
            .map_err(|_| AppError::Runtime("session lock poisoned".into()))?
            .remove(session_id);
        Ok(())
    }

    pub fn list(&self) -> Vec<GameSession> {
        self.sessions
            .lock()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn has_active(&self) -> bool {
        self.sessions
            .lock()
            .map(|sessions| {
                sessions.values().any(|session| {
                    !matches!(
                        session.status,
                        GameSessionStatus::Stopped | GameSessionStatus::Error
                    )
                })
            })
            .unwrap_or(true)
    }

    pub(crate) fn get(&self, session_id: &str) -> Result<GameSession, AppError> {
        self.sessions
            .lock()
            .map_err(|_| AppError::Runtime("session lock poisoned".into()))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::Runtime("session not found".into()))
    }

    fn update(
        &self,
        session_id: &str,
        status: GameSessionStatus,
        error: Option<String>,
    ) -> Result<(), AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Runtime("session lock poisoned".into()))?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Runtime("session not found".into()))?;
        session.status = status;
        session.error = error;
        session.updated_at = Utc::now();
        Ok(())
    }

    #[cfg(desktop)]
    fn start_failed(&self, session_id: &str, message: &str) -> Result<(), AppError> {
        self.update(
            session_id,
            GameSessionStatus::Error,
            Some(message.to_owned()),
        )?;
        Err(AppError::Runtime(message.to_owned()))
    }
}

#[cfg(desktop)]
fn webview_label(session_id: &str) -> String {
    format!("game-{session_id}")
}

#[cfg(desktop)]
const GAME_EVENT_BRIDGE_SCRIPT: &str = include_str!("game_event_bridge.js");

#[cfg(any(desktop, test))]
fn game_attention_kind(title: &str) -> Option<&str> {
    let signal = title.strip_prefix("__TWELIA_ATTENTION__:")?;
    let (kind, rest) = signal.split_once(':')?;
    if rest.is_empty() {
        return None;
    }
    matches!(kind, "combat-turn" | "party-invitation" | "group-fight").then_some(kind)
}

#[cfg(any(desktop, test))]
fn game_shortcut_accelerator(title: &str) -> Option<&str> {
    let signal = title.strip_prefix("__TWELIA_SHORTCUT__:")?;
    let (accelerator, sequence) = signal.rsplit_once(':')?;
    if accelerator.is_empty()
        || accelerator.len() > 64
        || !sequence.chars().all(|character| character.is_ascii_digit())
        || !accelerator
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '+')
    {
        return None;
    }
    Some(accelerator)
}

#[cfg(desktop)]
fn runtime_io(error: std::io::Error) -> AppError {
    AppError::Runtime(error.to_string())
}

#[cfg(desktop)]
fn runtime_platform(error: tauri::Error) -> AppError {
    AppError::Runtime(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn does_not_open_same_account_twice() {
        let root = tempfile::tempdir().unwrap();
        let storage = StorageService::new(root.path().into()).unwrap();
        let manager = SessionManager::default();
        let first = manager.create(&storage, "account-a").unwrap();
        let second = manager.create(&storage, "account-a").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn accepts_only_known_game_attention_titles() {
        assert_eq!(
            game_attention_kind("__TWELIA_ATTENTION__:combat-turn:1"),
            Some("combat-turn")
        );
        assert_eq!(game_attention_kind("__TWELIA_ATTENTION__:unknown:1"), None);
        assert_eq!(game_attention_kind("DOFUS Touch"), None);
    }

    #[test]
    fn accepts_only_valid_game_shortcut_titles() {
        assert_eq!(
            game_shortcut_accelerator("__TWELIA_SHORTCUT__:Ctrl+Shift+Tab:12"),
            Some("Ctrl+Shift+Tab")
        );
        assert_eq!(
            game_shortcut_accelerator("__TWELIA_SHORTCUT__:Ctrl+W:not-a-number"),
            None
        );
        assert_eq!(game_shortcut_accelerator("__TWELIA_SHORTCUT__::1"), None);
    }

    #[test]
    fn audio_bridge_mutes_output_without_suspending_the_game() {
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("window.Howler.mute(true)"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("mediaMuteStates.get(media)"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("master.gain.value = muted ? 0 : 1"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("window.AudioNode.prototype.connect"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("window.AudioNode.prototype.disconnect"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("context.resume()"));
        assert!(!GAME_EVENT_BRIDGE_SCRIPT.contains("AudioContext.suspend"));
    }

    #[test]
    fn mod_bridge_exposes_only_atomic_fight_commands() {
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("possiblePlacements"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("reachableCells"));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("case \"setFightPlacement\""));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("case \"moveInFight\""));
        assert!(GAME_EVENT_BRIDGE_SCRIPT.contains("case \"castFightSpell\""));
        assert!(!GAME_EVENT_BRIDGE_SCRIPT.contains("nearest-enemy"));
        assert!(!GAME_EVENT_BRIDGE_SCRIPT.contains("lowest-life-enemy"));
    }
}
