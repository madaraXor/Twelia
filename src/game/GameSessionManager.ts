import { create } from "zustand";
import { toTweliaError } from "../core/errors";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { TauriGameRuntime } from "./GameRuntime";
import type {
  GameConnectionStatus,
  GameSession,
  GameSessionStatus,
  SessionRuntime,
} from "./gameTypes";

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
  setConnectionStatus: (sessionId: string, status: GameConnectionStatus) => void;
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
  const transitionVersions = new Map<string, number>();

  return create<SessionState>((set, get) => {
    const transition = async (
      sessionId: string,
      pending: GameSessionStatus,
      complete: GameSessionStatus,
      operation: () => Promise<void>,
    ) => {
      const version = (transitionVersions.get(sessionId) ?? 0) + 1;
      transitionVersions.set(sessionId, version);
      get().setStatus(sessionId, pending);
      try {
        await operation();
        if (transitionVersions.get(sessionId) === version) get().setStatus(sessionId, complete);
      } catch (error) {
        const parsed = toTweliaError(error, "SESSION_OPERATION_FAILED");
        if (transitionVersions.get(sessionId) === version) {
          get().setStatus(sessionId, "error", parsed.message);
        }
        diagnosticLogger.error("game-session", parsed.message, { gameSessionId: sessionId });
        throw Object.assign(new Error(parsed.message), parsed);
      } finally {
        if (transitionVersions.get(sessionId) === version) transitionVersions.delete(sessionId);
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
        transitionVersions.set(id, (transitionVersions.get(id) ?? 0) + 1);
        await sessionRuntime.destroy(id);
        const sessions = { ...get().sessions };
        delete sessions[id];
        set({ sessions });
        transitionVersions.delete(id);
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
      setConnectionStatus: (id, connectionStatus) => {
        const current = get().sessions[id];
        if (!current || current.connectionStatus === connectionStatus) return;
        set({
          sessions: {
            ...get().sessions,
            [id]: { ...current, connectionStatus, updatedAt: new Date().toISOString() },
          },
        });
      },
    };
  });
}

export const useGameSessionStore = createSessionStore();
