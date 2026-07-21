import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../platform/platform";
import type { InstalledMod, ModCommand, ModInstance, ModLogEntry, ModUiPanel } from "./modTypes";

export async function listInstalledMods(): Promise<InstalledMod[]> {
  if (!isTauriRuntime()) return [];
  return invoke<InstalledMod[]>("list_installed_mods");
}

export async function createModProject(name: string): Promise<InstalledMod> {
  if (!isTauriRuntime()) {
    throw new Error("La création de mods est disponible dans l’application Twelia.");
  }
  return invoke<InstalledMod>("create_mod_project", { name });
}

export async function openModEntry(modId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("open_mod_entry", { modId });
}

export async function openModGameEntry(modId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("open_mod_game_entry", { modId });
}

export async function getModsEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("get_mods_enabled");
}

export async function setModsEnabled(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_mods_enabled", { enabled });
}

export async function setModEnabled(modId: string, enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_mod_enabled", { modId, enabled });
}

export async function getModSettings(modId: string): Promise<Record<string, unknown>> {
  if (!isTauriRuntime()) return {};
  return invoke<Record<string, unknown>>("get_mod_settings", { modId });
}

export async function setModSetting(
  modId: string,
  key: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  if (!isTauriRuntime()) return {};
  return invoke<Record<string, unknown>>("set_mod_setting", { modId, key, value });
}

export async function resetModSettings(modId: string): Promise<Record<string, unknown>> {
  if (!isTauriRuntime()) return {};
  return invoke<Record<string, unknown>>("reset_mod_settings", { modId });
}

export async function listModInstances(): Promise<ModInstance[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ModInstance[]>("list_mod_instances");
}

export async function loadModInstance(sessionId: string, modId: string): Promise<ModInstance> {
  if (!isTauriRuntime()) {
    throw new Error("Le runtime de mods est disponible dans l’application Twelia.");
  }
  return invoke<ModInstance>("load_mod_instance", { sessionId, modId });
}

export async function unloadModInstance(sessionId: string, modId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("unload_mod_instance", { sessionId, modId });
}

export async function reloadModInstance(sessionId: string, modId: string): Promise<ModInstance> {
  if (!isTauriRuntime()) throw new Error("Le runtime de mods est indisponible.");
  return invoke<ModInstance>("reload_mod_instance", { sessionId, modId });
}

export async function reloadModInstances(modId: string): Promise<ModInstance[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ModInstance[]>("reload_mod_instances", { modId });
}

export async function listModLogs(sessionId: string): Promise<ModLogEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ModLogEntry[]>("list_mod_logs", { sessionId });
}

export async function clearModLogs(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("clear_mod_logs", { sessionId });
}

export async function listModCommands(): Promise<ModCommand[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ModCommand[]>("list_mod_commands");
}

export async function dispatchModCommand(command: ModCommand): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("dispatch_mod_command", {
    modId: command.modId,
    sessionId: command.sessionId,
    commandId: command.id,
  });
}

export async function listModUiPanels(sessionId: string): Promise<ModUiPanel[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ModUiPanel[]>("list_mod_ui_panels", { sessionId });
}

export async function dispatchModUiAction(
  sessionId: string,
  modId: string,
  panelId: string,
  actionId: string,
  value?: unknown,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("dispatch_mod_ui_action", {
    sessionId,
    modId,
    panelId,
    actionId,
    value: value ?? null,
  });
}
