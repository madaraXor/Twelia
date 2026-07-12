import type { AppSettings } from "../settings/settingsStore";

export type GameAttentionKind = "combat-turn" | "party-invitation" | "group-fight";

export type GameAttentionEvent = {
  sessionId: string;
  kind: GameAttentionKind;
};

type AttentionSettings = Pick<
  AppSettings,
  "autoSwitchOnCombatTurn" | "autoSwitchOnPartyInvitation" | "autoSwitchOnGroupFight"
>;

export function needsBackgroundGameActivity(settings: AttentionSettings): boolean {
  return (
    settings.autoSwitchOnCombatTurn ||
    settings.autoSwitchOnPartyInvitation ||
    settings.autoSwitchOnGroupFight
  );
}

export function shouldAutoSwitchToGame(
  settings: AttentionSettings,
  kind: GameAttentionKind,
): boolean {
  switch (kind) {
    case "combat-turn":
      return settings.autoSwitchOnCombatTurn;
    case "party-invitation":
      return settings.autoSwitchOnPartyInvitation;
    case "group-fight":
      return settings.autoSwitchOnGroupFight;
  }
}
