import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../platform/platform";

export type StateDocument = "accounts" | "workspace" | "settings" | "shortcuts";

export interface StorageGateway {
  load<T>(document: StateDocument): Promise<T | null>;
  save<T>(document: StateDocument, value: T): Promise<void>;
}

const browserKey = (document: StateDocument) => `twelia:${document}:v1`;

export class TauriStorageGateway implements StorageGateway {
  async load<T>(document: StateDocument): Promise<T | null> {
    if (!isTauriRuntime()) {
      const raw = localStorage.getItem(browserKey(document));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        localStorage.removeItem(browserKey(document));
        return null;
      }
    }
    return invoke<T | null>("load_state", { document });
  }

  async save<T>(document: StateDocument, value: T): Promise<void> {
    if (!isTauriRuntime()) {
      localStorage.setItem(browserKey(document), JSON.stringify(value));
      return;
    }
    await invoke("save_state", { document, value });
  }
}

export const storageGateway = new TauriStorageGateway();
