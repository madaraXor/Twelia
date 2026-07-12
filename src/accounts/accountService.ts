import type { AccountDraft, AccountProfile, AccountsDocument } from "./accountTypes";
import { EMPTY_ACCOUNTS_DOCUMENT } from "./accountTypes";
import type { StorageGateway } from "../storage/storageGateway";
import { createId } from "../core/id";

export function validateAccountDraft(draft: AccountDraft): void {
  if (!draft.displayName.trim()) throw new Error("Le nom du compte est obligatoire.");
  if (draft.displayName.trim().length > 64) throw new Error("Le nom du compte est trop long.");
  if (draft.loginHint && draft.loginHint.length > 254)
    throw new Error("L’identifiant est trop long.");
}

export function createAccountProfile(draft: AccountDraft, now = new Date()): AccountProfile {
  validateAccountDraft(draft);
  return {
    id: createId(),
    displayName: draft.displayName.trim(),
    ...(draft.loginHint?.trim() ? { loginHint: draft.loginHint.trim() } : {}),
    ...(draft.preferredServer?.trim() ? { preferredServer: draft.preferredServer.trim() } : {}),
    ...(draft.preferredCharacter?.trim()
      ? { preferredCharacter: draft.preferredCharacter.trim() }
      : {}),
    createdAt: now.toISOString(),
    sessionStatus: "unknown",
  };
}

export class AccountService {
  constructor(private readonly storage: StorageGateway) {}

  async load(): Promise<AccountsDocument> {
    const value = await this.storage.load<AccountsDocument>("accounts");
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.accounts)) {
      return EMPTY_ACCOUNTS_DOCUMENT;
    }
    return value;
  }

  async create(document: AccountsDocument, draft: AccountDraft): Promise<AccountsDocument> {
    const account = createAccountProfile(draft);
    const next = { ...document, accounts: [...document.accounts, account] };
    await this.storage.save("accounts", next);
    return next;
  }

  async update(
    document: AccountsDocument,
    accountId: string,
    draft: AccountDraft,
  ): Promise<AccountsDocument> {
    validateAccountDraft(draft);
    const next = {
      ...document,
      accounts: document.accounts.map((account) =>
        account.id === accountId
          ? {
              ...account,
              displayName: draft.displayName.trim(),
              loginHint: draft.loginHint?.trim() || undefined,
              preferredServer: draft.preferredServer?.trim() || undefined,
              preferredCharacter: draft.preferredCharacter?.trim() || undefined,
            }
          : account,
      ),
    };
    await this.storage.save("accounts", next);
    return next;
  }

  async remove(document: AccountsDocument, accountId: string): Promise<AccountsDocument> {
    const next = {
      ...document,
      defaultAccountId:
        document.defaultAccountId === accountId ? undefined : document.defaultAccountId,
      accounts: document.accounts.filter((account) => account.id !== accountId),
    };
    await this.storage.save("accounts", next);
    return next;
  }
}
