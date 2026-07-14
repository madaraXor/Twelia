import { create } from "zustand";
import { AccountService } from "./accountService";
import type { AccountDraft, AccountProfile, AccountsDocument } from "./accountTypes";
import { EMPTY_ACCOUNTS_DOCUMENT } from "./accountTypes";
import { storageGateway } from "../storage/storageGateway";
import { toTweliaError, type TweliaError } from "../core/errors";

const service = new AccountService(storageGateway);
let sessionStatusSaveQueue: Promise<void> = Promise.resolve();

function saveSessionStatus(document: AccountsDocument): Promise<void> {
  const save = sessionStatusSaveQueue.then(() => storageGateway.save("accounts", document));
  sessionStatusSaveQueue = save.catch(() => undefined);
  return save;
}

type AccountState = AccountsDocument & {
  hydrated: boolean;
  busy: boolean;
  error?: TweliaError;
  hydrate: () => Promise<void>;
  createAccount: (draft: AccountDraft) => Promise<AccountProfile>;
  updateAccount: (id: string, draft: AccountDraft) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  setSessionStatus: (id: string, status: AccountProfile["sessionStatus"]) => Promise<void>;
  setDefaultAccount: (id?: string) => Promise<void>;
};

export const useAccountStore = create<AccountState>((set, get) => ({
  ...EMPTY_ACCOUNTS_DOCUMENT,
  hydrated: false,
  busy: false,
  hydrate: async () => {
    try {
      set({ busy: true });
      set({ ...(await service.load()), hydrated: true, busy: false, error: undefined });
    } catch (error) {
      set({ hydrated: true, busy: false, error: toTweliaError(error, "ACCOUNT_LOAD_FAILED") });
    }
  },
  createAccount: async (draft) => {
    set({ busy: true });
    try {
      const next = await service.create(get(), draft);
      const created = next.accounts.at(-1);
      if (!created) throw new Error("Le profil n’a pas pu être créé.");
      set({ ...next, busy: false, error: undefined });
      return created;
    } catch (error) {
      const tweliaError = toTweliaError(error, "ACCOUNT_CREATE_FAILED");
      set({ busy: false, error: tweliaError });
      throw Object.assign(new Error(tweliaError.message), tweliaError);
    }
  },
  updateAccount: async (id, draft) => {
    const next = await service.update(get(), id, draft);
    set({ ...next, error: undefined });
  },
  removeAccount: async (id) => {
    const next = await service.remove(get(), id);
    set({ ...next, error: undefined });
  },
  setSessionStatus: async (id, status) => {
    const state = get();
    const current = state.accounts.find((account) => account.id === id);
    if (!current || current.sessionStatus === status) return;
    const next = {
      schemaVersion: 1 as const,
      defaultAccountId: state.defaultAccountId,
      accounts: state.accounts.map((account) =>
        account.id === id
          ? { ...account, sessionStatus: status, lastUsedAt: new Date().toISOString() }
          : account,
      ),
    };
    set(next);
    await saveSessionStatus(next);
  },
  setDefaultAccount: async (id) => {
    const state = get();
    const next = {
      schemaVersion: 1 as const,
      accounts: state.accounts,
      ...(id ? { defaultAccountId: id } : {}),
    };
    await storageGateway.save("accounts", next);
    set(next);
  },
}));
