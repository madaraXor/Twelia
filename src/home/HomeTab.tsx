import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  LogOut,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AccountCard } from "../accounts/components/AccountCard";
import { AccountForm } from "../accounts/components/AccountForm";
import { useAccountStore } from "../accounts/accountStore";
import type { AccountDraft, AccountProfile } from "../accounts/accountTypes";
import { findSessionByAccount, useGameSessionStore } from "../game/GameSessionManager";
import {
  EMPTY_CLIENT_STATUS,
  getClientStatus,
  onClientInstallProgress,
  type ClientStatus,
} from "../game/clientService";
import { isMobilePlatform, isTauriRuntime } from "../platform/platform";
import { useI18n } from "../i18n/i18n";
import { useModStore } from "../mods/modStore";
import { useTabStore } from "../tabs/tabStore";

export function HomeTab() {
  const { t } = useI18n();
  const mobile = isMobilePlatform();
  const accounts = useAccountStore((state) => state.accounts);
  const createAccount = useAccountStore((state) => state.createAccount);
  const updateAccount = useAccountStore((state) => state.updateAccount);
  const removeAccount = useAccountStore((state) => state.removeAccount);
  const setSessionStatus = useAccountStore((state) => state.setSessionStatus);
  const openGame = useTabStore((state) => state.openGame);
  const modsEnabled = useModStore((state) => state.enabled);
  const tabs = useTabStore((state) => state.tabs);
  const gameTabs = useMemo(() => tabs.filter((tab) => tab.type === "game"), [tabs]);
  const lastGameTab = gameTabs.at(-1);
  const sessions = useGameSessionStore((state) => state.sessions);
  const [editing, setEditing] = useState<AccountProfile | "new">();
  const [deleting, setDeleting] = useState<AccountProfile>();
  const [client, setClient] = useState<ClientStatus>(EMPTY_CLIENT_STATUS);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getClientStatus()
      .then(setClient)
      .catch(() => setClient(EMPTY_CLIENT_STATUS));
    void onClientInstallProgress((progress) => {
      if (progress.percent === 100) void getClientStatus().then(setClient);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const activeAccountIds = useMemo(
    () => new Set(gameTabs.map((tab) => (tab.type === "game" ? tab.accountId : ""))),
    [gameTabs],
  );

  const play = (account: AccountProfile) => {
    openGame(account.id);
  };

  const save = async (draft: AccountDraft) => {
    if (editing === "new") await createAccount(draft);
    else if (editing) await updateAccount(editing.id, draft);
  };

  const remove = async (account: AccountProfile) => {
    const accountSession = findSessionByAccount(sessions, account.id);
    if (accountSession) await useGameSessionStore.getState().destroy(accountSession.id);
    if (isTauriRuntime()) await invoke("delete_account_data", { accountId: account.id });
    await removeAccount(account.id);
    const tab = useTabStore
      .getState()
      .tabs.find((candidate) => candidate.type === "game" && candidate.accountId === account.id);
    if (tab) useTabStore.getState().closeTab(tab.id);
    setDeleting(undefined);
  };

  const clientReady = client.installed && client.integrity === "valid";

  const overlays = (
    <>
      {editing && (
        <AccountForm
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSubmit={save}
        />
      )}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDescription", { name: deleting?.displayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && void remove(deleting)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (mobile) {
    return (
      <>
        <main
          className="h-full w-full overflow-y-auto bg-[radial-gradient(600px_300px_at_14%_0%,var(--color-surface-elevated),var(--color-background)_60%)] px-6 py-5"
          aria-label={t("home.label")}
        >
          <header className="flex items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/twelia-icon.png" alt="" className="size-[30px] shrink-0 object-contain" />
              <div className="min-w-0">
                <h1 className="truncate font-serif text-[22px] font-semibold leading-none">
                  Twelia
                </h1>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {t("home.eyebrow")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {lastGameTab && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs"
                  onClick={() => useTabStore.getState().selectTab(lastGameTab.id)}
                >
                  <ArrowLeft /> {t("home.backToGame")}
                </Button>
              )}
              {modsEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs"
                  onClick={() => useTabStore.getState().openMods()}
                >
                  <Puzzle /> {t("mods.page.title")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={() => useTabStore.getState().openSettings()}
              >
                <Settings /> {t("common.settings")}
              </Button>
            </div>
          </header>

          <section aria-labelledby="mobile-accounts-title">
            <div className="mb-3 mt-[18px] flex items-center justify-between gap-4">
              <h2
                id="mobile-accounts-title"
                className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-primary"
              >
                {t(accounts.length === 1 ? "home.profile.one" : "home.profile.other", {
                  count: accounts.length,
                })}
              </h2>
              <Button size="sm" className="h-9 px-3.5 text-xs" onClick={() => setEditing("new")}>
                <Plus /> {t("home.addShort")}
              </Button>
            </div>

            {accounts.length === 0 ? (
              <div className="grid min-h-48 place-items-center rounded-[14px] border border-dashed border-border-strong bg-card/70 p-7 text-center">
                <div>
                  <span className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                    <UserPlus className="size-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold">{t("home.firstProfile")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t("home.noPassword")}</p>
                  <Button size="sm" className="mt-4" onClick={() => setEditing("new")}>
                    <Plus /> {t("home.addShort")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 min-[680px]:grid-cols-2">
                {accounts.map((account) => (
                  <MobileAccountCard
                    key={account.id}
                    account={account}
                    active={activeAccountIds.has(account.id)}
                    onPlay={() => play(account)}
                    onEdit={() => setEditing(account)}
                    onReconnect={() => void setSessionStatus(account.id, "expired")}
                    onLogout={() => void setSessionStatus(account.id, "logged-out")}
                    onDelete={() => setDeleting(account)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
        {overlays}
      </>
    );
  }

  return (
    <main
      className="mx-auto min-h-full w-full max-w-[1080px] space-y-7 px-5 py-7 sm:px-8 sm:py-9"
      aria-label={t("home.label")}
    >
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {t("home.eyebrow")}
          </p>
          <div className="flex items-center gap-3">
            <img src="/twelia-icon.png" alt="" className="size-11 object-contain sm:size-14" />
            <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em] sm:text-[46px]">
              Twelia
            </h1>
          </div>
          <p className="mt-3 text-base leading-7 text-muted-foreground">{t("home.description")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant={clientReady ? "success" : "warning"}>
              {clientReady ? <CircleCheck /> : <CircleAlert />}
              {clientReady ? t("home.clientReady") : t("home.clientSetup")}
            </Badge>
            <Badge variant="outline" className="font-mono">
              DOFUS Touch {client.version ? `v${client.version}` : "—"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {mobile && lastGameTab && (
            <Button
              variant="outline"
              onClick={() => useTabStore.getState().selectTab(lastGameTab.id)}
            >
              <ArrowLeft /> {t("home.backToGame")}
            </Button>
          )}
          {modsEnabled && (
            <Button variant="outline" onClick={() => useTabStore.getState().openMods()}>
              <Puzzle /> {t("mods.page.title")}
            </Button>
          )}
          <Button variant="outline" onClick={() => useTabStore.getState().openSettings()}>
            <Settings /> {t("common.settings")}
          </Button>
        </div>
      </header>

      <section aria-labelledby="accounts-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {t(accounts.length === 1 ? "home.profile.one" : "home.profile.other", {
                count: accounts.length,
              })}
            </p>
            <h2
              id="accounts-title"
              className="mt-1 font-serif text-2xl font-semibold tracking-[-0.01em]"
            >
              {t("home.savedAccounts")}
            </h2>
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus /> {t("home.addAccount")}
          </Button>
        </div>

        {accounts.length === 0 ? (
          <Card className="border-dashed border-border-strong bg-card/60">
            <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <UserPlus />
              </div>
              <div>
                <CardTitle>{t("home.firstProfile")}</CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">{t("home.noPassword")}</p>
              </div>
              <Button onClick={() => setEditing("new")}>
                <Plus /> {t("home.addAccount")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                active={activeAccountIds.has(account.id)}
                onPlay={() => play(account)}
                onEdit={() => setEditing(account)}
                onReconnect={() => void setSessionStatus(account.id, "expired")}
                onLogout={() => void setSessionStatus(account.id, "logged-out")}
                onDelete={() => setDeleting(account)}
              />
            ))}
            <button
              type="button"
              className="flex min-h-[170px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong bg-transparent p-[18px] text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => setEditing("new")}
            >
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                <Plus className="size-5" />
              </span>
              <span className="text-sm font-semibold">{t("home.newProfile")}</span>
              <span className="text-xs text-muted-foreground">{t("home.noPasswordSaved")}</span>
            </button>
          </div>
        )}
      </section>

      {editing && (
        <AccountForm
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSubmit={save}
        />
      )}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDescription", { name: deleting?.displayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && void remove(deleting)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

const mobileStatusStyles: Record<AccountProfile["sessionStatus"], string> = {
  unknown: "border-border-strong bg-accent text-muted-foreground",
  valid: "border-success bg-[var(--success-bg)] text-success",
  expired: "border-warning bg-[var(--warning-bg)] text-warning",
  "logged-out": "border-danger bg-[var(--danger-bg)] text-danger",
};

function MobileAccountCard({
  account,
  active,
  onPlay,
  onEdit,
  onReconnect,
  onLogout,
  onDelete,
}: {
  account: AccountProfile;
  active: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const statusLabels: Record<AccountProfile["sessionStatus"], string> = {
    unknown: t("account.status.unknown"),
    valid: t("account.status.valid"),
    expired: t("account.status.expired"),
    "logged-out": t("account.status.loggedOut"),
  };

  return (
    <article className="rounded-[14px] border border-border bg-card p-3.5">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[10px] border text-[13px] font-extrabold",
            mobileStatusStyles[account.sessionStatus],
          )}
        >
          {account.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold leading-tight">{account.displayName}</h3>
          <span
            className={cn(
              "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
              mobileStatusStyles[account.sessionStatus],
            )}
          >
            {statusLabels[account.sessionStatus]}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t("account.actions", { name: account.displayName })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {t("account.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReconnect}>
              <RefreshCw /> {t("account.reconnect")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut /> {t("account.logout")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:text-danger" onSelect={onDelete}>
              <Trash2 /> {t("account.deleteLocal")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button className="mt-3 h-10 w-full text-[13px]" onClick={onPlay}>
        <Play /> {active ? t("account.show") : t("account.play")}
      </Button>
    </article>
  );
}
