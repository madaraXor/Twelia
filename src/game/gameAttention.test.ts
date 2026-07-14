import { DEFAULT_SETTINGS } from "../settings/settingsStore";
import {
  decideGameAttention,
  describeGameAttention,
  needsBackgroundGameActivity,
  shouldAutoSwitchToGame,
  type GameAttentionKind,
} from "./gameAttention";

describe("game attention", () => {
  it.each<GameAttentionKind>(["combat-turn", "party-invitation", "group-fight"])(
    "active par défaut le changement d’onglet pour %s",
    (kind) => {
      expect(shouldAutoSwitchToGame(DEFAULT_SETTINGS, kind)).toBe(true);
    },
  );

  it("respecte chaque réglage séparément", () => {
    expect(
      shouldAutoSwitchToGame(
        { ...DEFAULT_SETTINGS, autoSwitchOnPartyInvitation: false },
        "party-invitation",
      ),
    ).toBe(false);
    expect(
      shouldAutoSwitchToGame(
        { ...DEFAULT_SETTINGS, autoSwitchOnPartyInvitation: false },
        "combat-turn",
      ),
    ).toBe(true);
  });

  it("bascule automatiquement sans proposer d’action", () => {
    expect(decideGameAttention(DEFAULT_SETTINGS, "combat-turn", false)).toEqual({
      autoSwitch: true,
      offerNavigation: false,
    });
  });

  it("propose d’y aller quand la bascule correspondante est désactivée", () => {
    expect(
      decideGameAttention(
        { ...DEFAULT_SETTINGS, autoSwitchOnPartyInvitation: false },
        "party-invitation",
        false,
      ),
    ).toEqual({ autoSwitch: false, offerNavigation: true });
  });

  it("ne propose pas de navigation si le compte est déjà affiché", () => {
    expect(
      decideGameAttention(
        { ...DEFAULT_SETTINGS, autoSwitchOnGroupFight: false },
        "group-fight",
        true,
      ),
    ).toEqual({ autoSwitch: false, offerNavigation: false });
  });

  it.each([
    ["combat-turn", "Tour de combat sur « Aurore »"],
    ["party-invitation", "Invitation reçue sur « Aurore »"],
    ["group-fight", "Combat de groupe sur « Aurore »"],
  ] as const)("décrit précisément l’événement %s", (kind, expected) => {
    expect(describeGameAttention(kind, "Aurore")).toBe(expected);
  });

  it("garde les sessions actives tant qu’une bascule automatique est demandée", () => {
    expect(needsBackgroundGameActivity(DEFAULT_SETTINGS)).toBe(true);
    expect(
      needsBackgroundGameActivity({
        ...DEFAULT_SETTINGS,
        showNotifications: false,
        autoSwitchOnCombatTurn: false,
        autoSwitchOnPartyInvitation: false,
        autoSwitchOnGroupFight: false,
      }),
    ).toBe(false);
  });

  it("garde les sessions actives pour recevoir une notification manuelle", () => {
    expect(
      needsBackgroundGameActivity({
        ...DEFAULT_SETTINGS,
        showNotifications: true,
        autoSwitchOnCombatTurn: false,
        autoSwitchOnPartyInvitation: false,
        autoSwitchOnGroupFight: false,
      }),
    ).toBe(true);
  });
});
