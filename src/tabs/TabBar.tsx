import { useEffect, useState, type ReactNode } from "react";
import { MoreHorizontal, Pin, PinOff, Plus, RefreshCw, Settings, X } from "lucide-react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAccountStore } from "../accounts/accountStore";
import { useGameSessionStore } from "../game/GameSessionManager";
import { setGameSessionVisibility } from "../game/GameRuntime";
import { isMobilePlatform } from "../platform/platform";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "./tabStore";
import type { WorkspaceTab } from "./tabTypes";

export function TabBar() {
  const mobile = isMobilePlatform();
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const accounts = useAccountStore((state) => state.accounts);
  const sessions = useGameSessionStore((state) => state.sessions);
  const compact = useSettingsStore((state) => state.compactTabs);
  const [dropdownTabId, setDropdownTabId] = useState<string>();
  const [contextTabId, setContextTabId] = useState<string>();
  const [pendingClose, setPendingClose] = useState<WorkspaceTab>();

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSession =
    activeTab?.type === "game"
      ? Object.values(sessions).find((session) => session.accountId === activeTab.accountId)
      : undefined;
  const overlayOpen = Boolean(dropdownTabId || contextTabId || pendingClose);

  useEffect(() => {
    if (!activeSession) return;
    void setGameSessionVisibility(activeSession.id, !overlayOpen).catch(() => undefined);
    return () => {
      if (overlayOpen) void setGameSessionVisibility(activeSession.id, true).catch(() => undefined);
    };
  }, [activeSession, overlayOpen]);

  const labelFor = (tab: WorkspaceTab) => {
    if (tab.type === "home") return "Twelia";
    if (tab.type === "settings") return "Paramètres";
    return (
      accounts.find((account) => account.id === tab.accountId)?.displayName ?? "Compte supprimé"
    );
  };

  const sessionFor = (tab: WorkspaceTab) =>
    tab.type === "game"
      ? Object.values(sessions).find((session) => session.accountId === tab.accountId)
      : undefined;

  const requestClose = (tab: WorkspaceTab) => {
    if (tab.type === "home") return;
    const session = sessionFor(tab);
    if (session?.status === "running" && useSettingsStore.getState().confirmConnectedSessionClose) {
      setPendingClose(tab);
      return;
    }
    void close(tab);
  };

  const close = async (tab: WorkspaceTab) => {
    if (tab.type === "game") {
      const session = sessionFor(tab);
      if (session) await useGameSessionStore.getState().stop(session.id);
    }
    useTabStore.getState().closeTab(tab.id);
    setPendingClose(undefined);
  };

  const pin = (tab: WorkspaceTab) => useTabStore.getState().togglePin(tab.id);
  const reload = (tab: WorkspaceTab) => {
    const session = sessionFor(tab);
    if (session) void useGameSessionStore.getState().reload(session.id);
  };

  const contextActions = (tab: WorkspaceTab): ReactNode => (
    <>
      {tab.type === "game" && (
        <>
          <ContextMenuItem onSelect={() => pin(tab)}>
            {tab.pinned ? <PinOff /> : <Pin />}
            {tab.pinned ? "Désépingler" : "Épingler"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => reload(tab)}>
            <RefreshCw /> Recharger la session
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={() => requestClose(tab)}>
        <X /> Fermer
      </ContextMenuItem>
    </>
  );

  return (
    <>
      <Tabs
        className="shrink-0"
        value={activeTabId}
        onValueChange={(value) => useTabStore.getState().selectTab(value)}
      >
        <nav
          className={cn(
            "relative z-20 shrink-0 border-b border-border bg-background/95 backdrop-blur-xl",
            !mobile && "pt-[env(safe-area-inset-top)]",
          )}
          aria-label="Onglets principaux"
        >
          <TabsList
            className={cn(
              "flex w-full justify-start overflow-x-auto overflow-y-hidden rounded-none bg-transparent text-muted-foreground",
              mobile ? "h-10 px-1 pt-0" : "h-14 px-2 pt-2",
            )}
          >
            {tabs.map((tab) => {
              const gameSession = sessionFor(tab);
              const active = tab.id === activeTabId;
              return (
                <ContextMenu
                  key={tab.id}
                  onOpenChange={(open) => setContextTabId(open ? tab.id : undefined)}
                >
                  <ContextMenuTrigger asChild disabled={tab.type === "home"}>
                    <div
                      draggable={tab.type !== "home"}
                      className={cn(
                        "group relative flex shrink-0 items-center rounded-t-lg border border-b-0 border-transparent",
                        mobile ? "h-9 max-w-44" : "h-11",
                        !mobile && (compact ? "max-w-44" : "max-w-60"),
                        active &&
                          "border-border bg-card text-foreground shadow-[inset_0_2px_0_var(--color-primary)]",
                      )}
                      onDragStart={(event) => event.dataTransfer.setData("text/tab-id", tab.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) =>
                        useTabStore
                          .getState()
                          .reorder(event.dataTransfer.getData("text/tab-id"), tab.id)
                      }
                    >
                      <TabsTrigger
                        value={tab.id}
                        className={cn(
                          "h-full min-w-0 flex-1 justify-start rounded-t-lg rounded-b-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                          mobile ? "gap-1.5 px-2 text-xs" : "gap-2 px-3",
                        )}
                      >
                        {tab.type === "home" && (
                          <img
                            src="/twelia-icon.png"
                            alt=""
                            className="size-5 shrink-0 object-contain"
                          />
                        )}
                        {tab.type === "settings" && <Settings className="size-4 shrink-0" />}
                        {tab.type === "game" && (
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full bg-muted-foreground",
                              gameSession?.status === "running" &&
                                "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.12)]",
                              ["error", "disconnected"].includes(gameSession?.status ?? "") &&
                                "bg-red-400",
                              ["starting", "authenticating"].includes(gameSession?.status ?? "") &&
                                "animate-pulse bg-amber-400",
                            )}
                          />
                        )}
                        <span className="truncate">{labelFor(tab)}</span>
                        {tab.type === "game" && tab.pinned && (
                          <Pin className="size-3 shrink-0 text-primary" aria-label="Épinglé" />
                        )}
                      </TabsTrigger>

                      {tab.type === "game" && (
                        <DropdownMenu
                          open={dropdownTabId === tab.id}
                          onOpenChange={(open) => setDropdownTabId(open ? tab.id : undefined)}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "mr-0.5 shrink-0 opacity-60 hover:opacity-100",
                                mobile ? "size-7" : "size-8",
                              )}
                              aria-label={`Actions pour ${labelFor(tab)}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" sideOffset={8}>
                            <DropdownMenuItem onSelect={() => pin(tab)}>
                              {tab.pinned ? <PinOff /> : <Pin />}
                              {tab.pinned ? "Désépingler" : "Épingler"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => reload(tab)}>
                              <RefreshCw /> Recharger la session
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => requestClose(tab)}>
                              <X /> Fermer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {tab.type !== "home" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "mr-1 shrink-0 opacity-60 hover:opacity-100",
                            mobile ? "size-7" : "size-8",
                          )}
                          aria-label={`Fermer ${labelFor(tab)}`}
                          onClick={() => requestClose(tab)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  {tab.type !== "home" && (
                    <ContextMenuContent>{contextActions(tab)}</ContextMenuContent>
                  )}
                </ContextMenu>
              );
            })}
            <Button
              variant="ghost"
              size="icon"
              className={cn("ml-1 shrink-0", mobile ? "size-8" : "mt-0.5")}
              aria-label="Nouvelle session"
              onClick={() => useTabStore.getState().selectTab("home")}
            >
              <Plus />
            </Button>
          </TabsList>
        </nav>
      </Tabs>

      <AlertDialog
        open={Boolean(pendingClose)}
        onOpenChange={(open) => !open && setPendingClose(undefined)}
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
