import { create } from "zustand";
import { storageGateway } from "../storage/storageGateway";
import { TabPersistence } from "./tabPersistence";
import {
  gameTabId,
  INITIAL_WORKSPACE,
  type GameTab,
  type SettingsSection,
  type WorkspaceState,
  type WorkspaceTab,
} from "./tabTypes";

const persistence = new TabPersistence(storageGateway);

export type ClosedTab = { tab: GameTab; closedAt: number };

export function openGameTabState(state: WorkspaceState, accountId: string): WorkspaceState {
  const id = gameTabId(accountId);
  if (state.tabs.some((tab) => tab.id === id)) return { ...state, activeTabId: id };
  const gameCount = state.tabs.filter((tab) => tab.type === "game").length;
  return {
    ...state,
    activeTabId: id,
    tabs: [...state.tabs, { id, type: "game", accountId, position: gameCount, pinned: false }],
  };
}

export function closeTabState(state: WorkspaceState, tabId: string): WorkspaceState {
  if (tabId === "home") return state;
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId =
    state.activeTabId === tabId
      ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? "home")
      : state.activeTabId;
  return { ...state, activeTabId, tabs };
}

export function settingsBackTabId(tabs: WorkspaceTab[]): string {
  return tabs.filter((tab) => tab.type === "game").at(-1)?.id ?? "home";
}

export function reorderTabState(
  state: WorkspaceState,
  fromId: string,
  toId: string,
): WorkspaceState {
  if (fromId === "home" || toId === "home" || fromId === toId) return state;
  const from = state.tabs.findIndex((tab) => tab.id === fromId);
  const to = state.tabs.findIndex((tab) => tab.id === toId);
  if (from < 0 || to < 0) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  if (!moved) return state;
  tabs.splice(to, 0, moved);
  return {
    ...state,
    tabs: tabs.map((tab, position) => (tab.type === "game" ? { ...tab, position } : tab)),
  };
}

type TabState = WorkspaceState & {
  hydrated: boolean;
  recentlyClosed: ClosedTab[];
  hydrate: () => Promise<void>;
  selectTab: (id: string) => void;
  openGame: (accountId: string) => void;
  openSettings: (section?: SettingsSection) => void;
  closeTab: (id: string) => void;
  reopenLast: () => void;
  reorder: (fromId: string, toId: string) => void;
  togglePin: (id: string) => void;
};

function persist(state: WorkspaceState): void {
  void persistence.save(state);
}

export const useTabStore = create<TabState>((set, get) => ({
  ...INITIAL_WORKSPACE,
  hydrated: false,
  recentlyClosed: [],
  hydrate: async () => set({ ...(await persistence.load()), hydrated: true }),
  selectTab: (id) => {
    if (!get().tabs.some((tab) => tab.id === id)) return;
    const next = { schemaVersion: 1 as const, activeTabId: id, tabs: get().tabs };
    set(next);
    persist(next);
  },
  openGame: (accountId) => {
    const next = openGameTabState(get(), accountId);
    set(next);
    persist(next);
  },
  openSettings: (section) => {
    const state = get();
    const current = state.tabs.find((tab) => tab.id === "settings");
    const settings: WorkspaceTab = { id: "settings", type: "settings", settingsSection: section };
    const tabs = current
      ? state.tabs.map((tab) => (tab.id === "settings" ? settings : tab))
      : [...state.tabs, settings];
    const next = { schemaVersion: 1 as const, activeTabId: "settings", tabs };
    set(next);
    persist(next);
  },
  closeTab: (id) => {
    const state = get();
    const tab = state.tabs.find((item) => item.id === id);
    if (tab?.type === "game" && tab.pinned) return;
    const next = closeTabState(state, id);
    const recentlyClosed =
      tab?.type === "game"
        ? [{ tab, closedAt: Date.now() }, ...state.recentlyClosed].slice(0, 10)
        : state.recentlyClosed;
    set({ ...next, recentlyClosed });
    persist(next);
  },
  reopenLast: () => {
    const [last, ...rest] = get().recentlyClosed;
    if (!last) return;
    const next = openGameTabState(get(), last.tab.accountId);
    set({ ...next, recentlyClosed: rest });
    persist(next);
  },
  reorder: (fromId, toId) => {
    const next = reorderTabState(get(), fromId, toId);
    set(next);
    persist(next);
  },
  togglePin: (id) => {
    const state = get();
    const tabs = state.tabs.map((tab) =>
      tab.id === id && tab.type === "game" ? { ...tab, pinned: !tab.pinned } : tab,
    );
    const next = { schemaVersion: 1 as const, activeTabId: state.activeTabId, tabs };
    set(next);
    persist(next);
  },
}));
