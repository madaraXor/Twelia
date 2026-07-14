import { storageGateway } from "../storage/storageGateway";
import { useAccountStore } from "./accountStore";
import type { AccountsDocument } from "./accountTypes";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("accountStore", () => {
  it("préserve les statuts de deux comptes mis à jour en même temps", async () => {
    const firstSave = deferred();
    const saved: AccountsDocument[] = [];
    vi.spyOn(storageGateway, "save").mockImplementation(async (_document, value) => {
      saved.push(value as AccountsDocument);
      if (saved.length === 1) await firstSave.promise;
    });
    const now = new Date().toISOString();
    useAccountStore.setState({
      schemaVersion: 1,
      hydrated: true,
      accounts: [
        {
          id: "account-a",
          displayName: "A",
          createdAt: now,
          sessionStatus: "logged-out",
        },
        {
          id: "account-b",
          displayName: "B",
          createdAt: now,
          sessionStatus: "logged-out",
        },
      ],
    });

    const first = useAccountStore.getState().setSessionStatus("account-a", "valid");
    const second = useAccountStore.getState().setSessionStatus("account-b", "valid");
    expect(useAccountStore.getState().accounts.map((account) => account.sessionStatus)).toEqual([
      "valid",
      "valid",
    ]);

    firstSave.resolve();
    await Promise.all([first, second]);
    expect(saved.at(-1)?.accounts.map((account) => account.sessionStatus)).toEqual([
      "valid",
      "valid",
    ]);
  });
});
