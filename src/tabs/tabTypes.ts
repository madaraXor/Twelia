export type SettingsSection =
  "general" | "accounts" | "interface" | "shortcuts" | "client" | "performance" | "logs" | "about";

export type HomeTab = { id: "home"; type: "home"; pinned: true };
export type ModsTab = { id: "mods"; type: "mods" };
export type GameTab = {
  id: string;
  type: "game";
  accountId: string;
  position: number;
  pinned: boolean;
};
export type SettingsTab = {
  id: "settings";
  type: "settings";
  settingsSection?: SettingsSection;
};

export type WorkspaceTab = HomeTab | ModsTab | GameTab | SettingsTab;

export type WorkspaceState = {
  schemaVersion: 1;
  activeTabId: string;
  tabs: WorkspaceTab[];
};

export const INITIAL_WORKSPACE: WorkspaceState = {
  schemaVersion: 1,
  activeTabId: "home",
  tabs: [{ id: "home", type: "home", pinned: true }],
};

export const gameTabId = (accountId: string) => `game:${accountId}`;
