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
import { findSessionByAccount, useGameSessionStore } from "../game/GameSessionManager";
import { setGameSessionVisibility } from "../game/GameRuntime";
import { useI18n } from "../i18n/i18n";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "./tabStore";
import type { WorkspaceTab } from "./tabTypes";

export function TabBar() {
  const { t } = useI18n();
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
    activeTab?.type === "game" ? findSessionByAccount(sessions, activeTab.accountId) : undefined;
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
    if (tab.type === "settings") return t("common.settings");
    return (
      accounts.find((account) => account.id === tab.accountId)?.displayName ??
      t("tabs.deletedAccount")
    );
  };

  const sessionFor = (tab: WorkspaceTab) =>
    tab.type === "game" ? findSessionByAccount(sessions, tab.accountId) : undefined;

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
            {tab.pinned ? t("tabs.unpin") : t("tabs.pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => reload(tab)}>
            <RefreshCw /> {t("tabs.reload")}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={() => requestClose(tab)}>
        <X /> {t("common.close")}
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
          className="relative z-20 shrink-0 border-b border-border bg-chrome"
          aria-label={t("tabs.main")}
        >
          <TabsList className="flex h-[50px] w-full justify-start gap-1.5 overflow-x-auto overflow-y-hidden rounded-none bg-transparent px-3 text-muted-foreground">
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
                        "group relative flex h-8 shrink-0 items-center rounded-full border border-border bg-secondary text-muted-foreground transition-[background-color,color,border-color,box-shadow]",
                        compact ? "max-w-44" : "max-w-60",
                        active &&
                          "border-primary bg-primary text-primary-foreground shadow-[0_5px_14px_rgba(231,178,76,.16)]",
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
                          "h-full min-w-0 flex-1 justify-start gap-2 rounded-full bg-transparent px-3 text-[13px] font-extrabold text-inherit shadow-none data-[state=active]:bg-transparent data-[state=active]:text-inherit data-[state=active]:shadow-none",
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
                                "bg-success shadow-[0_0_0_3px_var(--success-bg)]",
                              ["error", "disconnected"].includes(gameSession?.status ?? "") &&
                                "bg-danger",
                              ["starting", "authenticating"].includes(gameSession?.status ?? "") &&
                                "session-dot-pulse bg-warning",
                            )}
                          />
                        )}
                        <span className="truncate">{labelFor(tab)}</span>
                        {tab.type === "game" && tab.pinned && (
                          <Pin
                            className="size-3 shrink-0 text-primary"
                            aria-label={t("tabs.pinned")}
                          />
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
                                "mr-0.5 size-7 shrink-0 rounded-full opacity-60 shadow-none hover:bg-black/10 hover:opacity-100",
                              )}
                              aria-label={t("tabs.actions", { name: labelFor(tab) })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" sideOffset={8}>
                            <DropdownMenuItem onSelect={() => pin(tab)}>
                              {tab.pinned ? <PinOff /> : <Pin />}
                              {tab.pinned ? t("tabs.unpin") : t("tabs.pin")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => reload(tab)}>
                              <RefreshCw /> {t("tabs.reload")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => requestClose(tab)}>
                              <X /> {t("common.close")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {tab.type !== "home" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "mr-1 size-7 shrink-0 rounded-full opacity-60 shadow-none hover:bg-black/10 hover:opacity-100",
                          )}
                          aria-label={t("tabs.closeNamed", { name: labelFor(tab) })}
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
              className="ml-0.5 size-8 shrink-0 rounded-full border border-border bg-transparent text-muted-foreground shadow-none hover:border-primary/35 hover:text-foreground"
              aria-label={t("tabs.newSession")}
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
            <AlertDialogTitle>{t("tabs.closeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tabs.closeDescription", {
                name: pendingClose ? labelFor(pendingClose) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingClose && void close(pendingClose)}>
              {t("common.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
