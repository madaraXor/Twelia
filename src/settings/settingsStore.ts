import { create } from "zustand";
import { storageGateway } from "../storage/storageGateway";

export type AppSettings = {
  schemaVersion: 3;
  language: "system" | "fr" | "en";
  restoreTabs: boolean;
  confirmConnectedSessionClose: boolean;
  checkUpdatesAutomatically: boolean;
  theme: "dark" | "light" | "system";
  interfaceScale: number;
  reduceMotion: boolean;
  compactTabs: boolean;
  showCharacterNames: boolean;
  showNotifications: boolean;
  showMobileQuickSwitch: boolean;
  showMobileSessionPill: boolean;
  muteInactiveTabs: boolean;
  autoSwitchOnCombatTurn: boolean;
  autoSwitchOnPartyInvitation: boolean;
  autoSwitchOnGroupFight: boolean;
  limitBackgroundRendering: boolean;
  suspendInactiveTabs: boolean;
  maxSessions: number;
  renderQuality: "low" | "balanced" | "high";
  debugMode: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 3,
  language: "system",
  restoreTabs: true,
  confirmConnectedSessionClose: true,
  checkUpdatesAutomatically: true,
  theme: "system",
  interfaceScale: 1,
  reduceMotion: false,
  compactTabs: false,
  showCharacterNames: true,
  showNotifications: true,
  showMobileQuickSwitch: true,
  showMobileSessionPill: false,
  muteInactiveTabs: true,
  autoSwitchOnCombatTurn: true,
  autoSwitchOnPartyInvitation: true,
  autoSwitchOnGroupFight: true,
  limitBackgroundRendering: false,
  suspendInactiveTabs: false,
  maxSessions: 4,
  renderQuality: "balanced",
  debugMode: import.meta.env.DEV && import.meta.env.VITE_TWELIA_DEBUG === "1",
};

export function migrateSettings(input: unknown): AppSettings {
  if (!input || typeof input !== "object") return DEFAULT_SETTINGS;
  const raw = input as Partial<AppSettings>;
  const inputSchemaVersion = (input as { schemaVersion?: number }).schemaVersion;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schemaVersion: 3,
    language:
      (inputSchemaVersion === 2 || inputSchemaVersion === 3) &&
      (raw.language === "system" || raw.language === "fr" || raw.language === "en")
        ? raw.language
        : DEFAULT_SETTINGS.language,
    limitBackgroundRendering:
      inputSchemaVersion === 3 && typeof raw.limitBackgroundRendering === "boolean"
        ? raw.limitBackgroundRendering
        : DEFAULT_SETTINGS.limitBackgroundRendering,
    suspendInactiveTabs:
      inputSchemaVersion === 3 && typeof raw.suspendInactiveTabs === "boolean"
        ? raw.suspendInactiveTabs
        : DEFAULT_SETTINGS.suspendInactiveTabs,
    interfaceScale:
      typeof raw.interfaceScale === "number"
        ? Math.min(1.4, Math.max(0.8, raw.interfaceScale))
        : DEFAULT_SETTINGS.interfaceScale,
    maxSessions:
      typeof raw.maxSessions === "number"
        ? Math.min(12, Math.max(1, Math.round(raw.maxSessions)))
        : DEFAULT_SETTINGS.maxSessions,
  };
}

type SettingsState = AppSettings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  reset: () => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: async () => {
    const saved = await storageGateway.load<AppSettings>("settings");
    set({ ...migrateSettings(saved), hydrated: true });
  },
  update: async (key, value) => {
    const next = migrateSettings({ ...get(), [key]: value });
    set(next);
    await storageGateway.save("settings", next);
  },
  reset: async () => {
    set(DEFAULT_SETTINGS);
    await storageGateway.save("settings", DEFAULT_SETTINGS);
  },
}));
