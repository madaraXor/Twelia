import { AccountService } from "./accountService";
import { EMPTY_ACCOUNTS_DOCUMENT } from "./accountTypes";
import type { StateDocument, StorageGateway } from "../storage/storageGateway";

class MemoryStorage implements StorageGateway {
  values = new Map<StateDocument, unknown>();
  load<T>(document: StateDocument): Promise<T | null> {
    return Promise.resolve((this.values.get(document) as T | undefined) ?? null);
  }
  save<T>(document: StateDocument, value: T): Promise<void> {
    this.values.set(document, value);
    return Promise.resolve();
  }
}

describe("AccountService", () => {
  it("crée un profil sans secret puis le supprime", async () => {
    const storage = new MemoryStorage();
    const service = new AccountService(storage);
    const created = await service.create(EMPTY_ACCOUNTS_DOCUMENT, {
      displayName: "  Cra principal  ",
      loginHint: "theo@example.test",
    });
    expect(created.accounts).toHaveLength(1);
    expect(created.accounts[0]).toMatchObject({
      displayName: "Cra principal",
      sessionStatus: "unknown",
    });
    expect(JSON.stringify(created)).not.toMatch(/password|token|cookie/i);
    const removed = await service.remove(created, created.accounts[0]!.id);
    expect(removed.accounts).toEqual([]);
  });

  it("rejette les noms vides", async () => {
    await expect(serviceProfile()).rejects.toThrow("obligatoire");
  });
});

function serviceProfile() {
  const storage = new MemoryStorage();
  return new AccountService(storage).create(EMPTY_ACCOUNTS_DOCUMENT, { displayName: " " });
}
