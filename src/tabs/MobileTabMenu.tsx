import { useState } from "react";
import { Check, Gamepad2, Home, RefreshCw, Settings, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAccountStore } from "../accounts/accountStore";
import { useGameSessionStore } from "../game/GameSessionManager";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "./tabStore";
import type { WorkspaceTab } from "./tabTypes";

export function MobileTabMenu() {
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const accounts = useAccountStore((state) => state.accounts);
  const sessions = useGameSessionStore((state) => state.sessions);
  const [open, setOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<WorkspaceTab>();

  const labelFor = (tab: WorkspaceTab) => {
    if (tab.type === "home") return "Accueil Twelia";
    if (tab.type === "settings") return "Paramètres";
    return (
      accounts.find((account) => account.id === tab.accountId)?.displayName ?? "Compte supprimé"
    );
  };

  const sessionFor = (tab: WorkspaceTab) =>
    tab.type === "game"
      ? Object.values(sessions).find((session) => session.accountId === tab.accountId)
      : undefined;

  const close = async (tab: WorkspaceTab) => {
    if (tab.type === "game") {
      const session = sessionFor(tab);
      if (session) await useGameSessionStore.getState().stop(session.id);
    }
    useTabStore.getState().closeTab(tab.id);
    setPendingClose(undefined);
  };

  const requestClose = (tab: WorkspaceTab) => {
    const session = sessionFor(tab);
    if (session?.status === "running" && useSettingsStore.getState().confirmConnectedSessionClose) {
      setOpen(false);
      setPendingClose(tab);
      return;
    }
    void close(tab);
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSession = activeTab ? sessionFor(activeTab) : undefined;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed left-3 top-3 z-[70] size-10 rounded-full border-primary/40 bg-background/75 p-1.5 shadow-xl backdrop-blur-md"
            aria-label="Ouvrir les onglets Twelia"
          >
            <img src="/twelia-icon.png" alt="" className="size-full object-contain" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="z-[80] max-h-[calc(100vh-4.5rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto bg-background/90 backdrop-blur-xl"
        >
          {tabs.map((tab) => {
            const session = sessionFor(tab);
            const active = tab.id === activeTabId;
            return (
              <DropdownMenuItem
                key={tab.id}
                className="gap-3"
                onSelect={() => useTabStore.getState().selectTab(tab.id)}
              >
                {tab.type === "home" && <Home />}
                {tab.type === "settings" && <Settings />}
                {tab.type === "game" && (
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full bg-muted-foreground",
                      session?.status === "running" && "bg-emerald-400",
                      ["error", "disconnected"].includes(session?.status ?? "") && "bg-red-400",
                      ["starting", "authenticating"].includes(session?.status ?? "") &&
                        "animate-pulse bg-amber-400",
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{labelFor(tab)}</span>
                {active && <Check className="text-primary" />}
              </DropdownMenuItem>
            );
          })}

          {activeTab?.type === "game" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  activeSession && void useGameSessionStore.getState().reload(activeSession.id)
                }
              >
                <RefreshCw /> Recharger {labelFor(activeTab)}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => requestClose(activeTab)}>
                <X /> Fermer {labelFor(activeTab)}
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useTabStore.getState().selectTab("home")}>
            <Gamepad2 /> Gérer les comptes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={Boolean(pendingClose)}
        onOpenChange={(nextOpen) => !nextOpen && setPendingClose(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fermer la session ?</AlertDialogTitle>
            <AlertDialogDescription>
              La session « {pendingClose ? labelFor(pendingClose) : ""} » est encore connectée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingClose && void close(pendingClose)}>
              Fermer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
