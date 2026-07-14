import {
  clearMobileOAuthTarget,
  consumeMobileOAuthTarget,
  deliverMobileOAuthCallback,
  oauthPayloadFromUrl,
  rememberMobileOAuthTarget,
  subscribeMobileOAuthCallback,
} from "./mobileGameBridge";

describe("mobile game bridge", () => {
  it("accepte le retour OAuth attendu", () => {
    expect(oauthPayloadFromUrl("dofustouch://authorized?code=abc123")).toEqual({
      code: "abc123",
    });
  });

  it("refuse les autres schémas et hôtes", () => {
    expect(oauthPayloadFromUrl("https://authorized?code=abc123")).toBeUndefined();
    expect(oauthPayloadFromUrl("dofustouch://other?code=abc123")).toBeUndefined();
  });

  it("conserve le profil OAuth à travers le passage dans le navigateur", () => {
    rememberMobileOAuthTarget("profile-a");
    expect(consumeMobileOAuthTarget()).toBe("profile-a");
    expect(consumeMobileOAuthTarget()).toBeUndefined();
  });

  it("ne supprime pas la cible OAuth d’un autre profil", () => {
    rememberMobileOAuthTarget("profile-b");
    clearMobileOAuthTarget("profile-a");
    expect(consumeMobileOAuthTarget()).toBe("profile-b");
  });

  it("remet un retour OAuth en attente jusqu’à ce que le profil soit prêt", () => {
    deliverMobileOAuthCallback({ accountId: "profile-c", payload: { code: "queued-code" } });
    const listener = vi.fn();

    const unsubscribe = subscribeMobileOAuthCallback("profile-c", listener);

    expect(listener).toHaveBeenCalledWith({
      accountId: "profile-c",
      payload: { code: "queued-code" },
    });
    unsubscribe();
  });
});
