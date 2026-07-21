#[cfg(test)]
use super::game::unavailable_game_control;
use super::{
    catalog::ModPackage,
    commands::ModCommandStore,
    data::ModDataStore,
    game::{ModGameCommand, ModGameControl},
    http::ModHttpClient,
    logs::ModLogBuffer,
    platform::ModPlatformServices,
    secrets::ModSecretStore,
    settings::ModSettingsStore,
    ui::ModUiStore,
};
use crate::error::AppError;
use chrono::{DateTime, Utc};
use rquickjs::{CatchResultExt, Context, Function, Module, Runtime, function::Func};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const MAX_RUNTIME_MEMORY: usize = 16 * 1024 * 1024;
const MAX_RUNTIME_STACK: usize = 512 * 1024;
const MAX_EXECUTION_TIME: Duration = Duration::from_millis(500);
const MAX_INITIALIZATION_WAIT: Duration = Duration::from_secs(3);
const MAX_GROUP_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_ACTIVE_TIMERS: usize = 64;
const MAX_ACTIVE_REQUESTS: usize = 16;
const MIN_TIMER_DELAY_MS: u32 = 50;
const MAX_TIMER_DELAY_MS: u32 = 60_000;

const MOD_BOOTSTRAP: &str = r#"
"use strict";
(() => {
  const handlers = new Map();
  const session = Object.freeze(JSON.parse(globalThis.__TWELIA_SESSION_JSON__));
  const api = Object.freeze(JSON.parse(globalThis.__TWELIA_API_JSON__));
  const capabilityList = Object.freeze(JSON.parse(globalThis.__TWELIA_CAPABILITIES_JSON__));
  const capabilities = Object.freeze({
    list: capabilityList,
    has: (capability) => capabilityList.includes(String(capability)),
  });

  function reportAsyncError(error) {
    const message = error && error.stack ? error.stack : String(error);
    globalThis.__tweliaNativeUnhandled(message);
  }

  function runHandler(handler, payload) {
    try {
      const result = handler(payload);
      if (result && typeof result.then === "function") result.catch(reportAsyncError);
    } catch (error) {
      reportAsyncError(error);
    }
  }

  function on(type, handler, options = {}) {
    if (typeof type !== "string" || !type || typeof handler !== "function") {
      throw new TypeError("twelia.on attend un nom d'Ã©vÃ©nement et une fonction");
    }
    let listener = handler;
    if (options && options.once) {
      listener = (payload) => {
        off();
        return handler(payload);
      };
    }
    const listeners = handlers.get(type) || [];
    listeners.push(listener);
    handlers.set(type, listeners);
    const off = () => {
      const current = handlers.get(type);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index !== -1) current.splice(index, 1);
      if (!current.length) handlers.delete(type);
    };
    if (options && options.signal && typeof options.signal.addEventListener === "function") {
      if (options.signal.aborted) off();
      else options.signal.addEventListener("abort", off, { once: true });
    }
    return off;
  }

  const log = Object.freeze({
    debug: (message) => globalThis.__tweliaNativeLog("debug", String(message)),
    info: (message) => globalThis.__tweliaNativeLog("info", String(message)),
    warn: (message) => globalThis.__tweliaNativeLog("warn", String(message)),
    error: (message) => globalThis.__tweliaNativeLog("error", String(message)),
  });

  function nativeUiCall(operation, payload) {
    const error = operation(payload);
    if (error) throw new Error(error);
  }

  const mountedPanels = new Map();

  function storePanel(panel) {
    const copy = JSON.parse(JSON.stringify(panel));
    nativeUiCall(globalThis.__tweliaNativeUiMount, JSON.stringify(copy));
    mountedPanels.set(String(copy.id), copy);
    return copy.id;
  }

  function findUiComponent(components, id) {
    for (const component of components || []) {
      if (component && component.id === id) return component;
      if (component && Array.isArray(component.children)) {
        const nested = findUiComponent(component.children, id);
        if (nested) return nested;
      }
    }
  }

  const ui = Object.freeze({
    mount: storePanel,
    update: storePanel,
    patch: (panelId, changes) => {
      const id = String(panelId);
      const current = mountedPanels.get(id);
      if (!current) throw new Error(`interface inconnue: ${id}`);
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        throw new TypeError("ui.patch attend un objet de modifications");
      }
      const next = JSON.parse(JSON.stringify(current));
      for (const [path, value] of Object.entries(changes)) {
        const separator = path.lastIndexOf(".");
        if (separator <= 0 || separator === path.length - 1) {
          throw new TypeError(`chemin de composant invalide: ${path}`);
        }
        const componentId = path.slice(0, separator);
        const field = path.slice(separator + 1);
        const component = findUiComponent(next.components, componentId);
        if (!component) throw new Error(`composant inconnu: ${componentId}`);
        component[field] = value;
      }
      return storePanel(next);
    },
    unmount: (panelId) => {
      const id = String(panelId);
      nativeUiCall(globalThis.__tweliaNativeUiUnmount, id);
      mountedPanels.delete(id);
    },
  });

  function gameCommand(name, payload = {}) {
    const error = globalThis.__tweliaNativeGameCommand(name, JSON.stringify(payload));
    if (error) throw new Error(error);
  }

  function gameCellId(value) {
    const cellId = Number(value);
    if (!Number.isInteger(cellId) || cellId < 0 || cellId > 559) {
      throw new TypeError("la cellule cible doit être un entier compris entre 0 et 559");
    }
    return cellId;
  }

  function positiveGameId(value, label) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new TypeError(`${label} doit être un identifiant entier positif`);
    }
    return id;
  }

  const game = Object.freeze({
    observeMap: () => gameCommand("observe-map"),
    moveToCell: (cellId) => {
      const target = Number(cellId);
      if (!Number.isInteger(target) || target < 0 || target > 559) {
        throw new TypeError("la cellule cible doit Ãªtre un entier compris entre 0 et 559");
      }
      gameCommand("move-to-cell", { cellId: target });
    },
    changeMap: (direction) => gameCommand("change-map", { direction: String(direction) }),
    attackMonster: (groupId) => gameCommand("attack-monster", { groupId: Number(groupId) }),
    joinPartyFight: (fightId, fighterId) => gameCommand("join-party-fight", {
      fightId: Number(fightId),
      fighterId: Number(fighterId),
    }),
    observeFight: () => gameCommand("observe-fight"),
    setFightPlacement: (cellId) => gameCommand("set-fight-placement", {
      cellId: gameCellId(cellId),
    }),
    moveInFight: (cellId) => gameCommand("move-in-fight", {
      cellId: gameCellId(cellId),
    }),
    castFightSpell: (spellId, targetCellId) => gameCommand("cast-fight-spell", {
      spellId: positiveGameId(spellId, "le sort"),
      targetCellId: gameCellId(targetCellId),
    }),
    fightReady: () => gameCommand("fight-ready"),
    finishFightTurn: () => gameCommand("finish-fight-turn"),
  });

  const gameSide = Object.freeze({
    send: (type, payload = {}) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("un message gameEntry doit contenir un objet");
      }
      const error = globalThis.__tweliaNativeGameSideSend(
        String(type),
        JSON.stringify(payload),
      );
      if (error) throw new Error(error);
    },
  });

  const group = Object.freeze({
    broadcast: (message) => {
      const error = globalThis.__tweliaNativeGroupBroadcast(JSON.stringify(message));
      if (error) throw new Error(error);
    },
  });

  function settingsSnapshot() {
    const result = JSON.parse(globalThis.__tweliaNativeSettingsGet());
    if (result.error) throw new Error(result.error);
    return Object.freeze(result.values || {});
  }

  const settings = Object.freeze({
    get: settingsSnapshot,
    onChange: (handler, options) => on("settings.changed", handler, options),
  });

  const secrets = Object.freeze({
    get: (key, fallback = null) => {
      const result = JSON.parse(globalThis.__tweliaNativeSecretGet(String(key)));
      if (result.error) throw new Error(result.error);
      return result.found ? result.value : fallback;
    },
    set: (key, value) => {
      const error = globalThis.__tweliaNativeSecretSet(String(key), String(value));
      if (error) throw new Error(error);
    },
    remove: (key) => {
      const error = globalThis.__tweliaNativeSecretRemove(String(key));
      if (error) throw new Error(error);
    },
  });

  function storageResult(payload) {
    const result = JSON.parse(payload);
    if (result.error) throw new Error(result.error);
    return result;
  }

  const storage = Object.freeze({
    get: (key, fallback = null) => {
      const result = storageResult(globalThis.__tweliaNativeStorageGet(String(key)));
      return result.found ? result.value : fallback;
    },
    set: (key, value) => {
      if (value === undefined) throw new TypeError("une valeur persistante ne peut pas être undefined");
      const error = globalThis.__tweliaNativeStorageSet(String(key), JSON.stringify(value));
      if (error) throw new Error(error);
      return value;
    },
    remove: (key) => {
      const error = globalThis.__tweliaNativeStorageRemove(String(key));
      if (error) throw new Error(error);
    },
    getMany: (keys) => {
      if (!Array.isArray(keys)) throw new TypeError("getMany attend un tableau de clés");
      return Object.fromEntries(keys.map((key) => [String(key), storage.get(String(key))]));
    },
    setMany: (values) => {
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new TypeError("setMany attend un objet");
      }
      const snapshot = storageSnapshot();
      Object.assign(snapshot.values, values);
      storageReplace(snapshot.version, snapshot.values);
      return values;
    },
    transaction: (mutator) => {
      if (typeof mutator !== "function") throw new TypeError("transaction attend une fonction");
      const snapshot = storageSnapshot();
      const draft = JSON.parse(JSON.stringify(snapshot.values));
      const result = mutator(draft);
      if (result && typeof result.then === "function") {
        throw new TypeError("une transaction de stockage doit être synchrone");
      }
      const next = result === undefined ? draft : result;
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        throw new TypeError("une transaction doit produire un objet");
      }
      storageReplace(snapshot.version, next);
      return next;
    },
    quota: () => {
      const result = JSON.parse(globalThis.__tweliaNativeStorageQuota());
      if (result.error) throw new Error(result.error);
      return result;
    },
    migrate: (targetVersion, migrations) => {
      const target = Number(targetVersion);
      if (!Number.isInteger(target) || target < 0) {
        throw new TypeError("la version de migration doit être un entier positif");
      }
      const snapshot = storageSnapshot();
      if (snapshot.version > target) {
        throw new Error(`les données utilisent déjà la version ${snapshot.version}`);
      }
      let values = JSON.parse(JSON.stringify(snapshot.values));
      for (let version = snapshot.version + 1; version <= target; version += 1) {
        const migration = migrations && (migrations[version] || migrations[String(version)]);
        if (typeof migration !== "function") {
          throw new Error(`migration ${version} manquante`);
        }
        const result = migration(values);
        if (result && typeof result.then === "function") {
          throw new TypeError("une migration de stockage doit être synchrone");
        }
        if (result !== undefined) values = result;
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          throw new TypeError(`la migration ${version} doit produire un objet`);
        }
      }
      storageReplace(target, values);
      return values;
    },
  });

  function storageSnapshot() {
    const result = JSON.parse(globalThis.__tweliaNativeStorageSnapshot());
    if (result.error) throw new Error(result.error);
    return { version: result.version || 0, values: result.values || {} };
  }

  function storageReplace(version, values) {
    const error = globalThis.__tweliaNativeStorageReplace(
      Number(version),
      JSON.stringify(values),
    );
    if (error) throw new Error(error);
  }

  const timerCallbacks = new Map();
  let nextTimerId = 1;
  const baseTime = Object.freeze({
    setTimeout: (callback, delayMs) => {
      if (typeof callback !== "function") throw new TypeError("le minuteur attend une fonction");
      const delay = Number(delayMs);
      if (!Number.isInteger(delay) || delay < 50 || delay > 60000) {
        throw new RangeError("le délai doit être un entier compris entre 50 et 60000 ms");
      }
      if (timerCallbacks.size >= 64) throw new Error("trop de minuteurs actifs");
      const id = nextTimerId++;
      timerCallbacks.set(id, callback);
      const error = globalThis.__tweliaNativeScheduleTimer(id, delay);
      if (error) {
        timerCallbacks.delete(id);
        throw new Error(error);
      }
      return id;
    },
    clearTimeout: (id) => {
      const timerId = Number(id);
      if (!Number.isInteger(timerId)) return;
      timerCallbacks.delete(timerId);
      globalThis.__tweliaNativeCancelTimer(timerId);
    },
  });

  const intervalTimers = new Map();
  let nextIntervalId = 1;

  function scheduleInterval(intervalId, callback, delayMs) {
    const timerId = baseTime.setTimeout(() => {
      if (!intervalTimers.has(intervalId)) return;
      const result = callback();
      Promise.resolve(result)
        .catch(reportAsyncError)
        .finally(() => {
          if (intervalTimers.has(intervalId)) {
            scheduleInterval(intervalId, callback, delayMs);
          }
        });
    }, delayMs);
    intervalTimers.set(intervalId, timerId);
  }

  const time = Object.freeze({
    ...baseTime,
    setInterval: (callback, delayMs) => {
      if (typeof callback !== "function") throw new TypeError("le minuteur attend une fonction");
      const intervalId = nextIntervalId++;
      intervalTimers.set(intervalId, 0);
      scheduleInterval(intervalId, callback, delayMs);
      return intervalId;
    },
    clearInterval: (intervalId) => {
      const timerId = intervalTimers.get(Number(intervalId));
      intervalTimers.delete(Number(intervalId));
      if (timerId) baseTime.clearTimeout(timerId);
    },
    sleep: (delayMs) => new Promise((resolve) => baseTime.setTimeout(resolve, delayMs)),
  });

  const pendingRequests = new Map();
  let nextRequestId = 1;

  function request(service, payload = {}, options = {}) {
    if (pendingRequests.size >= 16) return Promise.reject(new Error("trop de requêtes actives"));
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      let timeoutId;
      let abortHandler;
      const timeoutMs = options.timeoutMs === undefined ? 10000 : Number(options.timeoutMs);
      timeoutId = baseTime.setTimeout(() => {
        const pending = pendingRequests.get(id);
        pendingRequests.delete(id);
        if (pending && pending.abortHandler) {
          pending.signal.removeEventListener("abort", pending.abortHandler);
        }
        const error = new Error(`délai dépassé pour ${service}`);
        error.code = "REQUEST_TIMEOUT";
        reject(error);
      }, timeoutMs);
      if (options.signal && typeof options.signal.addEventListener === "function") {
        abortHandler = () => {
          pendingRequests.delete(id);
          if (timeoutId) baseTime.clearTimeout(timeoutId);
          const error = new Error(`requête annulée pour ${service}`);
          error.code = "REQUEST_ABORTED";
          reject(error);
        };
        if (options.signal.aborted) return abortHandler();
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
      pendingRequests.set(id, {
        resolve,
        reject,
        timeoutId,
        signal: options.signal,
        abortHandler,
      });
      const error = globalThis.__tweliaNativeRequest(id, String(service), JSON.stringify(payload));
      if (error) {
        pendingRequests.delete(id);
        if (timeoutId) baseTime.clearTimeout(timeoutId);
        if (abortHandler) options.signal.removeEventListener("abort", abortHandler);
        reject(new Error(error));
      }
    });
  }

  const http = Object.freeze({
    request: (options, control = {}) => request("http.request", options, {
      ...control,
      timeoutMs: control.timeoutMs ?? Math.min(
        60000,
        Math.max(500, Number(options && options.timeoutMs) + 1000 || 11000),
      ),
    }),
  });

  const notifications = Object.freeze({
    show: (title, body) => request("notifications.show", {
      title: String(title),
      body: String(body),
    }),
  });

  const clipboard = Object.freeze({
    writeText: (text) => request("clipboard.write", { text: String(text) }),
  });

  const files = Object.freeze({
    pickText: () => request("files.pick-text"),
    saveText: (suggestedName, text) => request("files.save-text", {
      suggestedName: String(suggestedName),
      text: String(text),
    }),
  });

  const commandHandlers = new Map();
  const commands = Object.freeze({
    register: (definition) => {
      if (!definition || typeof definition !== "object" || typeof definition.execute !== "function") {
        throw new TypeError("commands.register attend une commande avec execute");
      }
      const serializable = {
        id: String(definition.id),
        title: String(definition.title),
        ...(definition.description ? { description: String(definition.description) } : {}),
        ...(definition.shortcut ? { shortcut: String(definition.shortcut) } : {}),
      };
      const error = globalThis.__tweliaNativeCommandRegister(JSON.stringify(serializable));
      if (error) throw new Error(error);
      commandHandlers.set(serializable.id, definition.execute);
      return () => {
        commandHandlers.delete(serializable.id);
        globalThis.__tweliaNativeCommandUnregister(serializable.id);
      };
    },
  });

  Object.defineProperty(globalThis, "twelia", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      session,
      api,
      capabilities,
      on,
      log,
      ui,
      game,
      gameSide,
      group,
      storage,
      settings,
      secrets,
      time,
      request,
      http,
      notifications,
      clipboard,
      files,
      commands,
    }),
  });

  Object.defineProperty(globalThis, "__TWELIA_DISPATCH__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (type, payloadJson) => {
      const payload = JSON.parse(payloadJson);
      if (type === "command.execute") {
        const handler = commandHandlers.get(payload.commandId);
        if (handler) runHandler(handler, payload);
      }
      const listeners = [...(handlers.get(type) || [])];
      for (const listener of listeners) runHandler(listener, payload);
    },
  });

  Object.defineProperty(globalThis, "__TWELIA_FIRE_TIMER__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (id) => {
      const callback = timerCallbacks.get(id);
      if (!callback) return;
      timerCallbacks.delete(id);
      runHandler(callback);
    },
  });

  Object.defineProperty(globalThis, "__TWELIA_RESOLVE_REQUEST__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (id, payloadJson) => {
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      if (pending.timeoutId) baseTime.clearTimeout(pending.timeoutId);
      const result = JSON.parse(payloadJson);
      if (pending.abortHandler) {
        pending.signal.removeEventListener("abort", pending.abortHandler);
      }
      if (result.ok) {
        pending.resolve(result.value);
      } else {
        const error = new Error(result.error && result.error.message || "requête native refusée");
        error.code = result.error && result.error.code || "REQUEST_FAILED";
        pending.reject(error);
      }
    },
  });

  delete globalThis.__TWELIA_SESSION_JSON__;
  delete globalThis.__TWELIA_API_JSON__;
  delete globalThis.__TWELIA_CAPABILITIES_JSON__;
})();
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModInstanceState {
    Starting,
    Running,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInstanceSnapshot {
    pub mod_id: String,
    pub session_id: String,
    pub account_id: String,
    pub state: ModInstanceState,
    pub started_at: DateTime<Utc>,
    pub last_error: Option<String>,
}

enum RuntimeCommand {
    Dispatch { event: String, payload: String },
    ResolveRequest { id: u32, payload: String },
    ScheduleTimer { id: u32, delay: Duration },
    CancelTimer { id: u32 },
    Stop,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ModGroupMemberKey {
    mod_id: String,
    session_id: String,
}

#[derive(Default)]
pub struct ModGroupBus {
    members: Mutex<std::collections::HashMap<ModGroupMemberKey, Sender<RuntimeCommand>>>,
}

impl ModGroupBus {
    fn register(&self, mod_id: &str, session_id: &str, sender: Sender<RuntimeCommand>) {
        if let Ok(mut members) = self.members.lock() {
            members.insert(
                ModGroupMemberKey {
                    mod_id: mod_id.to_owned(),
                    session_id: session_id.to_owned(),
                },
                sender,
            );
        }
    }

    fn unregister(&self, mod_id: &str, session_id: &str) {
        if let Ok(mut members) = self.members.lock() {
            members.remove(&ModGroupMemberKey {
                mod_id: mod_id.to_owned(),
                session_id: session_id.to_owned(),
            });
        }
    }

    fn broadcast(
        &self,
        mod_id: &str,
        from_session_id: &str,
        from_account_id: &str,
        payload: &str,
    ) -> Result<(), AppError> {
        if payload.len() > MAX_GROUP_MESSAGE_BYTES {
            return Err(AppError::Mods("message de groupe trop volumineux".into()));
        }
        let message: Value = serde_json::from_str(payload)
            .map_err(|error| AppError::Mods(format!("message de groupe invalide: {error}")))?;
        if !message.is_object() {
            return Err(AppError::Mods(
                "un message de groupe doit Ãªtre un objet".into(),
            ));
        }
        let envelope = serde_json::to_string(&serde_json::json!({
            "fromSessionId": from_session_id,
            "fromAccountId": from_account_id,
            "message": message,
        }))
        .map_err(|error| AppError::Mods(format!("message de groupe invalide: {error}")))?;
        let members = self
            .members
            .lock()
            .map_err(|_| AppError::Mods("bus de groupe empoisonnÃ©".into()))?;
        for (key, sender) in members.iter() {
            if key.mod_id == mod_id && key.session_id != from_session_id {
                let _ = sender.send(RuntimeCommand::Dispatch {
                    event: "group.message".into(),
                    payload: envelope.clone(),
                });
            }
        }
        Ok(())
    }
}

pub struct ModRuntimeHandle {
    sender: Sender<RuntimeCommand>,
    snapshot: Arc<Mutex<ModInstanceSnapshot>>,
    join: Mutex<Option<JoinHandle<()>>>,
    game: Arc<dyn ModGameControl>,
    game_entry_source: Option<String>,
    mod_id: String,
    session_id: String,
    stopped: AtomicBool,
}

impl ModRuntimeHandle {
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        package: ModPackage,
        session_id: &str,
        account_id: &str,
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
    ) -> Result<Self, AppError> {
        let entry = package.manifest.entry_path(&package.root)?;
        let source = fs::read_to_string(&entry).map_err(|error| {
            AppError::Mods(format!(
                "lecture de {} impossible: {error}",
                entry.display()
            ))
        })?;
        let game_entry_source = package
            .manifest
            .game_entry_path(&package.root)?
            .map(|entry| {
                fs::read_to_string(&entry).map_err(|error| {
                    AppError::Mods(format!(
                        "lecture de {} impossible: {error}",
                        entry.display()
                    ))
                })
            })
            .transpose()?;
        if let Some(game_entry_source) = &game_entry_source {
            game.install_game_entry(&package.manifest.id, session_id, game_entry_source)?;
        }
        let snapshot = Arc::new(Mutex::new(ModInstanceSnapshot {
            mod_id: package.manifest.id.clone(),
            session_id: session_id.to_owned(),
            account_id: account_id.to_owned(),
            state: ModInstanceState::Starting,
            started_at: Utc::now(),
            last_error: None,
        }));
        let (sender, receiver) = mpsc::channel();
        let runtime_sender = sender.clone();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let thread_snapshot = Arc::clone(&snapshot);
        let cancelled = Arc::new(AtomicBool::new(false));
        let thread_cancelled = Arc::clone(&cancelled);
        let mod_id = package.manifest.id.clone();
        let thread_manifest = package.manifest.clone();
        let module_name = package.manifest.entry.clone();
        let thread_session_id = session_id.to_owned();
        let thread_account_id = account_id.to_owned();
        let thread_logs = Arc::clone(&logs);
        let thread_game = Arc::clone(&game);
        let has_game_entry = game_entry_source.is_some();
        let thread_name = format!(
            "twelia-mod-{}-{}",
            mod_id.chars().take(24).collect::<String>(),
            session_id.chars().take(8).collect::<String>()
        );
        let join = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                runtime_thread(
                    &mod_id,
                    &module_name,
                    &thread_session_id,
                    &thread_account_id,
                    &source,
                    receiver,
                    ready_sender,
                    thread_snapshot,
                    thread_cancelled,
                    thread_logs,
                    ui,
                    commands,
                    thread_game,
                    data,
                    settings,
                    secrets,
                    http,
                    platform,
                    group,
                    runtime_sender,
                    has_game_entry,
                    thread_manifest,
                );
            })
            .map_err(|error| {
                if has_game_entry {
                    let _ = game.unload_game_entry(&package.manifest.id, session_id);
                }
                AppError::Mods(format!("crÃ©ation du runtime impossible: {error}"))
            })?;

        match ready_receiver.recv_timeout(MAX_INITIALIZATION_WAIT) {
            Ok(Ok(())) => Ok(Self {
                sender,
                snapshot,
                join: Mutex::new(Some(join)),
                game,
                game_entry_source,
                mod_id: package.manifest.id,
                session_id: session_id.to_owned(),
                stopped: AtomicBool::new(false),
            }),
            Ok(Err(error)) => {
                let _ = join.join();
                if has_game_entry {
                    let _ = game.unload_game_entry(&package.manifest.id, session_id);
                }
                Err(AppError::Mods(error))
            }
            Err(_) => {
                cancelled.store(true, Ordering::Release);
                drop(sender);
                let _ = join.join();
                if has_game_entry {
                    let _ = game.unload_game_entry(&package.manifest.id, session_id);
                }
                Err(AppError::Mods(format!(
                    "initialisation du mod {} expirÃ©e",
                    package.manifest.id
                )))
            }
        }
    }

    pub fn snapshot(&self) -> ModInstanceSnapshot {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| ModInstanceSnapshot {
                mod_id: "unknown".into(),
                session_id: "unknown".into(),
                account_id: "unknown".into(),
                state: ModInstanceState::Failed,
                started_at: Utc::now(),
                last_error: Some("verrou d'Ã©tat du mod empoisonnÃ©".into()),
            })
    }

    pub fn dispatch(&self, event: impl Into<String>, payload: &Value) -> Result<(), AppError> {
        let payload = serde_json::to_string(payload)
            .map_err(|error| AppError::Mods(format!("Ã©vÃ©nement de mod invalide: {error}")))?;
        self.sender
            .send(RuntimeCommand::Dispatch {
                event: event.into(),
                payload,
            })
            .map_err(|_| AppError::Mods("runtime de mod arrÃªtÃ©".into()))
    }

    pub fn stop(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = self.sender.send(RuntimeCommand::Stop);
        if let Ok(mut join) = self.join.lock()
            && let Some(join) = join.take()
        {
            let _ = join.join();
        }
        if self.game_entry_source.is_some()
            && let Err(error) = self.game.unload_game_entry(&self.mod_id, &self.session_id)
        {
            log::warn!(
                "gameEntry du mod {} non dÃ©chargÃ© pour {}: {error}",
                self.mod_id,
                self.session_id
            );
        }
    }

    pub fn game_entry_source(&self) -> Option<String> {
        self.game_entry_source.clone()
    }
}

impl Drop for ModRuntimeHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

#[allow(clippy::too_many_arguments)]
fn runtime_thread(
    mod_id: &str,
    module_name: &str,
    session_id: &str,
    account_id: &str,
    source: &str,
    receiver: Receiver<RuntimeCommand>,
    ready: mpsc::SyncSender<Result<(), String>>,
    snapshot: Arc<Mutex<ModInstanceSnapshot>>,
    cancelled: Arc<AtomicBool>,
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
    runtime_sender: Sender<RuntimeCommand>,
    has_game_entry: bool,
    manifest: super::manifest::ModManifest,
) {
    group.register(mod_id, session_id, runtime_sender.clone());
    let _instance_cleanup = ModRuntimeInstanceGuard {
        ui: Arc::clone(&ui),
        commands: Arc::clone(&commands),
        group: Arc::clone(&group),
        mod_id: mod_id.to_owned(),
        session_id: session_id.to_owned(),
    };
    let deadline = Arc::new(Mutex::new(None::<Instant>));
    let interrupt_deadline = Arc::clone(&deadline);
    let interrupt_cancelled = Arc::clone(&cancelled);
    let runtime = match Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            fail_initialization(&ready, &snapshot, format!("QuickJS: {error}"));
            return;
        }
    };
    runtime.set_memory_limit(MAX_RUNTIME_MEMORY);
    runtime.set_max_stack_size(MAX_RUNTIME_STACK);
    runtime.set_interrupt_handler(Some(Box::new(move || {
        if interrupt_cancelled.load(Ordering::Acquire) {
            return true;
        }
        interrupt_deadline
            .lock()
            .map(|deadline| deadline.is_some_and(|deadline| Instant::now() >= deadline))
            .unwrap_or(true)
    })));
    let context = match Context::full(&runtime) {
        Ok(context) => context,
        Err(error) => {
            fail_initialization(&ready, &snapshot, format!("contexte QuickJS: {error}"));
            return;
        }
    };
    let session_json = match serde_json::to_string(&serde_json::json!({
        "id": session_id,
        "accountId": account_id,
    })) {
        Ok(value) => value,
        Err(error) => {
            fail_initialization(&ready, &snapshot, error.to_string());
            return;
        }
    };
    let capabilities_json = match serde_json::to_string(&manifest.capabilities) {
        Ok(value) => value,
        Err(error) => {
            fail_initialization(&ready, &snapshot, error.to_string());
            return;
        }
    };
    let api_json = serde_json::to_string(&serde_json::json!({
        "version": super::manifest::MOD_API_VERSION,
        "runtimeVersion": env!("CARGO_PKG_VERSION"),
        "features": [
        "async-requests",
        "capabilities",
        "commands",
        "declarative-settings",
        "http",
        "platform-services",
        "rich-ui",
        "secrets",
        "storage-migrations",
        "timers",
      ],
    }))
    .expect("les métadonnées statiques de l’API sont sérialisables");
    let active_requests = Arc::new(AtomicUsize::new(0));

    let initialize = execute_with_deadline(&deadline, || {
        context.with(|ctx| {
            let result: rquickjs::Result<()> = (|| {
                let native_mod_id = mod_id.to_owned();
                let native_session_id = session_id.to_owned();
                let native_logs = Arc::clone(&logs);
                let globals = ctx.globals();
                globals.set(
                    "__tweliaNativeLog",
                    Func::from(move |level: String, message: String| {
                        log_mod_message(
                            &native_logs,
                            &native_mod_id,
                            &native_session_id,
                            &level,
                            &message,
                        );
                    }),
                )?;
                let unhandled_logs = Arc::clone(&logs);
                let unhandled_mod_id = mod_id.to_owned();
                let unhandled_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeUnhandled",
                    Func::from(move |message: String| {
                        log_mod_message(
                            &unhandled_logs,
                            &unhandled_mod_id,
                            &unhandled_session_id,
                            "error",
                            &format!("Erreur asynchrone : {message}"),
                        );
                    }),
                )?;
                let native_settings = Arc::clone(&settings);
                let settings_manifest = manifest.clone();
                globals.set(
                    "__tweliaNativeSettingsGet",
                    Func::from(move || -> String {
                        let response = match native_settings.get(&settings_manifest) {
                            Ok(values) => serde_json::json!({ "values": values }),
                            Err(error) => serde_json::json!({ "error": error.to_string() }),
                        };
                        serde_json::to_string(&response).unwrap_or_else(|error| {
                            format!(r#"{{"error":"réponse de réglages invalide: {error}"}}"#)
                        })
                    }),
                )?;
                let mount_ui = Arc::clone(&ui);
                let mount_mod_id = mod_id.to_owned();
                let mount_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeUiMount",
                    Func::from(move |payload: String| -> Option<String> {
                        mount_ui
                            .mount(&mount_mod_id, &mount_session_id, &payload)
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let unmount_ui = Arc::clone(&ui);
                let unmount_mod_id = mod_id.to_owned();
                let unmount_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeUiUnmount",
                    Func::from(move |panel_id: String| -> Option<String> {
                        unmount_ui
                            .unmount(&unmount_mod_id, &unmount_session_id, &panel_id)
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let native_game = Arc::clone(&game);
                let game_mod_id = mod_id.to_owned();
                let game_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeGameCommand",
                    Func::from(move |name: String, payload: String| -> Option<String> {
                        ModGameCommand::parse(&name, &payload)
                            .and_then(|command| {
                                native_game.execute(&game_mod_id, &game_session_id, command)
                            })
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let game_side = Arc::clone(&game);
                let game_side_mod_id = mod_id.to_owned();
                let game_side_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeGameSideSend",
                    Func::from(move |event: String, payload: String| -> Option<String> {
                        if !has_game_entry {
                            return Some("ce mod ne dÃ©clare aucun gameEntry".into());
                        }
                        game_side
                            .send_game_entry_message(
                                &game_side_mod_id,
                                &game_side_session_id,
                                &event,
                                &payload,
                            )
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let native_group = Arc::clone(&group);
                let group_mod_id = mod_id.to_owned();
                let group_session_id = session_id.to_owned();
                let group_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeGroupBroadcast",
                    Func::from(move |payload: String| -> Option<String> {
                        native_group
                            .broadcast(
                                &group_mod_id,
                                &group_session_id,
                                &group_account_id,
                                &payload,
                            )
                            .err()
                        .map(|error| error.to_string())
                    }),
                )?;
                let secrets_allowed = manifest.allows_capability("secrets");
                let get_secrets = Arc::clone(&secrets);
                let get_secret_mod_id = mod_id.to_owned();
                let get_secret_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeSecretGet",
                    Func::from(move |key: String| -> String {
                        let response = if !secrets_allowed {
                            serde_json::json!({
                                "error": "la capacité secrets n’est pas accordée à ce mod"
                            })
                        } else {
                            match get_secrets.get(
                                &get_secret_mod_id,
                                &get_secret_account_id,
                                &key,
                            ) {
                                Ok(Some(value)) => serde_json::json!({
                                    "found": true,
                                    "value": value,
                                }),
                                Ok(None) => serde_json::json!({ "found": false }),
                                Err(error) => serde_json::json!({ "error": error.to_string() }),
                            }
                        };
                        serde_json::to_string(&response).unwrap_or_else(|error| {
                            format!(r#"{{"error":"réponse de secret invalide: {error}"}}"#)
                        })
                    }),
                )?;
                let set_secrets = Arc::clone(&secrets);
                let set_secret_mod_id = mod_id.to_owned();
                let set_secret_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeSecretSet",
                    Func::from(move |key: String, value: String| -> Option<String> {
                        if !secrets_allowed {
                            return Some(
                                "la capacité secrets n’est pas accordée à ce mod".into(),
                            );
                        }
                        set_secrets
                            .set(&set_secret_mod_id, &set_secret_account_id, &key, &value)
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let remove_secrets = Arc::clone(&secrets);
                let remove_secret_mod_id = mod_id.to_owned();
                let remove_secret_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeSecretRemove",
                    Func::from(move |key: String| -> Option<String> {
                        if !secrets_allowed {
                            return Some(
                                "la capacité secrets n’est pas accordée à ce mod".into(),
                            );
                        }
                        remove_secrets
                            .remove(
                                &remove_secret_mod_id,
                                &remove_secret_account_id,
                                &key,
                            )
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let get_data = Arc::clone(&data);
                let get_mod_id = mod_id.to_owned();
                let get_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageGet",
                    Func::from(move |key: String| -> String {
                        let response = match get_data.get(&get_mod_id, &get_account_id, &key) {
                            Ok(Some(value)) => serde_json::json!({
                                "found": true,
                                "value": value,
                            }),
                            Ok(None) => serde_json::json!({ "found": false }),
                            Err(error) => serde_json::json!({ "error": error.to_string() }),
                        };
                        serde_json::to_string(&response).unwrap_or_else(|error| {
                            format!(r#"{{"error":"réponse de stockage invalide: {error}"}}"#)
                        })
                    }),
                )?;
                let set_data = Arc::clone(&data);
                let set_mod_id = mod_id.to_owned();
                let set_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageSet",
                    Func::from(move |key: String, payload: String| -> Option<String> {
                        serde_json::from_str(&payload)
                            .map_err(|error| {
                                AppError::Mods(format!("valeur persistante invalide: {error}"))
                            })
                            .and_then(|value| {
                                set_data.set(&set_mod_id, &set_account_id, &key, value)
                            })
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let remove_data = Arc::clone(&data);
                let remove_mod_id = mod_id.to_owned();
                let remove_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageRemove",
                    Func::from(move |key: String| -> Option<String> {
                        remove_data
                            .remove(&remove_mod_id, &remove_account_id, &key)
                            .err()
                        .map(|error| error.to_string())
                    }),
                )?;
                let snapshot_data = Arc::clone(&data);
                let snapshot_mod_id = mod_id.to_owned();
                let snapshot_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageSnapshot",
                    Func::from(move || -> String {
                        let response = match snapshot_data
                            .snapshot(&snapshot_mod_id, &snapshot_account_id)
                        {
                            Ok((version, values)) => serde_json::json!({
                                "version": version,
                                "values": values,
                            }),
                            Err(error) => serde_json::json!({ "error": error.to_string() }),
                        };
                        serde_json::to_string(&response).unwrap_or_else(|error| {
                            format!(r#"{{"error":"snapshot de stockage invalide: {error}"}}"#)
                        })
                    }),
                )?;
                let replace_data = Arc::clone(&data);
                let replace_mod_id = mod_id.to_owned();
                let replace_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageReplace",
                    Func::from(
                        move |version: u32, payload: String| -> Option<String> {
                            serde_json::from_str::<std::collections::BTreeMap<String, Value>>(
                                &payload,
                            )
                            .map_err(|error| {
                                AppError::Mods(format!(
                                    "transaction de stockage invalide: {error}"
                                ))
                            })
                            .and_then(|values| {
                                replace_data.replace(
                                    &replace_mod_id,
                                    &replace_account_id,
                                    version,
                                    values,
                                )
                            })
                            .err()
                            .map(|error| error.to_string())
                        },
                    ),
                )?;
                let quota_data = Arc::clone(&data);
                let quota_mod_id = mod_id.to_owned();
                let quota_account_id = account_id.to_owned();
                globals.set(
                    "__tweliaNativeStorageQuota",
                    Func::from(move || -> String {
                        let response = match quota_data.quota(&quota_mod_id, &quota_account_id) {
                            Ok((used_keys, max_keys, used_bytes, max_bytes)) => serde_json::json!({
                                "usedKeys": used_keys,
                                "maxKeys": max_keys,
                                "usedBytes": used_bytes,
                                "maxBytes": max_bytes,
                            }),
                            Err(error) => serde_json::json!({ "error": error.to_string() }),
                        };
                        serde_json::to_string(&response).unwrap_or_else(|error| {
                            format!(r#"{{"error":"quota de stockage invalide: {error}"}}"#)
                        })
                    }),
                )?;
                let register_commands = Arc::clone(&commands);
                let register_mod_id = mod_id.to_owned();
                let register_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeCommandRegister",
                    Func::from(move |payload: String| -> Option<String> {
                        register_commands
                            .register(&register_mod_id, &register_session_id, &payload)
                            .err()
                            .map(|error| error.to_string())
                    }),
                )?;
                let unregister_commands = Arc::clone(&commands);
                let unregister_mod_id = mod_id.to_owned();
                let unregister_session_id = session_id.to_owned();
                globals.set(
                    "__tweliaNativeCommandUnregister",
                    Func::from(move |command_id: String| {
                        let _ = unregister_commands.unregister(
                            &unregister_mod_id,
                            &unregister_session_id,
                            &command_id,
                        );
                    }),
                )?;
                let request_sender = runtime_sender.clone();
                let request_http = Arc::clone(&http);
                let request_platform = platform.clone();
                let request_manifest = manifest.clone();
                let request_mod_id = mod_id.to_owned();
                let request_session_id = session_id.to_owned();
                let request_active = Arc::clone(&active_requests);
                globals.set(
                    "__tweliaNativeRequest",
                    Func::from(
                        move |id: u32, service: String, payload: String| -> Option<String> {
                            if !matches!(
                                service.as_str(),
                                "http.request"
                                    | "clipboard.write"
                                    | "notifications.show"
                                    | "files.pick-text"
                                    | "files.save-text"
                            ) {
                                return Some(format!("service natif inconnu: {service}"));
                            }
                            if request_active
                                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                                    (active < MAX_ACTIVE_REQUESTS).then_some(active + 1)
                                })
                                .is_err()
                            {
                                return Some("trop de requêtes natives actives".into());
                            }
                            let worker_sender = request_sender.clone();
                            let worker_http = Arc::clone(&request_http);
                            let worker_platform = request_platform.clone();
                            let worker_manifest = request_manifest.clone();
                            let worker_mod_id = request_mod_id.clone();
                            let worker_session_id = request_session_id.clone();
                            let worker_active = Arc::clone(&request_active);
                            let thread = thread::Builder::new()
                                .name(format!("twelia-mod-request-{id}"))
                                .spawn(move || {
                                    let result = if service == "http.request" {
                                        worker_http.execute(&worker_manifest, &payload)
                                    } else if let Some(platform) = worker_platform {
                                        platform.execute(
                                            &worker_manifest,
                                            &worker_mod_id,
                                            &worker_session_id,
                                            &service,
                                            &payload,
                                        )
                                    } else {
                                        Err(AppError::Mods(
                                            "les services de plateforme sont indisponibles".into(),
                                        ))
                                    };
                                    let response = match result {
                                        Ok(value) => serde_json::json!({
                                            "ok": true,
                                            "value": value,
                                        }),
                                        Err(error) => serde_json::json!({
                                            "ok": false,
                                            "error": {
                                                "code": "REQUEST_FAILED",
                                                "message": error.to_string(),
                                            },
                                        }),
                                    };
                                    let payload = serde_json::to_string(&response).unwrap_or_else(
                                        |_| r#"{"ok":false,"error":{"code":"SERIALIZATION_ERROR","message":"réponse native invalide"}}"#.into(),
                                    );
                                    let _ = worker_sender
                                        .send(RuntimeCommand::ResolveRequest { id, payload });
                                    worker_active.fetch_sub(1, Ordering::AcqRel);
                                });
                            if let Err(error) = thread {
                                request_active.fetch_sub(1, Ordering::AcqRel);
                                return Some(format!("création de la requête impossible: {error}"));
                            }
                            None
                        },
                    ),
                )?;
                let schedule_sender = runtime_sender.clone();
                globals.set(
                    "__tweliaNativeScheduleTimer",
                    Func::from(move |id: u32, delay_ms: u32| -> Option<String> {
                        if !(MIN_TIMER_DELAY_MS..=MAX_TIMER_DELAY_MS).contains(&delay_ms) {
                            return Some("délai de minuteur invalide".into());
                        }
                        schedule_sender
                            .send(RuntimeCommand::ScheduleTimer {
                                id,
                                delay: Duration::from_millis(u64::from(delay_ms)),
                            })
                            .err()
                            .map(|_| "runtime de mod arrêté".into())
                    }),
                )?;
                let cancel_sender = runtime_sender.clone();
                globals.set(
                    "__tweliaNativeCancelTimer",
                    Func::from(move |id: u32| {
                        let _ = cancel_sender.send(RuntimeCommand::CancelTimer { id });
                    }),
                )?;
                globals.set("__TWELIA_SESSION_JSON__", session_json.clone())?;
                globals.set("__TWELIA_API_JSON__", api_json.clone())?;
                globals.set(
                    "__TWELIA_CAPABILITIES_JSON__",
                    capabilities_json.clone(),
                )?;
                ctx.eval::<(), _>(MOD_BOOTSTRAP)?;
                let promise = Module::evaluate(ctx.clone(), module_name, source)?;
                promise.finish::<()>()?;
                dispatch_in_context(&ctx, "load", "{}")?;
                Ok(())
            })();
            result.catch(&ctx).map_err(|error| error.to_string())
        })
    });
    if let Err(error) = initialize {
        fail_initialization(&ready, &snapshot, error);
        return;
    }
    update_snapshot(&snapshot, ModInstanceState::Running, None);
    if ready.send(Ok(())).is_err() {
        return;
    }

    let mut timers = std::collections::HashMap::<u32, Instant>::new();
    loop {
        let now = Instant::now();
        if let Some(timer_id) = timers
            .iter()
            .find_map(|(id, due)| (*due <= now).then_some(*id))
        {
            timers.remove(&timer_id);
            let result = execute_with_deadline(&deadline, || {
                context.with(|ctx| {
                    fire_timer_in_context(&ctx, timer_id)
                        .catch(&ctx)
                        .map_err(|error| error.to_string())
                })
            });
            if let Err(error) = result {
                fail_runtime(&logs, mod_id, session_id, &snapshot, error);
                return;
            }
            continue;
        }

        let command = if let Some(next_due) = timers.values().min() {
            match receiver.recv_timeout(next_due.saturating_duration_since(now)) {
                Ok(command) => command,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match receiver.recv() {
                Ok(command) => command,
                Err(_) => break,
            }
        };
        match command {
            RuntimeCommand::Dispatch { event, payload } => {
                let result = execute_with_deadline(&deadline, || {
                    context.with(|ctx| {
                        dispatch_in_context(&ctx, &event, &payload)
                            .catch(&ctx)
                            .map_err(|error| error.to_string())
                    })
                });
                if let Err(error) = result {
                    fail_runtime(&logs, mod_id, session_id, &snapshot, error);
                    return;
                }
            }
            RuntimeCommand::ResolveRequest { id, payload } => {
                let result = execute_with_deadline(&deadline, || {
                    context.with(|ctx| {
                        resolve_request_in_context(&ctx, id, &payload)
                            .catch(&ctx)
                            .map_err(|error| error.to_string())
                    })
                });
                if let Err(error) = result {
                    fail_runtime(&logs, mod_id, session_id, &snapshot, error);
                    return;
                }
            }
            RuntimeCommand::ScheduleTimer { id, delay } => {
                if timers.contains_key(&id) || timers.len() < MAX_ACTIVE_TIMERS {
                    timers.insert(id, Instant::now() + delay);
                }
            }
            RuntimeCommand::CancelTimer { id } => {
                timers.remove(&id);
            }
            RuntimeCommand::Stop => {
                let _ = execute_with_deadline(&deadline, || {
                    context.with(|ctx| dispatch_in_context(&ctx, "unload", "{}"))
                });
                update_snapshot(&snapshot, ModInstanceState::Stopped, None);
                return;
            }
        }
    }
    update_snapshot(&snapshot, ModInstanceState::Stopped, None);
}

fn fail_runtime(
    logs: &ModLogBuffer,
    mod_id: &str,
    session_id: &str,
    snapshot: &Arc<Mutex<ModInstanceSnapshot>>,
    error: String,
) {
    logs.push(
        mod_id,
        session_id,
        "error",
        &format!("Runtime arrÃªtÃ© : {error}"),
    );
    log::error!("mod {mod_id} ({session_id}) arrÃªtÃ©: {error}");
    update_snapshot(snapshot, ModInstanceState::Failed, Some(error));
}

struct ModRuntimeInstanceGuard {
    ui: Arc<ModUiStore>,
    commands: Arc<ModCommandStore>,
    group: Arc<ModGroupBus>,
    mod_id: String,
    session_id: String,
}

impl Drop for ModRuntimeInstanceGuard {
    fn drop(&mut self) {
        self.ui.clear_instance(&self.mod_id, &self.session_id);
        self.commands.clear_instance(&self.mod_id, &self.session_id);
        self.group.unregister(&self.mod_id, &self.session_id);
    }
}

fn dispatch_in_context<'js>(
    ctx: &rquickjs::Ctx<'js>,
    event: &str,
    payload: &str,
) -> rquickjs::Result<()> {
    let dispatch: Function<'js> = ctx.globals().get("__TWELIA_DISPATCH__")?;
    dispatch.call::<_, ()>((event, payload))?;
    drain_pending_jobs(ctx);
    Ok(())
}

fn fire_timer_in_context<'js>(ctx: &rquickjs::Ctx<'js>, id: u32) -> rquickjs::Result<()> {
    let dispatch: Function<'js> = ctx.globals().get("__TWELIA_FIRE_TIMER__")?;
    dispatch.call::<_, ()>((id,))?;
    drain_pending_jobs(ctx);
    Ok(())
}

fn resolve_request_in_context<'js>(
    ctx: &rquickjs::Ctx<'js>,
    id: u32,
    payload: &str,
) -> rquickjs::Result<()> {
    let resolve: Function<'js> = ctx.globals().get("__TWELIA_RESOLVE_REQUEST__")?;
    resolve.call::<_, ()>((id, payload))?;
    drain_pending_jobs(ctx);
    Ok(())
}

fn drain_pending_jobs(ctx: &rquickjs::Ctx<'_>) {
    for _ in 0..1_024 {
        if !ctx.execute_pending_job() {
            break;
        }
    }
}

fn execute_with_deadline<T>(
    deadline: &Arc<Mutex<Option<Instant>>>,
    operation: impl FnOnce() -> T,
) -> T {
    if let Ok(mut current) = deadline.lock() {
        *current = Some(Instant::now() + MAX_EXECUTION_TIME);
    }
    let result = operation();
    if let Ok(mut current) = deadline.lock() {
        *current = None;
    }
    result
}

fn fail_initialization(
    ready: &mpsc::SyncSender<Result<(), String>>,
    snapshot: &Arc<Mutex<ModInstanceSnapshot>>,
    error: String,
) {
    update_snapshot(snapshot, ModInstanceState::Failed, Some(error.clone()));
    let _ = ready.send(Err(error));
}

fn update_snapshot(
    snapshot: &Arc<Mutex<ModInstanceSnapshot>>,
    state: ModInstanceState,
    error: Option<String>,
) {
    if let Ok(mut snapshot) = snapshot.lock() {
        snapshot.state = state;
        snapshot.last_error = error;
    }
}

fn log_mod_message(
    logs: &ModLogBuffer,
    mod_id: &str,
    session_id: &str,
    level: &str,
    message: &str,
) {
    let message = message.replace(['\r', '\n'], " ");
    let message = message.chars().take(4_096).collect::<String>();
    logs.push(mod_id, session_id, level, &message);
    match level {
        "debug" => log::debug!("mod {mod_id} ({session_id}): {message}"),
        "warn" => log::warn!("mod {mod_id} ({session_id}): {message}"),
        "error" => log::error!("mod {mod_id} ({session_id}): {message}"),
        _ => log::info!("mod {mod_id} ({session_id}): {message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mods::manifest::ModManifest;
    use std::path::Path;

    fn package(root: &Path, source: &str) -> ModPackage {
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("dist/main.js"), source).unwrap();
        ModPackage {
            manifest: ModManifest {
                schema_version: 1,
                id: "dev.twelia.runtime-test".into(),
                name: "Runtime test".into(),
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
            },
            root: root.to_path_buf(),
        }
    }

    fn package_with_game_entry(root: &Path, source: &str, game_source: &str) -> ModPackage {
        let mut package = package(root, source);
        fs::write(root.join("dist/game.js"), game_source).unwrap();
        package.manifest.game_entry = Some("dist/game.js".into());
        package.manifest.capabilities = vec!["game-entry".into()];
        package
    }

    fn data_store(root: &Path) -> Arc<ModDataStore> {
        Arc::new(ModDataStore::new(root.join("data")).unwrap())
    }

    fn command_store() -> Arc<ModCommandStore> {
        Arc::new(ModCommandStore::default())
    }

    fn settings_store(root: &Path) -> Arc<ModSettingsStore> {
        Arc::new(ModSettingsStore::new(root.join("settings")).unwrap())
    }

    fn secret_store(root: &Path) -> Arc<ModSecretStore> {
        Arc::new(ModSecretStore::new(root.join("secrets")).unwrap())
    }

    fn http_client() -> Arc<ModHttpClient> {
        Arc::new(ModHttpClient::new().unwrap())
    }

    #[test]
    fn starts_and_dispatches_into_an_isolated_runtime() {
        let root = tempfile::tempdir().unwrap();
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    twelia.on("probe", ({ value }) => {
                      if (value !== 42) throw new Error("unexpected value");
                    });
                    twelia.log.info(`ready:${twelia.session.id}`);
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            unavailable_game_control(),
            data_store(root.path()),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();
        assert_eq!(runtime.snapshot().state, ModInstanceState::Running);
        runtime
            .dispatch("probe", &serde_json::json!({ "value": 42 }))
            .unwrap();
        runtime.stop();
        assert_eq!(runtime.snapshot().state, ModInstanceState::Stopped);
    }

    #[test]
    fn exposes_persistent_storage_scoped_to_the_mod_and_account() {
        let root = tempfile::tempdir().unwrap();
        let data = data_store(root.path());
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    const profile = twelia.storage.get("profile", { tempoMs: 900 });
                    profile.movement = "approach";
                    twelia.storage.set("profile", profile);
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            unavailable_game_control(),
            Arc::clone(&data),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();
        runtime.stop();

        assert_eq!(
            data.get("dev.twelia.runtime-test", "account-a", "profile")
                .unwrap(),
            Some(serde_json::json!({
                "tempoMs": 900,
                "movement": "approach"
            }))
        );
    }

    #[test]
    fn runs_bounded_mod_timers_without_blocking_the_runtime() {
        let root = tempfile::tempdir().unwrap();
        let data = data_store(root.path());
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    twelia.time.setTimeout(() => {
                      twelia.storage.set("timer-fired", true);
                    }, 50);
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            unavailable_game_control(),
            Arc::clone(&data),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();

        let deadline = Instant::now() + Duration::from_secs(1);
        while data
            .get("dev.twelia.runtime-test", "account-a", "timer-fired")
            .unwrap()
            != Some(Value::Bool(true))
        {
            assert!(
                Instant::now() < deadline,
                "le minuteur n'a pas Ã©tÃ© exÃ©cutÃ©"
            );
            thread::sleep(Duration::from_millis(5));
        }
        runtime.stop();
    }

    #[test]
    fn migrates_storage_atomically_and_reports_quota() {
        let root = tempfile::tempdir().unwrap();
        let data = data_store(root.path());
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    twelia.storage.set("legacy", 2);
                    const migrated = twelia.storage.migrate(2, {
                      1: (values) => ({ counter: values.legacy + 1 }),
                      2: (values) => ({ ...values, ready: true }),
                    });
                    const quota = twelia.storage.quota();
                    twelia.storage.set("migration-ok", migrated.ready && quota.maxKeys >= 32);
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            unavailable_game_control(),
            Arc::clone(&data),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();
        runtime.stop();

        let (version, values) = data
            .snapshot("dev.twelia.runtime-test", "account-a")
            .unwrap();
        assert_eq!(version, 2);
        assert_eq!(values["counter"], 3);
        assert_eq!(values["ready"], true);
        assert_eq!(values["migration-ok"], true);
        assert!(!values.contains_key("legacy"));
    }

    #[test]
    fn resolves_native_requests_runs_intervals_and_cleans_commands() {
        let root = tempfile::tempdir().unwrap();
        let data = data_store(root.path());
        let commands = command_store();
        let mut package = package(
            root.path(),
            r#"
                twelia.commands.register({
                  id: "probe",
                  title: "Probe",
                  execute: () => twelia.storage.set("command-fired", true),
                });
                let ticks = 0;
                const interval = twelia.time.setInterval(() => {
                  ticks += 1;
                  if (ticks === 2) {
                    twelia.time.clearInterval(interval);
                    twelia.storage.set("interval-fired", true);
                  }
                }, 50);
                twelia.request("notifications.show", { title: "Test", body: "Test" })
                  .catch((error) => twelia.storage.set("request-error", error.code));
            "#,
        );
        package.manifest.capabilities = vec!["notifications".into()];
        let runtime = ModRuntimeHandle::start(
            package,
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            Arc::clone(&commands),
            unavailable_game_control(),
            Arc::clone(&data),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();

        assert_eq!(commands.list().len(), 1);
        runtime
            .dispatch(
                "command.execute",
                &serde_json::json!({ "commandId": "probe", "sessionId": "session-a" }),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let interval = data
                .get("dev.twelia.runtime-test", "account-a", "interval-fired")
                .unwrap();
            let request = data
                .get("dev.twelia.runtime-test", "account-a", "request-error")
                .unwrap();
            let command = data
                .get("dev.twelia.runtime-test", "account-a", "command-fired")
                .unwrap();
            if interval == Some(Value::Bool(true))
                && request == Some(Value::String("REQUEST_FAILED".into()))
                && command == Some(Value::Bool(true))
            {
                break;
            }
            assert!(Instant::now() < deadline, "travail asynchrone non terminé");
            thread::sleep(Duration::from_millis(10));
        }
        runtime.stop();
        assert!(commands.list().is_empty());
    }

    #[test]
    fn interrupts_an_infinite_module() {
        let root = tempfile::tempdir().unwrap();
        let started = Instant::now();
        let result = ModRuntimeHandle::start(
            package(root.path(), "while (true) {}"),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            unavailable_game_control(),
            data_store(root.path()),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        );
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn mounts_ui_and_clears_it_when_the_runtime_stops() {
        let root = tempfile::tempdir().unwrap();
        let ui = Arc::new(ModUiStore::default());
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    twelia.ui.mount({
                      id: "main",
                      title: "Runtime test",
                      components: [
                        { type: "text", id: "status", text: "Initial" },
                        { type: "button", id: "probe", label: "Probe" }
                      ],
                    });
                    twelia.ui.patch("main", { "status.text": "Updated" });
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::clone(&ui),
            command_store(),
            unavailable_game_control(),
            data_store(root.path()),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();

        let panels = ui.list("session-a");
        assert_eq!(panels.len(), 1);
        assert_eq!(panels[0].components[0]["text"], "Updated");
        runtime.stop();
        assert!(ui.list("session-a").is_empty());
    }

    #[derive(Default)]
    struct RecordingGameControl {
        commands: Mutex<Vec<(String, String, ModGameCommand)>>,
        installed: Mutex<Vec<(String, String, String)>>,
        messages: Mutex<Vec<(String, String, String, String)>>,
        unloaded: Mutex<Vec<(String, String)>>,
    }

    impl ModGameControl for RecordingGameControl {
        fn execute(
            &self,
            mod_id: &str,
            session_id: &str,
            command: ModGameCommand,
        ) -> Result<(), AppError> {
            self.commands
                .lock()
                .unwrap()
                .push((mod_id.to_owned(), session_id.to_owned(), command));
            Ok(())
        }

        fn install_game_entry(
            &self,
            mod_id: &str,
            session_id: &str,
            source: &str,
        ) -> Result<(), AppError> {
            self.installed.lock().unwrap().push((
                mod_id.to_owned(),
                session_id.to_owned(),
                source.to_owned(),
            ));
            Ok(())
        }

        fn unload_game_entry(&self, mod_id: &str, session_id: &str) -> Result<(), AppError> {
            self.unloaded
                .lock()
                .unwrap()
                .push((mod_id.to_owned(), session_id.to_owned()));
            Ok(())
        }

        fn send_game_entry_message(
            &self,
            mod_id: &str,
            session_id: &str,
            event: &str,
            payload: &str,
        ) -> Result<(), AppError> {
            self.messages.lock().unwrap().push((
                mod_id.to_owned(),
                session_id.to_owned(),
                event.to_owned(),
                payload.to_owned(),
            ));
            Ok(())
        }
    }

    #[test]
    fn exposes_scoped_game_commands_to_the_runtime() {
        let root = tempfile::tempdir().unwrap();
        let recording = Arc::new(RecordingGameControl::default());
        let game: Arc<dyn ModGameControl> = recording.clone();
        let runtime = ModRuntimeHandle::start(
            package(
                root.path(),
                r#"
                    twelia.game.observeMap();
                    twelia.game.moveToCell(42);
                    twelia.game.changeMap("right");
                    twelia.game.attackMonster(-42);
                    twelia.game.joinPartyFight(7, 8);
                    twelia.game.observeFight();
                    twelia.game.setFightPlacement(123);
                    twelia.game.moveInFight(321);
                    twelia.game.castFightSpell(8139, 365);
                    twelia.game.fightReady();
                    twelia.game.finishFightTurn();
                "#,
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            game,
            data_store(root.path()),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();

        assert_eq!(
            recording.commands.lock().unwrap().as_slice(),
            &[
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::ObserveMap
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::MoveToCell(42)
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::ChangeMap("right".into())
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::AttackMonster(-42)
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::JoinPartyFight {
                        fight_id: 7,
                        fighter_id: 8
                    }
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::ObserveFight
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::SetFightPlacement(123)
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::MoveInFight(321)
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::CastFightSpell {
                        spell_id: 8139,
                        target_cell_id: 365,
                    }
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::FightReady
                ),
                (
                    "dev.twelia.runtime-test".into(),
                    "session-a".into(),
                    ModGameCommand::FinishFightTurn
                )
            ]
        );
        runtime.stop();
    }

    #[test]
    fn installs_and_connects_the_optional_game_entry() {
        let root = tempfile::tempdir().unwrap();
        let recording = Arc::new(RecordingGameControl::default());
        let game: Arc<dyn ModGameControl> = recording.clone();
        let runtime = ModRuntimeHandle::start(
            package_with_game_entry(
                root.path(),
                r#"twelia.gameSide.send("probe", { value: 42 });"#,
                "tweliaGame.on('probe', () => {});",
            ),
            "session-a",
            "account-a",
            Arc::new(ModLogBuffer::default()),
            Arc::new(ModUiStore::default()),
            command_store(),
            game,
            data_store(root.path()),
            settings_store(root.path()),
            secret_store(root.path()),
            http_client(),
            None,
            Arc::new(ModGroupBus::default()),
        )
        .unwrap();

        assert_eq!(recording.installed.lock().unwrap().len(), 1);
        let messages = recording.messages.lock().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].2, "probe");
        assert_eq!(
            serde_json::from_str::<Value>(&messages[0].3).unwrap(),
            serde_json::json!({ "value": 42 })
        );
        drop(messages);

        runtime.stop();
        assert_eq!(
            recording.unloaded.lock().unwrap().as_slice(),
            &[("dev.twelia.runtime-test".into(), "session-a".into())]
        );
    }

    #[test]
    fn group_bus_only_broadcasts_to_other_sessions_running_the_same_mod() {
        let bus = ModGroupBus::default();
        let (sender_a, receiver_a) = mpsc::channel();
        let (sender_b, receiver_b) = mpsc::channel();
        let (sender_other, receiver_other) = mpsc::channel();
        bus.register("dev.twelia.hunt", "session-a", sender_a);
        bus.register("dev.twelia.hunt", "session-b", sender_b);
        bus.register("dev.twelia.other", "session-c", sender_other);

        bus.broadcast(
            "dev.twelia.hunt",
            "session-a",
            "account-a",
            r#"{"type":"hunt.configure","enabled":true}"#,
        )
        .unwrap();

        assert!(receiver_a.try_recv().is_err());
        assert!(receiver_other.try_recv().is_err());
        let RuntimeCommand::Dispatch { event, payload } =
            receiver_b.recv_timeout(Duration::from_secs(1)).unwrap()
        else {
            panic!("un message de groupe doit produire un Ã©vÃ©nement");
        };
        assert_eq!(event, "group.message");
        assert_eq!(
            serde_json::from_str::<Value>(&payload).unwrap(),
            serde_json::json!({
                "fromSessionId": "session-a",
                "fromAccountId": "account-a",
                "message": { "type": "hunt.configure", "enabled": true }
            })
        );
    }
}
