import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../platform/platform";

export type ClientStatus = {
  installed: boolean;
  version?: string;
  path: string;
  usedBytes: number;
  updateAvailable: boolean;
  integrity: "unknown" | "valid" | "issues";
};

export type ClientInstallProgress = {
  phase: string;
  message: string;
  percent: number;
};

export type ClientInstallOutcome = {
  version: string;
  buildVersion: string;
  appVersion: string;
  downloadedFiles: number;
  downloadedBytes: number;
  compatibilityPatches: number;
};

export const EMPTY_CLIENT_STATUS: ClientStatus = {
  installed: false,
  path: "Non configuré",
  usedBytes: 0,
  updateAvailable: false,
  integrity: "unknown",
};

export async function getClientStatus(): Promise<ClientStatus> {
  if (!isTauriRuntime()) return EMPTY_CLIENT_STATUS;
  return invoke<ClientStatus>("get_client_status");
}

export async function installGameClient(): Promise<ClientInstallOutcome> {
  if (!isTauriRuntime()) {
    throw new Error("L’installation est disponible dans l’application Tauri.");
  }
  return invoke<ClientInstallOutcome>("install_game_client");
}

export async function onClientInstallProgress(
  callback: (progress: ClientInstallProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<ClientInstallProgress>("client-install-progress", (event) =>
    callback(event.payload),
  );
}
