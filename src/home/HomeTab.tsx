import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, Plus, Settings, UserPlus } from "lucide-react";
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
import { AccountCard } from "../accounts/components/AccountCard";
import { AccountForm } from "../accounts/components/AccountForm";
import { useAccountStore } from "../accounts/accountStore";
import type { AccountDraft, AccountProfile } from "../accounts/accountTypes";
import { useGameSessionStore } from "../game/GameSessionManager";
import {
  EMPTY_CLIENT_STATUS,
  getClientStatus,
  onClientInstallProgress,
  type ClientStatus,
} from "../game/clientService";
import { isMobilePlatform, isTauriRuntime } from "../platform/platform";
import { useTabStore } from "../tabs/tabStore";

export function HomeTab() {
  const mobile = isMobilePlatform();
  const accounts = useAccountStore((state) => state.accounts);
  const createAccount = useAccountStore((state) => state.createAccount);
  const updateAccount = useAccountStore((state) => state.updateAccount);
  const removeAccount = useAccountStore((state) => state.removeAccount);
  const setSessionStatus = useAccountStore((state) => state.setSessionStatus);
  const openGame = useTabStore((state) => state.openGame);
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
    const accountSession = Object.values(sessions).find(
      (session) => session.accountId === account.id,
    );
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

  return (
    <main
      className="mx-auto min-h-full w-full max-w-[1080px] space-y-7 px-5 py-7 sm:px-8 sm:py-9"
      aria-label="Accueil Twelia"
    >
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Espace multi-session
          </p>
          <div className="flex items-center gap-3">
            <img src="/twelia-icon.png" alt="" className="size-11 object-contain sm:size-14" />
            <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em] sm:text-[46px]">
              Twelia
            </h1>
          </div>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Gérez vos comptes et ouvrez chaque session dans son propre onglet isolé.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant={clientReady ? "success" : "warning"}>
              {clientReady ? <CircleCheck /> : <CircleAlert />}
              {clientReady ? "Client prêt" : "Client à configurer"}
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
              <ArrowLeft /> Revenir au jeu
            </Button>
          )}
          <Button variant="outline" onClick={() => useTabStore.getState().openSettings()}>
            <Settings /> Paramètres
          </Button>
        </div>
      </header>

      <section aria-labelledby="accounts-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {accounts.length} profil{accounts.length > 1 ? "s" : ""}
            </p>
            <h2
              id="accounts-title"
              className="mt-1 font-serif text-2xl font-semibold tracking-[-0.01em]"
            >
              Comptes enregistrés
            </h2>
          </div>
          <Button onClick={() => setEditing("new")}>
            <Plus /> Ajouter un compte
          </Button>
        </div>

        {accounts.length === 0 ? (
          <Card className="border-dashed border-border-strong bg-card/60">
            <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <UserPlus />
              </div>
              <div>
                <CardTitle>Créer votre premier profil</CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  Aucun mot de passe ne sera enregistré.
                </p>
              </div>
              <Button onClick={() => setEditing("new")}>
                <Plus /> Ajouter un compte
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
              <span className="text-sm font-semibold">Nouveau profil</span>
              <span className="text-xs text-muted-foreground">Aucun mot de passe enregistré</span>
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
            <AlertDialogTitle>Supprimer ce profil ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les données locales de « {deleting?.displayName} » seront supprimées. Cette
              action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && void remove(deleting)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
