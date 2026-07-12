import type { StorageGateway } from "../storage/storageGateway";
import { INITIAL_WORKSPACE, type WorkspaceState, type WorkspaceTab } from "./tabTypes";

function normalizeTabs(input: unknown): WorkspaceTab[] {
  if (!Array.isArray(input)) return INITIAL_WORKSPACE.tabs;
  const seen = new Set<string>();
  const valid = input.filter((tab): tab is WorkspaceTab => {
    if (!tab || typeof tab !== "object") return false;
    const candidate = tab as Partial<WorkspaceTab>;
    if (typeof candidate.id !== "string" || seen.has(candidate.id)) return false;
    if (candidate.type === "home" && candidate.id !== "home") return false;
    if (candidate.type === "settings" && candidate.id !== "settings") return false;
    if (candidate.type === "game" && typeof candidate.accountId !== "string") return false;
    if (!candidate.type || !["home", "settings", "game"].includes(candidate.type)) return false;
    seen.add(candidate.id);
    return true;
  });
  const withoutHome = valid.filter((tab) => tab.type !== "home");
  return [{ id: "home", type: "home", pinned: true }, ...withoutHome];
}

export function migrateWorkspace(input: unknown): WorkspaceState {
  if (!input || typeof input !== "object") return INITIAL_WORKSPACE;
  const raw = input as Partial<WorkspaceState>;
  const tabs = normalizeTabs(raw.tabs);
  const activeTabId = tabs.some((tab) => tab.id === raw.activeTabId)
    ? (raw.activeTabId as string)
    : "home";
  return { schemaVersion: 1, activeTabId, tabs };
}

export class TabPersistence {
  constructor(private readonly storage: StorageGateway) {}
  async load(): Promise<WorkspaceState> {
    return migrateWorkspace(await this.storage.load("workspace"));
  }
  async save(workspace: WorkspaceState): Promise<void> {
    await this.storage.save("workspace", workspace);
  }
}
