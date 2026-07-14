import { getGameConnectionStatus } from "./gameConnection";
import type { GameSession } from "./gameTypes";

function session(
  status: GameSession["status"],
  connectionStatus?: GameSession["connectionStatus"],
) {
  return {
    id: "session-a",
    accountId: "account-a",
    status,
    connectionStatus,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  } satisfies GameSession;
}

describe("game connection status", () => {
  it("ne confond pas un client ouvert avec un compte connecté", () => {
    expect(getGameConnectionStatus(session("running"))).toBe("connecting");
    expect(getGameConnectionStatus(session("running", "disconnected"))).toBe("disconnected");
    expect(getGameConnectionStatus(session("running", "connected"))).toBe("connected");
  });

  it("conserve une erreur technique comme déconnectée", () => {
    expect(getGameConnectionStatus(session("error"))).toBe("disconnected");
    expect(getGameConnectionStatus(session("stopped"))).toBe("disconnected");
  });
});
