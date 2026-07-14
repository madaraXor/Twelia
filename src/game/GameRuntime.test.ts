import {
  MOBILE_GAME_RELOAD_EVENT,
  requestMobileGameReload,
  type MobileGameReloadDetail,
} from "./GameRuntime";

describe("mobile game runtime", () => {
  it("adresse le rechargement uniquement à la session demandée", () => {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(MOBILE_GAME_RELOAD_EVENT, listener);

    requestMobileGameReload("session-a");

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent<MobileGameReloadDetail>).detail).toEqual({
      sessionId: "session-a",
    });
    window.removeEventListener(MOBILE_GAME_RELOAD_EVENT, listener);
  });
});
