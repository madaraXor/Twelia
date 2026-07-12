import { closeTabState, openGameTabState, reorderTabState, useTabStore } from "./tabStore";
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
});
