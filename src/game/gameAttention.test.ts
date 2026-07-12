import { DEFAULT_SETTINGS } from "../settings/settingsStore";
import {
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

  it("garde les sessions actives tant qu’une bascule automatique est demandée", () => {
    expect(needsBackgroundGameActivity(DEFAULT_SETTINGS)).toBe(true);
    expect(
      needsBackgroundGameActivity({
        ...DEFAULT_SETTINGS,
        autoSwitchOnCombatTurn: false,
        autoSwitchOnPartyInvitation: false,
        autoSwitchOnGroupFight: false,
      }),
    ).toBe(false);
  });
});
