use super::{InstalledClientFile, InstalledManifest, safe_relative_path};
use crate::{error::AppError, storage::AppPaths};
use chrono::Utc;
use regex::Regex;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::Path,
    thread,
    time::Duration,
};
use uuid::Uuid;

pub const GAME_ORIGIN: &str = "https://dt-proxy-production-login.ankama-games.com/";
const MANIFEST_URL: &str = "https://dt-proxy-production-login.ankama-games.com/manifest.json";
const ASSET_MAP_URL: &str = "https://dt-proxy-production-login.ankama-games.com/assetMap.json";
const PLAY_STORE_URL: &str =
    "https://play.google.com/store/apps/details?id=com.ankama.dofustouch&hl=fr&gl=FR";
const MAX_MANIFEST_SIZE: usize = 10 * 1024 * 1024;
const MAX_FILE_SIZE: u64 = 512 * 1024 * 1024;
pub const COMPATIBILITY_VERSION: u32 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompatibilityTarget {
    Desktop,
    Android,
}

fn compatibility_target() -> CompatibilityTarget {
    if cfg!(target_os = "android") {
        CompatibilityTarget::Android
    } else {
        CompatibilityTarget::Desktop
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: &'static str,
    pub message: String,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub version: String,
    pub build_version: String,
    pub app_version: String,
    pub downloaded_files: usize,
    pub downloaded_bytes: u64,
    pub compatibility_patches: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVersions {
    pub build_version: String,
    pub app_version: String,
    pub compatibility_version: u32,
    pub compatibility_patches: usize,
}

pub fn runtime_compatibility_is_current(runtime_root: &Path) -> bool {
    fs::read(runtime_root.join("versions.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RuntimeVersions>(&bytes).ok())
        .is_some_and(|versions| versions.compatibility_version == COMPATIBILITY_VERSION)
}

pub fn ensure_runtime_compatibility(paths: &AppPaths) -> Result<bool, AppError> {
    if runtime_compatibility_is_current(&paths.client_runtime) {
        return Ok(false);
    }
    let manifest_path = paths.client.join("manifest.json");
    if !manifest_path.is_file() {
        return Ok(false);
    }
    let manifest: InstalledManifest =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(distribution_io)?)
            .map_err(|error| AppError::Distribution(format!("manifest local invalide: {error}")))?;
    let target = compatibility_target();
    let app_version = if target == CompatibilityTarget::Android {
        fetch_android_app_version(&http_client()?)?
    } else {
        manifest
            .version
            .split_once('+')
            .map(|(app, _)| app.to_owned())
            .ok_or_else(|| AppError::Distribution("version locale du client invalide".into()))?
    };
    validate_version(&app_version, "application")?;

    let operation_id = Uuid::new_v4().to_string();
    let runtime_stage = paths
        .downloads
        .join(format!("runtime-refresh-{operation_id}.staging"));
    fs::create_dir_all(&runtime_stage).map_err(distribution_io)?;
    let result = (|| {
        copy_official_runtime_files(&manifest, &paths.client, &runtime_stage)?;
        let runtime_script_path = runtime_stage.join("build/script.js");
        let runtime_source = fs::read_to_string(&runtime_script_path).map_err(distribution_io)?;
        let build_version = extract_build_version(&runtime_source)?;
        validate_version(&build_version, "build")?;
        let (runtime_script, compatibility_patches) =
            patch_runtime_script(&runtime_source, target)?;
        fs::write(&runtime_script_path, runtime_script).map_err(distribution_io)?;
        write_runtime_shell(
            &runtime_stage,
            &RuntimeVersions {
                build_version: build_version.clone(),
                app_version: app_version.clone(),
                compatibility_version: COMPATIBILITY_VERSION,
                compatibility_patches,
            },
            target,
        )?;
        replace_runtime(&runtime_stage, &paths.client_runtime, &operation_id)?;
        if target == CompatibilityTarget::Android {
            let expected_version = format!("{app_version}+{build_version}");
            if manifest.version != expected_version {
                let mut updated_manifest = manifest.clone();
                updated_manifest.version = expected_version;
                let temporary_manifest = paths
                    .client
                    .join(format!("manifest-{operation_id}.temporary"));
                fs::write(
                    &temporary_manifest,
                    serde_json::to_vec_pretty(&updated_manifest)
                        .map_err(|error| AppError::Distribution(error.to_string()))?,
                )
                .map_err(distribution_io)?;
                fs::rename(temporary_manifest, &manifest_path).map_err(distribution_io)?;
            }
        }
        Ok(())
    })();
    if result.is_err() && runtime_stage.exists() {
        let _ = fs::remove_dir_all(&runtime_stage);
    }
    result.map(|()| true)
}

#[derive(Debug, Deserialize, Serialize)]
struct RemoteManifest {
    #[serde(default)]
    files: BTreeMap<String, RemoteFile>,
    #[serde(default)]
    load: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RemoteFile {
    filename: String,
    version: String,
}

pub fn install_client<F>(paths: AppPaths, progress: F) -> Result<InstallOutcome, AppError>
where
    F: Fn(InstallProgress),
{
    let operation_id = Uuid::new_v4().to_string();
    let official_stage = paths
        .downloads
        .join(format!("official-{operation_id}.staging"));
    let runtime_stage = paths
        .downloads
        .join(format!("runtime-{operation_id}.staging"));
    fs::create_dir_all(&official_stage).map_err(distribution_io)?;
    fs::create_dir_all(&runtime_stage).map_err(distribution_io)?;

    let result = install_into_staging(
        &paths,
        &official_stage,
        &runtime_stage,
        &progress,
        &operation_id,
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&official_stage);
        let _ = fs::remove_dir_all(&runtime_stage);
    }
    result
}

fn install_into_staging<F>(
    paths: &AppPaths,
    official_stage: &Path,
    runtime_stage: &Path,
    progress: &F,
    operation_id: &str,
) -> Result<InstallOutcome, AppError>
where
    F: Fn(InstallProgress),
{
    emit(progress, "metadata", "Lecture des manifestes Ankama…", 4);
    let client = http_client()?;

    let manifest_bytes = fetch_small(&client, MANIFEST_URL)?;
    let asset_map_bytes = fetch_small(&client, ASSET_MAP_URL)?;
    let manifest: RemoteManifest = parse_json(&manifest_bytes, "manifest.json")?;
    let asset_map: RemoteManifest = parse_json(&asset_map_bytes, "assetMap.json")?;
    if manifest.files.is_empty() {
        return Err(AppError::Distribution(
            "le manifeste Ankama ne contient aucun fichier de jeu".into(),
        ));
    }

    let mut installed_files = Vec::new();
    installed_files.push(write_tracked_bytes(
        official_stage,
        "source-manifest.json",
        &manifest_bytes,
        "remote-manifest",
    )?);
    installed_files.push(write_tracked_bytes(
        official_stage,
        "source-asset-map.json",
        &asset_map_bytes,
        "remote-asset-map",
    )?);

    let remote_files = merge_remote_files(&manifest, &asset_map)?;
    let total_files = remote_files.len();
    let mut downloaded_bytes = 0_u64;
    for (index, (relative_path, remote_file)) in remote_files.iter().enumerate() {
        let percent = 10 + (((index as f32 / total_files.max(1) as f32) * 55.0) as u8);
        emit(
            progress,
            "download",
            &format!(
                "Téléchargement de {} ({}/{total_files})",
                relative_path,
                index + 1
            ),
            percent,
        );
        let destination = official_stage.join(safe_relative_path(relative_path)?);
        let (size, sha256) = download_file(
            &client,
            &format!("{GAME_ORIGIN}{}", remote_file.filename),
            &destination,
        )?;
        downloaded_bytes = downloaded_bytes.saturating_add(size);
        installed_files.push(InstalledClientFile {
            relative_path: relative_path.clone(),
            size,
            sha256,
            source_version: remote_file.version.clone(),
        });
    }

    emit(
        progress,
        "versions",
        "Détection des versions du client…",
        68,
    );
    let official_script = official_stage.join("build/script.js");
    let source_script = fs::read_to_string(&official_script).map_err(distribution_io)?;
    let build_version = extract_build_version(&source_script)?;
    let app_version = fetch_android_app_version(&client)?;
    validate_version(&build_version, "build")?;
    validate_version(&app_version, "application")?;
    let version = format!("{app_version}+{build_version}");

    installed_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let installed_manifest = InstalledManifest {
        version: version.clone(),
        generated_at: Utc::now().to_rfc3339(),
        files: installed_files,
    };
    fs::write(
        official_stage.join("manifest.json"),
        serde_json::to_vec_pretty(&installed_manifest)
            .map_err(|error| AppError::Distribution(error.to_string()))?,
    )
    .map_err(distribution_io)?;

    let target = compatibility_target();
    emit(
        progress,
        "compatibility",
        if target == CompatibilityTarget::Android {
            "Adaptation légère du client Android…"
        } else {
            "Création de la couche de compatibilité desktop…"
        },
        74,
    );
    copy_official_runtime_files(&installed_manifest, official_stage, runtime_stage)?;
    let runtime_script_path = runtime_stage.join("build/script.js");
    let runtime_source = fs::read_to_string(&runtime_script_path).map_err(distribution_io)?;
    let (runtime_script, compatibility_patches) = patch_runtime_script(&runtime_source, target)?;
    fs::write(&runtime_script_path, runtime_script).map_err(distribution_io)?;
    write_runtime_shell(
        runtime_stage,
        &RuntimeVersions {
            build_version: build_version.clone(),
            app_version: app_version.clone(),
            compatibility_version: COMPATIBILITY_VERSION,
            compatibility_patches,
        },
        target,
    )?;

    emit(progress, "install", "Installation atomique du client…", 92);
    swap_installation(
        official_stage,
        &paths.client,
        runtime_stage,
        &paths.client_runtime,
        operation_id,
    )?;
    emit(progress, "complete", "Client prêt à jouer.", 100);

    Ok(InstallOutcome {
        version,
        build_version,
        app_version,
        downloaded_files: total_files,
        downloaded_bytes,
        compatibility_patches,
    })
}

fn emit<F>(progress: &F, phase: &'static str, message: &str, percent: u8)
where
    F: Fn(InstallProgress),
{
    progress(InstallProgress {
        phase,
        message: message.into(),
        percent,
    });
}

fn merge_remote_files(
    manifest: &RemoteManifest,
    asset_map: &RemoteManifest,
) -> Result<BTreeMap<String, RemoteFile>, AppError> {
    let mut merged = BTreeMap::new();
    for file in manifest.files.values().chain(asset_map.files.values()) {
        let relative = safe_relative_path(&file.filename)?;
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if normalized != file.filename {
            return Err(AppError::Distribution(format!(
                "chemin non normalisé dans le manifeste: {}",
                file.filename
            )));
        }
        if let Some(previous) = merged.insert(normalized.clone(), file.clone())
            && previous.version != file.version
        {
            return Err(AppError::Distribution(format!(
                "versions contradictoires pour {normalized}"
            )));
        }
    }
    Ok(merged)
}

fn fetch_small(client: &Client, url: &str) -> Result<Vec<u8>, AppError> {
    let response = request_with_retry(client, url)?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_MANIFEST_SIZE as u64)
    {
        return Err(AppError::Distribution(format!(
            "réponse trop volumineuse pour {url}"
        )));
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_MANIFEST_SIZE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(distribution_io)?;
    if bytes.len() > MAX_MANIFEST_SIZE {
        return Err(AppError::Distribution(format!(
            "réponse trop volumineuse pour {url}"
        )));
    }
    Ok(bytes)
}

fn parse_json<T: DeserializeOwned>(bytes: &[u8], name: &str) -> Result<T, AppError> {
    serde_json::from_slice(bytes)
        .map_err(|error| AppError::Distribution(format!("{name} invalide: {error}")))
}

fn request_with_retry(client: &Client, url: &str) -> Result<Response, AppError> {
    let mut last_error = String::new();
    for attempt in 0..3 {
        match client.get(url).send() {
            Ok(response) if response.status().is_success() => return Ok(response),
            Ok(response) => {
                last_error = format!("HTTP {}", response.status());
            }
            Err(error) => last_error = error.to_string(),
        }
        if attempt < 2 {
            thread::sleep(Duration::from_millis(500 * (attempt + 1) as u64));
        }
    }
    Err(AppError::Distribution(format!(
        "échec du téléchargement de {url}: {last_error}"
    )))
}

fn download_file(
    client: &Client,
    url: &str,
    destination: &Path,
) -> Result<(u64, String), AppError> {
    let mut response = request_with_retry(client, url)?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_FILE_SIZE)
    {
        return Err(AppError::Distribution(format!(
            "fichier distant trop volumineux: {url}"
        )));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Distribution("destination sans dossier parent".into()))?;
    fs::create_dir_all(parent).map_err(distribution_io)?;
    let temporary = destination.with_extension(format!("{}.part", Uuid::new_v4()));
    let mut output = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(distribution_io)?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(distribution_io)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_FILE_SIZE {
            let _ = fs::remove_file(&temporary);
            return Err(AppError::Distribution(format!(
                "fichier distant trop volumineux: {url}"
            )));
        }
        output.write_all(&buffer[..read]).map_err(distribution_io)?;
        hasher.update(&buffer[..read]);
    }
    output.sync_all().map_err(distribution_io)?;
    drop(output);
    fs::rename(&temporary, destination).map_err(distribution_io)?;
    Ok((total, hex::encode(hasher.finalize())))
}

fn write_tracked_bytes(
    root: &Path,
    relative_path: &str,
    bytes: &[u8],
    source_version: &str,
) -> Result<InstalledClientFile, AppError> {
    let path = root.join(safe_relative_path(relative_path)?);
    fs::write(path, bytes).map_err(distribution_io)?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(InstalledClientFile {
        relative_path: relative_path.into(),
        size: bytes.len() as u64,
        sha256: hex::encode(hasher.finalize()),
        source_version: source_version.into(),
    })
}

fn extract_build_version(script: &str) -> Result<String, AppError> {
    let pattern = Regex::new(r#"window\.buildVersion\s*=\s*["']([^"']+)["']"#)
        .map_err(|error| AppError::Distribution(error.to_string()))?;
    pattern
        .captures(script)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .ok_or_else(|| AppError::Distribution("version du build introuvable".into()))
}

fn http_client() -> Result<Client, AppError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .user_agent("Twelia/0.1 client installer")
        .build()
        .map_err(distribution_http)
}

fn fetch_android_app_version(client: &Client) -> Result<String, AppError> {
    let bytes = fetch_small(client, PLAY_STORE_URL)?;
    let page = std::str::from_utf8(&bytes).map_err(|error| {
        AppError::Distribution(format!("réponse Google Play invalide: {error}"))
    })?;
    extract_play_store_version(page)
}

fn extract_play_store_version(page: &str) -> Result<String, AppError> {
    let pattern =
        Regex::new(r#"\[\[\["([0-9]+\.[0-9]+\.[0-9]+(?:[-+._][0-9A-Za-z]+)*)"\]\],\[\[\["#)
            .map_err(|error| AppError::Distribution(error.to_string()))?;
    pattern
        .captures(page)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .ok_or_else(|| AppError::Distribution("version Android Google Play introuvable".into()))
}

fn validate_version(version: &str, label: &str) -> Result<(), AppError> {
    if version.is_empty()
        || version.len() > 40
        || !version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".+-_".contains(character))
    {
        return Err(AppError::Distribution(format!(
            "version {label} invalide: {version}"
        )));
    }
    Ok(())
}

fn copy_official_runtime_files(
    manifest: &InstalledManifest,
    official_root: &Path,
    runtime_root: &Path,
) -> Result<(), AppError> {
    for item in &manifest.files {
        if item.relative_path.starts_with("source-") {
            continue;
        }
        let relative = safe_relative_path(&item.relative_path)?;
        let source = official_root.join(&relative);
        let destination = runtime_root.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(distribution_io)?;
        }
        fs::copy(source, destination).map_err(distribution_io)?;
    }
    Ok(())
}

fn patch_runtime_script(
    source: &str,
    target: CompatibilityTarget,
) -> Result<(String, usize), AppError> {
    let mut output = source.to_owned();
    let mut applied = 0_usize;

    let mut replacements = vec![
        (
            "asset-path",
            Regex::new(r"cdvfile://localhost/persistent/data/assets").unwrap(),
            format!("{GAME_ORIGIN}assets"),
        ),
        (
            "client-versions",
            Regex::new(r#"(?s)(language\s*:\s*window\.Config.{0,240}?client\s*:\s*)[^,}\s]+(.{0,240}?appVersion\s*:\s*)[^,}\s]+(.{0,240}?buildVersion\s*:\s*)[^,}\s]+"#).unwrap(),
            "${1}\"android\"${2}window.__TWELIA__.appVersion${3}window.__TWELIA__.buildVersion".into(),
        ),
        (
            "oauth-callback-bridge",
            Regex::new(r"([A-Za-z_$][A-Za-z0-9_$]*)\.setCallback=function\(([A-Za-z_$][A-Za-z0-9_$]*)\)\{([A-Za-z_$][A-Za-z0-9_$]*)=([A-Za-z_$][A-Za-z0-9_$]*)\}").unwrap(),
            "${1}.setCallback=function(${2}){var __tweliaOAuthHandled=false;${3}=function(){if(__tweliaOAuthHandled)return;__tweliaOAuthHandled=true;return ${4}.apply(this,arguments)},window.__TWELIA_OAUTH_CALLBACK__=function(payload){return payload&&payload.code?${3}(null,payload.code):payload&&payload.error?${3}(new Error(payload.error)):void 0}}".into(),
        ),
        (
            "body-target",
            Regex::new(r#"new\s+([A-Za-z_$][A-Za-z0-9_$]*)\(document\.getElementsByClassName\("dofusBody"\)\[0\]\)"#).unwrap(),
            "new $1(document.getElementById(\"dofusBody\"))".into(),
        ),
    ];

    if target == CompatibilityTarget::Desktop {
        replacements.extend([
            (
                "viewport",
                Regex::new(r"=\s*[A-Za-z_$][A-Za-z0-9_$]*\.viewport(?:Width|Height)\s*\|\|").unwrap(),
                "=".into(),
            ),
            (
                "desktop-zoom",
                Regex::new(r"Math\.min\(Math\.max\(([A-Za-z_$][A-Za-z0-9_$]*),\s*([A-Za-z_$][A-Za-z0-9_$]*)\),\s*this\.maxZoom\)").unwrap(),
                "Math.max($1,$2)".into(),
            ),
        ]);
    } else {
        replacements.push((
            "mobile-oauth-launcher",
            Regex::new(r"window\.process&&window\.process\.type\?\(f=([A-Za-z_$][A-Za-z0-9_$]*),h=O\.deepLink\):\(f=([A-Za-z_$][A-Za-z0-9_$]*),h=O\.browserLink,e=!0\)").unwrap(),
            "window.__TWELIA_MOBILE_EMBEDDED__?(f=window.__TWELIA_OPEN_AUTH__,h=O.deepLink):window.process&&window.process.type?(f=$1,h=O.deepLink):(f=$2,h=O.browserLink,e=!0)".into(),
        ));
    }

    for (name, pattern, replacement) in replacements {
        let count = pattern.find_iter(&output).count();
        if count == 0 {
            return Err(AppError::Distribution(format!(
                "compatibilité '{name}' incompatible avec cette version du client"
            )));
        }
        output = pattern
            .replace_all(&output, replacement.as_str())
            .into_owned();
        applied += count;
    }
    Ok((output, applied))
}

fn write_runtime_shell(
    root: &Path,
    versions: &RuntimeVersions,
    target: CompatibilityTarget,
) -> Result<(), AppError> {
    let version_json = serde_json::to_string(versions)
        .map_err(|error| AppError::Distribution(error.to_string()))?;
    let mobile_embedded = target == CompatibilityTarget::Android;
    let platform_bootstrap = if mobile_embedded {
        "window.__TWELIA_OPEN_AUTH__ = function (url) { return window.open(url, \"_blank\"); };"
    } else {
        "window.process = { type: \"renderer\" };\nwindow.ontouchstart = function () {};"
    };
    let bootstrap = format!(
        r#""use strict";
window.__TWELIA__ = {version_json};
window.__TWELIA_MOBILE_EMBEDDED__ = {mobile_embedded} && window.parent !== window;
window.appInfo = {{ version: window.__TWELIA__.appVersion }};
{platform_bootstrap}

(function installMouseBridge() {{
  var pressed = false;
  var names = {{ mousedown: "touchstart", mousemove: "touchmove", mouseup: "touchend" }};
  function forward(event) {{
    var target = event.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.type === "mousedown") pressed = true;
    if (event.type === "mouseup") pressed = false;
    if (event.type === "mousemove" && !pressed) return;
    if (typeof Touch !== "function" || typeof TouchEvent !== "function") return;
    try {{
      var point = new Touch({{
        identifier: 1,
        target: event.target,
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        screenX: event.screenX,
        screenY: event.screenY,
        radiusX: 8,
        radiusY: 8,
        force: event.type === "mouseup" ? 0 : 1
      }});
      var active = event.type === "mouseup" ? [] : [point];
      event.target.dispatchEvent(new TouchEvent(names[event.type], {{
        bubbles: true,
        cancelable: true,
        composed: true,
        touches: active,
        targetTouches: active,
        changedTouches: [point],
        view: window
      }}));
      event.stopPropagation();
      event.preventDefault();
    }} catch (error) {{
      console.debug("Twelia mouse bridge:", error);
    }}
  }}
  window.addEventListener("DOMContentLoaded", function () {{
    Object.keys(names).forEach(function (name) {{
      document.body.addEventListener(name, forward, true);
    }});
  }});
}})();

(function installEmbeddedHostBridge() {{
  if (window.parent === window || window.__TWELIA_EMBEDDED_BRIDGE__) return;
  window.__TWELIA_EMBEDDED_BRIDGE__ = true;
  var popup = null;
  var originalOpen = window.open.bind(window);

  function post(type, payload) {{
    window.parent.postMessage(Object.assign({{
      source: "twelia-game",
      type: type
    }}, payload || {{}}), "*");
  }}

  window.open = function (url, target, features) {{
    var value = String(url || "");
    if (!/^https?:\/\//i.test(value)) return originalOpen(url, target, features);
    popup = {{
      closed: false,
      location: {{ search: "" }},
      close: function () {{ this.closed = true; }},
      focus: function () {{}},
      eval: function () {{}}
    }};
    post("open-auth", {{ url: value }});
    return popup;
  }};

  post("bridge-ready", {{ compatibilityVersion: {COMPATIBILITY_VERSION} }});

  window.addEventListener("message", function (event) {{
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== "twelia-host" || data.type !== "oauth-callback") return;
    if (popup) popup.closed = true;
    if (typeof window.__TWELIA_OAUTH_CALLBACK__ === "function") {{
      window.__TWELIA_OAUTH_CALLBACK__(data.payload);
    }}
  }});

  function installAttentionListeners() {{
    var connection = window.connectionManager;
    var gui = window.gui;
    var playerData = gui && gui.playerData;
    var characters = playerData && playerData.characters;
    if (!connection || typeof connection.on !== "function" || !characters) return false;

    function onTurn(message) {{
      if (!message || typeof characters.canControlCharacterId !== "function") return;
      if (characters.canControlCharacterId(message.id)) {{
        post("attention", {{ kind: "combat-turn" }});
      }}
    }}

    connection.on("GameFightTurnStartMessage", onTurn);
    connection.on("GameFightTurnResumeMessage", onTurn);
    connection.on("GameFightTurnStartSlaveMessage", onTurn);
    connection.on("PartyInvitationMessage", function () {{
      post("attention", {{ kind: "party-invitation" }});
    }});
    connection.on("PartyMemberInFightMessage", function (message) {{
      var currentGui = window.gui;
      var data = currentGui && currentGui.playerData;
      if (!data || !message || !message.fightMap) return;
      if (data.isFighting && !data.isSpectator) return;
      if (
        data.labyrinthData &&
        typeof data.labyrinthData.isInTheLabyrinth === "function" &&
        data.labyrinthData.isInTheLabyrinth()
      ) return;
      if (!data.position || data.position.mapId !== message.fightMap.mapId) return;
      post("attention", {{ kind: "group-fight" }});
    }});
    return true;
  }}

  var attempts = 0;
  var timer = window.setInterval(function () {{
    attempts += 1;
    if (installAttentionListeners() || attempts >= 1200) window.clearInterval(timer);
  }}, 250);
}})();

"#
    );
    let viewport = if mobile_embedded {
        "width=1280, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    } else {
        "width=device-width, initial-scale=1, user-scalable=no"
    };
    let html = format!(
        r#"<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="{viewport}">
    <title>DOFUS Touch — Twelia</title>
    <link rel="stylesheet" href="build/styles-native.css">
    <link rel="stylesheet" href="compatibility.css">
    <script src="compatibility.js"></script>
  </head>
  <body>
    <script src="build/script.js"></script>
  </body>
</html>
"#
    );
    let css = r#"html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #000;
}

#dofusBody {
  width: 100vw !important;
  height: 100vh !important;
  min-height: 100vh !important;
}

.ShortcutBar .drawerContent {
  min-width: 100% !important;
}

#dofusBody .window.fullScreen,
#dofusBody .window.SecurityCodeWindow,
#dofusBody .window.SimplePopup.fullScreenPopup {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  transform: none !important;
}

#dofusBody .window.SecurityCodeWindow .windowContent {
  width: min(880px, calc(100vw - 32px)) !important;
  height: min(525px, calc(100vh - 32px)) !important;
}

#dofusBody .window.SecurityCodeWindow input {
  pointer-events: auto !important;
  user-select: text !important;
  -webkit-user-select: text !important;
}
"#;
    fs::write(root.join("compatibility.js"), bootstrap).map_err(distribution_io)?;
    fs::write(root.join("compatibility.css"), css).map_err(distribution_io)?;
    fs::write(root.join("index.html"), html).map_err(distribution_io)?;
    fs::write(
        root.join("versions.json"),
        serde_json::to_vec_pretty(versions)
            .map_err(|error| AppError::Distribution(error.to_string()))?,
    )
    .map_err(distribution_io)?;
    Ok(())
}

fn swap_installation(
    official_stage: &Path,
    official_target: &Path,
    runtime_stage: &Path,
    runtime_target: &Path,
    operation_id: &str,
) -> Result<(), AppError> {
    let official_backup = official_target.with_extension(format!("{operation_id}.backup"));
    let runtime_backup = runtime_target.with_extension(format!("{operation_id}.backup"));
    let official_existed = official_target.exists();
    let runtime_existed = runtime_target.exists();

    if official_existed {
        fs::rename(official_target, &official_backup).map_err(distribution_io)?;
    }
    if runtime_existed && let Err(error) = fs::rename(runtime_target, &runtime_backup) {
        if official_existed {
            let _ = fs::rename(&official_backup, official_target);
        }
        return Err(distribution_io(error));
    }
    if let Err(error) = fs::rename(official_stage, official_target) {
        restore_backups(
            official_target,
            &official_backup,
            official_existed,
            runtime_target,
            &runtime_backup,
            runtime_existed,
        );
        return Err(distribution_io(error));
    }
    if let Err(error) = fs::rename(runtime_stage, runtime_target) {
        let _ = fs::remove_dir_all(official_target);
        restore_backups(
            official_target,
            &official_backup,
            official_existed,
            runtime_target,
            &runtime_backup,
            runtime_existed,
        );
        return Err(distribution_io(error));
    }

    if official_backup.exists()
        && let Err(error) = fs::remove_dir_all(&official_backup)
    {
        log::warn!("ancien client non supprimé: {error}");
    }
    if runtime_backup.exists()
        && let Err(error) = fs::remove_dir_all(&runtime_backup)
    {
        log::warn!("ancien runtime non supprimé: {error}");
    }
    Ok(())
}

fn replace_runtime(
    runtime_stage: &Path,
    runtime_target: &Path,
    operation_id: &str,
) -> Result<(), AppError> {
    let runtime_backup = runtime_target.with_extension(format!("{operation_id}.backup"));
    let runtime_existed = runtime_target.exists();
    if runtime_existed {
        fs::rename(runtime_target, &runtime_backup).map_err(distribution_io)?;
    }
    if let Err(error) = fs::rename(runtime_stage, runtime_target) {
        if runtime_existed && runtime_backup.exists() {
            let _ = fs::rename(&runtime_backup, runtime_target);
        }
        return Err(distribution_io(error));
    }
    if runtime_backup.exists()
        && let Err(error) = fs::remove_dir_all(&runtime_backup)
    {
        log::warn!("ancien runtime non supprimé: {error}");
    }
    Ok(())
}

fn restore_backups(
    official_target: &Path,
    official_backup: &Path,
    official_existed: bool,
    runtime_target: &Path,
    runtime_backup: &Path,
    runtime_existed: bool,
) {
    if official_existed && official_backup.exists() {
        let _ = fs::rename(official_backup, official_target);
    }
    if runtime_existed && runtime_backup.exists() {
        let _ = fs::rename(runtime_backup, runtime_target);
    }
}

fn distribution_http(error: reqwest::Error) -> AppError {
    AppError::Distribution(error.to_string())
}

fn distribution_io(error: std::io::Error) -> AppError {
    AppError::Distribution(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_and_applies_only_compatibility_changes() {
        let source = r#"window.buildVersion="1.73.3";var x={language:window.Config?window.Config.language:"fr",client:a.client,appVersion:a.app,buildVersion:a.build};var A="cdvfile://localhost/persistent/data/assets";x=y.viewportWidth||z;new Q(document.getElementsByClassName("dofusBody")[0]);Math.min(Math.max(a,b),this.maxZoom);t.setCallback=function(e){z=e}"#;
        assert_eq!(extract_build_version(source).unwrap(), "1.73.3");
        let (patched, count) = patch_runtime_script(source, CompatibilityTarget::Desktop).unwrap();
        assert_eq!(count, 6);
        assert!(patched.contains("window.__TWELIA__.appVersion"));
        assert!(patched.contains("document.getElementById"));
        assert!(patched.contains("window.__TWELIA_OAUTH_CALLBACK__"));
        assert!(patched.contains("__tweliaOAuthHandled"));
        assert!(!patched.contains("cdvfile://"));
    }

    #[test]
    fn android_keeps_game_zoom_but_locks_browser_zoom_and_uses_the_oauth_bridge() {
        let source = r#"window.buildVersion="1.73.3";var x={language:window.Config?window.Config.language:"fr",client:a.client,appVersion:a.app,buildVersion:a.build};var A="cdvfile://localhost/persistent/data/assets";x=y.viewportWidth||z;new Q(document.getElementsByClassName("dofusBody")[0]);Math.min(Math.max(a,b),this.maxZoom);t.setCallback=function(e){z=e};window.process&&window.process.type?(f=c,h=O.deepLink):(f=s,h=O.browserLink,e=!0)"#;
        let (patched, count) = patch_runtime_script(source, CompatibilityTarget::Android).unwrap();
        assert_eq!(count, 5);
        assert!(patched.contains("x=y.viewportWidth||z"));
        assert!(patched.contains("document.getElementById"));
        assert!(patched.contains("Math.min(Math.max(a,b),this.maxZoom)"));
        assert!(patched.contains("f=window.__TWELIA_OPEN_AUTH__"));

        let root = tempfile::tempdir().unwrap();
        let versions = RuntimeVersions {
            build_version: "1.73.3".into(),
            app_version: "3.14.0".into(),
            compatibility_version: COMPATIBILITY_VERSION,
            compatibility_patches: count,
        };
        write_runtime_shell(root.path(), &versions, CompatibilityTarget::Android).unwrap();
        let html = fs::read_to_string(root.path().join("index.html")).unwrap();
        let bootstrap = fs::read_to_string(root.path().join("compatibility.js")).unwrap();
        assert!(html.contains(
            "width=1280, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no"
        ));
        assert!(!bootstrap.contains("window.process ="));
    }

    #[test]
    fn extracts_the_android_version_from_the_play_store_page() {
        let page = r#"ignored,null,[[["3.14.0"]],[[[35]],[[[24,"7.0"]]]]],ignored"#;
        assert_eq!(extract_play_store_version(page).unwrap(), "3.14.0");
        assert!(extract_play_store_version("missing").is_err());
    }

    #[test]
    fn rejects_unsafe_remote_paths() {
        let manifest = RemoteManifest {
            files: BTreeMap::from([(
                "bad".into(),
                RemoteFile {
                    filename: "../escape.js".into(),
                    version: "1".into(),
                },
            )]),
            load: Vec::new(),
        };
        assert!(
            merge_remote_files(
                &manifest,
                &RemoteManifest {
                    files: BTreeMap::new(),
                    load: Vec::new(),
                }
            )
            .is_err()
        );
    }

    #[test]
    fn refreshes_an_outdated_runtime_from_the_local_official_copy() {
        use crate::storage::StorageService;

        let root = tempfile::tempdir().unwrap();
        let storage = StorageService::new(root.path().to_path_buf()).unwrap();
        let paths = storage.paths();
        fs::create_dir_all(paths.client.join("build")).unwrap();
        let source = r#"window.buildVersion="1.73.3";var x={language:window.Config?window.Config.language:"fr",client:a.client,appVersion:a.app,buildVersion:a.build};var A="cdvfile://localhost/persistent/data/assets";x=y.viewportWidth||z;new Q(document.getElementsByClassName("dofusBody")[0]);Math.min(Math.max(a,b),this.maxZoom);t.setCallback=function(e){z=e}"#;
        fs::write(paths.client.join("build/script.js"), source).unwrap();
        let manifest = InstalledManifest {
            version: "3.11.0+1.73.3".into(),
            generated_at: Utc::now().to_rfc3339(),
            files: vec![InstalledClientFile {
                relative_path: "build/script.js".into(),
                size: source.len() as u64,
                sha256: "test".into(),
                source_version: "1".into(),
            }],
        };
        fs::write(
            paths.client.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            paths.client_runtime.join("versions.json"),
            br#"{"buildVersion":"1.73.3","appVersion":"3.11.0","compatibilityVersion":1,"compatibilityPatches":6}"#,
        )
        .unwrap();

        assert!(ensure_runtime_compatibility(&paths).unwrap());
        assert!(runtime_compatibility_is_current(&paths.client_runtime));
        assert!(!ensure_runtime_compatibility(&paths).unwrap());
        let patched = fs::read_to_string(paths.client_runtime.join("build/script.js")).unwrap();
        assert!(patched.contains("Math.max(a,b)"));
    }

    #[test]
    #[ignore = "requires the live Ankama and Google Play endpoints"]
    fn installs_the_current_live_client() {
        use crate::storage::StorageService;

        let root = tempfile::tempdir().unwrap();
        let storage = StorageService::new(root.path().to_path_buf()).unwrap();
        let outcome = install_client(storage.paths(), |_| {}).unwrap();
        assert!(!outcome.build_version.is_empty());
        assert!(!outcome.app_version.is_empty());
        assert!(root.path().join("client-officiel/manifest.json").is_file());
        assert!(root.path().join("client-runtime/index.html").is_file());
    }
}
