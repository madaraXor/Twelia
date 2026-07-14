export type GameSessionStatus =
  | "created"
  | "starting"
  | "authenticating"
  | "running"
  | "background"
  | "suspended"
  | "disconnected"
  | "error"
  | "stopped";

export type GameConnectionStatus = "connecting" | "connected" | "disconnected";

export type GameSession = {
  id: string;
  accountId: string;
  runtimeDirectory?: string;
  status: GameSessionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  connectionStatus?: GameConnectionStatus;
};

export interface SessionRuntime {
  create(accountId: string): Promise<GameSession>;
  start(sessionId: string): Promise<void>;
  suspend(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  reload(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}
