import {
  closeTabState,
  openGameTabState,
  reorderTabState,
  settingsBackTabId,
  useTabStore,
} from "./tabStore";
import { INITIAL_WORKSPACE, type WorkspaceState } from "./tabTypes";
import { migrateWorkspace } from "./tabPersistence";

describe("workspace tabs", () => {
  it("n’ouvre jamais deux onglets pour le même compte", () => {
    const once = openGameTabState(INITIAL_WORKSPACE, "account-a");
    const twice = openGameTabState(once, "account-a");
    expect(twice.tabs.filter((tab) => tab.type === "game")).toHaveLength(1);
    expect(twice.activeTabId).toBe("game:account-a");
  });

  it("restaure l’ordre et réordonne les onglets", () => {
    const input = openGameTabState(openGameTabState(INITIAL_WORKSPACE, "a"), "b");
    const reordered = reorderTabState(input, "game:b", "game:a");
    expect(reordered.tabs.map((tab) => tab.id)).toEqual(["home", "game:b", "game:a"]);
    expect(migrateWorkspace(JSON.parse(JSON.stringify(reordered)))).toEqual(reordered);
  });

  it("retombe sur l’accueil après un fichier incomplet", () => {
    expect(
      migrateWorkspace({ schemaVersion: 1, activeTabId: "missing", tabs: [{ id: "broken" }] }),
    ).toEqual(INITIAL_WORKSPACE);
    expect(migrateWorkspace("{incomplete")).toEqual(INITIAL_WORKSPACE);
  });

  it("ferme puis rouvre le dernier onglet", () => {
    const workspace = openGameTabState(INITIAL_WORKSPACE, "account-a");
    const game = workspace.tabs.find((tab) => tab.type === "game")!;
    useTabStore.setState({ ...workspace, recentlyClosed: [], hydrated: true });
    useTabStore.getState().closeTab(game.id);
    expect(useTabStore.getState().tabs).toHaveLength(1);
    useTabStore.getState().reopenLast();
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toContain(game.id);
  });

  it("ne ferme jamais l’accueil", () => {
    const state: WorkspaceState = { ...INITIAL_WORKSPACE };
    expect(closeTabState(state, "home")).toBe(state);
  });

  it("revient à l’accueil depuis les paramètres sans session de jeu", () => {
    expect(settingsBackTabId(INITIAL_WORKSPACE.tabs)).toBe("home");
  });

  it("revient au dernier jeu depuis les paramètres lorsqu’une session existe", () => {
    const workspace = openGameTabState(openGameTabState(INITIAL_WORKSPACE, "a"), "b");
    expect(settingsBackTabId(workspace.tabs)).toBe("game:b");
  });

  it("ouvre et restaure un seul onglet Mods", () => {
    useTabStore.setState({ ...INITIAL_WORKSPACE, recentlyClosed: [], hydrated: true });
    useTabStore.getState().openMods();
    useTabStore.getState().openMods();
    const workspace = {
      schemaVersion: 1 as const,
      activeTabId: useTabStore.getState().activeTabId,
      tabs: useTabStore.getState().tabs,
    };
    expect(workspace.tabs.filter((tab) => tab.type === "mods")).toHaveLength(1);
    expect(workspace.activeTabId).toBe("mods");
    expect(migrateWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
  });
});
