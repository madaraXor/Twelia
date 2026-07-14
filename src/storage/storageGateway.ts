import { invoke } from "@tauri-apps/api/core";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { isTauriRuntime } from "../platform/platform";

export type StateDocument = "accounts" | "workspace" | "settings" | "shortcuts";

export interface StorageGateway {
  load<T>(document: StateDocument): Promise<T | null>;
  save<T>(document: StateDocument, value: T): Promise<void>;
}

const browserKey = (document: StateDocument) => `twelia:${document}:v1`;
const STATE_LOAD_TIMEOUT_MS = 2_500;

class StateLoadTimeoutError extends Error {}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new StateLoadTimeoutError("La restauration locale ne répond pas.")),
      timeoutMs,
    );
    void operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function loadStateWithRetry<T>(
  load: () => Promise<T>,
  timeoutMs = STATE_LOAD_TIMEOUT_MS,
): Promise<T> {
  try {
    return await withTimeout(load(), timeoutMs);
  } catch (error) {
    if (!(error instanceof StateLoadTimeoutError)) throw error;
    diagnosticLogger.warn("storage", "Première lecture locale sans réponse, nouvelle tentative");
    return withTimeout(load(), timeoutMs);
  }
}

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
    return loadStateWithRetry(() => invoke<T | null>("load_state", { document }));
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
