import type { AppSettings } from "../settings/settingsStore";

export type GameAttentionKind = "combat-turn" | "party-invitation" | "group-fight";

export type GameAttentionEvent = {
  sessionId: string;
  kind: GameAttentionKind;
};

type AttentionSettings = Pick<
  AppSettings,
  | "autoSwitchOnCombatTurn"
  | "autoSwitchOnPartyInvitation"
  | "autoSwitchOnGroupFight"
  | "showNotifications"
>;

export type GameAttentionDecision = {
  autoSwitch: boolean;
  offerNavigation: boolean;
};

export function needsBackgroundGameActivity(settings: AttentionSettings): boolean {
  return (
    settings.showNotifications ||
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

export function decideGameAttention(
  settings: AttentionSettings,
  kind: GameAttentionKind,
  alreadyActive: boolean,
): GameAttentionDecision {
  const automatic = shouldAutoSwitchToGame(settings, kind);
  return {
    autoSwitch: automatic && !alreadyActive,
    offerNavigation: !automatic && !alreadyActive,
  };
}

export function describeGameAttention(kind: GameAttentionKind, accountName?: string): string {
  const target = accountName ? ` sur « ${accountName} »` : " sur ce compte";
  switch (kind) {
    case "combat-turn":
      return `Tour de combat${target}`;
    case "party-invitation":
      return `Invitation reçue${target}`;
    case "group-fight":
      return `Combat de groupe${target}`;
  }
}
