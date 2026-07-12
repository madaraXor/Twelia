import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../platform/platform";
import type { GameSession, SessionRuntime } from "./gameTypes";
import { createId } from "../core/id";

export type GameViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function layoutGameSession(sessionId: string, bounds: GameViewBounds): Promise<void> {
  if (isTauriRuntime()) await invoke("layout_game_session", { sessionId, bounds });
}

export async function getGameSessionUrl(sessionId: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("URL du runtime indisponible hors de Tauri.");
  return invoke<string>("get_game_session_url", { sessionId });
}

export async function setGameSessionVisibility(sessionId: string, visible: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_game_session_visibility", { sessionId, visible });
  if (visible) window.dispatchEvent(new Event("resize"));
}

export async function keepGameSessionActive(sessionId: string): Promise<void> {
  if (isTauriRuntime()) await invoke("keep_game_session_active", { sessionId });
}

export async function configureGameSessionShortcuts(
  sessionId: string,
  accelerators: string[],
): Promise<void> {
  if (isTauriRuntime()) await invoke("configure_game_shortcuts", { sessionId, accelerators });
}

export class TauriGameRuntime implements SessionRuntime {
  async create(accountId: string): Promise<GameSession> {
    if (isTauriRuntime()) return invoke<GameSession>("create_game_session", { accountId });
    const now = new Date().toISOString();
    return {
      id: createId(),
      accountId,
      status: "created",
      createdAt: now,
      updatedAt: now,
    };
  }
  async start(sessionId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("start_game_session", { sessionId });
      return;
    }
    throw new Error("Le runtime officiel du jeu n’est pas encore configuré.");
  }
  async suspend(sessionId: string): Promise<void> {
    if (isTauriRuntime()) await invoke("suspend_game_session", { sessionId });
  }
  async resume(sessionId: string): Promise<void> {
    if (isTauriRuntime()) await invoke("resume_game_session", { sessionId });
  }
  async reload(sessionId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("reload_game_session", { sessionId });
      return;
    }
    throw new Error("Le runtime officiel du jeu n’est pas encore configuré.");
  }
  async stop(sessionId: string): Promise<void> {
    if (isTauriRuntime()) await invoke("stop_game_session", { sessionId });
  }
  async destroy(sessionId: string): Promise<void> {
    if (isTauriRuntime()) await invoke("destroy_game_session", { sessionId });
  }
}
