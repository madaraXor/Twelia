import { create } from "zustand";
import { storageGateway } from "../storage/storageGateway";

export type AppSettings = {
  schemaVersion: 1;
  language: "fr" | "en";
  restoreTabs: boolean;
  confirmConnectedSessionClose: boolean;
  checkUpdatesAutomatically: boolean;
  theme: "dark" | "system";
  interfaceScale: number;
  compactTabs: boolean;
  showCharacterNames: boolean;
  showNotifications: boolean;
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
  schemaVersion: 1,
  language: "fr",
  restoreTabs: true,
  confirmConnectedSessionClose: true,
  checkUpdatesAutomatically: true,
  theme: "dark",
  interfaceScale: 1,
  compactTabs: false,
  showCharacterNames: true,
  showNotifications: true,
  autoSwitchOnCombatTurn: true,
  autoSwitchOnPartyInvitation: true,
  autoSwitchOnGroupFight: true,
  limitBackgroundRendering: true,
  suspendInactiveTabs: true,
  maxSessions: 4,
  renderQuality: "balanced",
  debugMode: import.meta.env.DEV && import.meta.env.VITE_TWELIA_DEBUG === "1",
};

export function migrateSettings(input: unknown): AppSettings {
  if (!input || typeof input !== "object") return DEFAULT_SETTINGS;
  const raw = input as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schemaVersion: 1,
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
