import type { GameConnectionStatus, GameSession } from "./gameTypes";

export function getGameConnectionStatus(
  session: GameSession | undefined,
): GameConnectionStatus | undefined {
  if (session?.connectionStatus) return session.connectionStatus;
  if (["error", "disconnected", "stopped"].includes(session?.status ?? "")) {
    return "disconnected";
  }
  if (session) return "connecting";
}
