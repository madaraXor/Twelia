export type AccountSessionStatus = "unknown" | "valid" | "expired" | "logged-out";

export type AccountProfile = {
  id: string;
  displayName: string;
  loginHint?: string;
  avatarUrl?: string;
  preferredServer?: string;
  preferredCharacter?: string;
  createdAt: string;
  lastUsedAt?: string;
  sessionStatus: AccountSessionStatus;
};

export type AccountDraft = Pick<AccountProfile, "displayName"> &
  Partial<Pick<AccountProfile, "loginHint" | "preferredServer" | "preferredCharacter">>;

export type AccountsDocument = {
  schemaVersion: 1;
  defaultAccountId?: string;
  accounts: AccountProfile[];
};

export const EMPTY_ACCOUNTS_DOCUMENT: AccountsDocument = {
  schemaVersion: 1,
  accounts: [],
};

export function maskLoginHint(loginHint?: string): string | undefined {
  if (!loginHint) return undefined;
  const at = loginHint.indexOf("@");
  if (at > 0) {
    const name = loginHint.slice(0, at);
    const domain = loginHint.slice(at + 1);
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${"•".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
  }
  if (loginHint.length <= 3) return "•".repeat(loginHint.length);
  return `${loginHint.slice(0, 2)}${"•".repeat(loginHint.length - 2)}`;
}
