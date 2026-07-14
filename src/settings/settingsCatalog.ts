import type { MessageKey } from "../i18n/messages";
import type { SettingsSection } from "../tabs/tabTypes";

export type SettingSearchEntry = {
  id: string;
  section: SettingsSection;
  labelKey: MessageKey;
  keywords: string;
};

export const SETTING_SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    id: "language",
    section: "general",
    labelKey: "settings.language.label",
    keywords: "langue language français english système system locale",
  },
  {
    id: "restore-tabs",
    section: "general",
    labelKey: "settings.restoreTabs.label",
    keywords: "onglets tabs démarrage startup restaurer restore",
  },
  {
    id: "confirm-close",
    section: "general",
    labelKey: "settings.confirmClose.label",
    keywords: "fermeture close session confirmation",
  },
  {
    id: "updates",
    section: "general",
    labelKey: "settings.updates.label",
    keywords: "mise à jour update démarrage startup",
  },
  {
    id: "combat-turn",
    section: "general",
    labelKey: "settings.combatTurn.label",
    keywords: "combat tour turn bascule switch automatique",
  },
  {
    id: "party-invitation",
    section: "general",
    labelKey: "settings.partyInvitation.label",
    keywords: "groupe party invitation bascule switch automatique",
  },
  {
    id: "group-fight",
    section: "general",
    labelKey: "settings.groupFight.label",
    keywords: "groupe party combat fight bascule switch automatique",
  },
  {
    id: "theme",
    section: "interface",
    labelKey: "settings.theme.label",
    keywords: "apparence appearance sombre dark clair light système system",
  },
  {
    id: "scale",
    section: "interface",
    labelKey: "settings.scale.label",
    keywords: "taille size zoom échelle scale",
  },
  {
    id: "reduce-motion",
    section: "interface",
    labelKey: "settings.reduceMotion.label",
    keywords: "animation mouvement motion accessibilité accessibility",
  },
  {
    id: "compact-tabs",
    section: "interface",
    labelKey: "settings.compactTabs.label",
    keywords: "onglets tabs compact largeur width",
  },
  {
    id: "character-names",
    section: "interface",
    labelKey: "settings.characterNames.label",
    keywords: "personnage character nom name compte account",
  },
  {
    id: "notifications",
    section: "interface",
    labelKey: "settings.notifications.label",
    keywords: "notification alerte alert indicateur indicator",
  },
  {
    id: "background-rendering",
    section: "performance",
    labelKey: "settings.backgroundRendering.label",
    keywords: "rendu render arrière-plan background ressources resources",
  },
  {
    id: "mute-inactive",
    section: "performance",
    labelKey: "settings.muteInactive.label",
    keywords: "audio son sound mute muet couper onglet inactif inactive tab",
  },
  {
    id: "suspend-inactive",
    section: "performance",
    labelKey: "settings.suspendInactive.label",
    keywords: "suspendre suspend pause onglet inactif inactive tab mémoire memory",
  },
  {
    id: "max-sessions",
    section: "performance",
    labelKey: "settings.maxSessions.label",
    keywords: "sessions simultanées concurrent maximum limite limit",
  },
  {
    id: "render-quality",
    section: "performance",
    labelKey: "settings.renderQuality.label",
    keywords: "qualité quality rendu render économie balanced élevée high",
  },
  {
    id: "debug",
    section: "performance",
    labelKey: "settings.debug.label",
    keywords: "diagnostic debug logs journaux technique technical",
  },
];
