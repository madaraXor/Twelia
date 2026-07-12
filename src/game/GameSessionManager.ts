import { create } from "zustand";
import { toTweliaError } from "../core/errors";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { TauriGameRuntime } from "./GameRuntime";
import type { GameSession, GameSessionStatus, SessionRuntime } from "./gameTypes";

const runtime = new TauriGameRuntime();

type SessionState = {
  sessions: Record<string, GameSession>;
  createForAccount: (accountId: string) => Promise<GameSession>;
  start: (sessionId: string) => Promise<void>;
  suspend: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  reload: (sessionId: string) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  destroy: (sessionId: string) => Promise<void>;
  setStatus: (sessionId: string, status: GameSessionStatus, error?: string) => void;
};

export function findSessionByAccount(
  sessions: Record<string, GameSession>,
  accountId: string,
): GameSession | undefined {
  return Object.values(sessions).find(
    (session) => session.accountId === accountId && session.status !== "stopped",
  );
}

export function createSessionStore(sessionRuntime: SessionRuntime = runtime) {
  const pendingCreations = new Map<string, Promise<GameSession>>();
  const pendingStarts = new Map<string, Promise<void>>();

  return create<SessionState>((set, get) => {
    const transition = async (
      sessionId: string,
      pending: GameSessionStatus,
      complete: GameSessionStatus,
      operation: () => Promise<void>,
    ) => {
      get().setStatus(sessionId, pending);
      try {
        await operation();
        get().setStatus(sessionId, complete);
      } catch (error) {
        const parsed = toTweliaError(error, "SESSION_OPERATION_FAILED");
        get().setStatus(sessionId, "error", parsed.message);
        diagnosticLogger.error("game-session", parsed.message, { gameSessionId: sessionId });
        throw Object.assign(new Error(parsed.message), parsed);
      }
    };

    return {
      sessions: {},
      createForAccount: async (accountId) => {
        const existing = findSessionByAccount(get().sessions, accountId);
        if (existing) return existing;
        const pending = pendingCreations.get(accountId);
        if (pending) return pending;

        const creation = sessionRuntime
          .create(accountId)
          .then((session) => {
            set({ sessions: { ...get().sessions, [session.id]: session } });
            diagnosticLogger.info("game-session", "Session créée", {
              gameSessionId: session.id,
              accountId,
            });
            return session;
          })
          .finally(() => pendingCreations.delete(accountId));
        pendingCreations.set(accountId, creation);
        return creation;
      },
      start: async (id) => {
        const pending = pendingStarts.get(id);
        if (pending) return pending;
        const start = transition(id, "starting", "running", () => sessionRuntime.start(id)).finally(
          () => pendingStarts.delete(id),
        );
        pendingStarts.set(id, start);
        return start;
      },
      suspend: async (id) =>
        transition(id, "background", "suspended", () => sessionRuntime.suspend(id)),
      resume: async (id) => transition(id, "starting", "running", () => sessionRuntime.resume(id)),
      reload: async (id) => transition(id, "starting", "running", () => sessionRuntime.reload(id)),
      stop: async (id) => transition(id, "disconnected", "stopped", () => sessionRuntime.stop(id)),
      destroy: async (id) => {
        await sessionRuntime.destroy(id);
        const sessions = { ...get().sessions };
        delete sessions[id];
        set({ sessions });
      },
      setStatus: (id, status, error) => {
        const current = get().sessions[id];
        if (!current) return;
        set({
          sessions: {
            ...get().sessions,
            [id]: { ...current, status, updatedAt: new Date().toISOString(), error },
          },
        });
      },
    };
  });
}

export const useGameSessionStore = createSessionStore();
