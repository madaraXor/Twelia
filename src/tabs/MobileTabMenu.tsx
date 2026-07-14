import { useState } from "react";
import { Check, Gamepad2, RefreshCw, Settings, X } from "lucide-react";
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
import { getGameConnectionStatus } from "../game/gameConnection";
import { findSessionByAccount, useGameSessionStore } from "../game/GameSessionManager";
import { useI18n, type Translate } from "../i18n/i18n";
import type { GameSession } from "../game/gameTypes";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "./tabStore";
import type { WorkspaceTab } from "./tabTypes";

function statusColor(session?: GameSession) {
  const status = getGameConnectionStatus(session);
  return cn(
    "bg-muted-foreground",
    status === "connected" && "bg-success",
    status === "disconnected" && "bg-danger",
    status === "connecting" && "session-dot-pulse bg-warning",
  );
}

function statusDot(session?: GameSession) {
  return cn("size-2 shrink-0 rounded-full", statusColor(session));
}

function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

function statusLabel(session: GameSession | undefined, t: Translate) {
  const status = getGameConnectionStatus(session);
  if (status === "connected") return t("session.status.connected");
  if (status === "connecting") return t("session.status.connecting");
  if (status === "disconnected") return t("session.status.disconnected");
  return t("session.status.check");
}

export function MobileTabMenu() {
  const { t } = useI18n();
  const tabs = useTabStore((state) => state.tabs);
  const activeTabId = useTabStore((state) => state.activeTabId);
  const accounts = useAccountStore((state) => state.accounts);
  const sessions = useGameSessionStore((state) => state.sessions);
  const showQuickSwitch = useSettingsStore((state) => state.showMobileQuickSwitch);
  const showSessionPill = useSettingsStore((state) => state.showMobileSessionPill);
  const [open, setOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<WorkspaceTab>();

  const gameTabs = tabs.filter((tab) => tab.type === "game");
  const labelFor = (tab: WorkspaceTab) => {
    if (tab.type === "home") return t("home.label");
    if (tab.type === "settings") return t("common.settings");
    return (
      accounts.find((account) => account.id === tab.accountId)?.displayName ??
      t("tabs.deletedAccount")
    );
  };

  const sessionFor = (tab: WorkspaceTab) =>
    tab.type === "game" ? findSessionByAccount(sessions, tab.accountId) : undefined;

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
    if (
      session?.connectionStatus === "connected" &&
      useSettingsStore.getState().confirmConnectedSessionClose
    ) {
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
            className={cn(
              "fixed z-[70] size-[50px] rounded-full border-primary/45 bg-background/80 p-2 shadow-[0_6px_18px_rgba(0,0,0,.5)] backdrop-blur-md",
              activeTab?.type === "game"
                ? "left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))]"
                : "bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))]",
              activeTab?.type !== "game" && "hidden",
            )}
            aria-label={t("tabs.mobile.open")}
          >
            <img src="/twelia-icon.png" alt="" className="size-full object-contain" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={10}
          className="z-[80] max-h-[calc(100vh-5.5rem)] w-[270px] max-w-[calc(100vw-2rem)] overflow-y-auto bg-popover/95 p-1.5 backdrop-blur-xl"
        >
          <div className="px-3.5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("tabs.mobile.sessions")}
          </div>
          {gameTabs.length === 0 && (
            <p className="px-3.5 py-3 text-[13px] text-muted-foreground">
              {t("tabs.mobile.empty")}
            </p>
          )}
          {gameTabs.map((tab) => {
            const session = sessionFor(tab);
            const active = tab.id === activeTabId;
            return (
              <DropdownMenuItem
                key={tab.id}
                className={cn("gap-3 px-3.5", active && "bg-surface-elevated font-extrabold")}
                onSelect={() => useTabStore.getState().selectTab(tab.id)}
              >
                <span className={statusDot(session)} />
                <span className="min-w-0 flex-1 truncate">{labelFor(tab)}</span>
                {active && <Check className="text-primary" />}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useTabStore.getState().selectTab("home")}>
            <Gamepad2 /> {t("tabs.mobile.manage")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useTabStore.getState().openSettings()}>
            <Settings /> {t("common.settings")}
          </DropdownMenuItem>

          {activeTab?.type === "game" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  activeSession && void useGameSessionStore.getState().reload(activeSession.id)
                }
              >
                <RefreshCw /> {t("tabs.reload")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                onSelect={() => requestClose(activeTab)}
              >
                <X /> {t("tabs.mobile.close")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeTab?.type === "game" && showQuickSwitch && !open && gameTabs.length > 0 && (
        <nav
          className="fixed left-[max(.875rem,env(safe-area-inset-left))] top-[calc(max(1rem,env(safe-area-inset-top))+62px)] z-[65] flex max-h-[calc(100vh-6rem)] flex-col gap-2.5 overflow-y-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={t("settings.mobileQuickSwitch.label")}
        >
          {gameTabs.map((tab) => {
            const session = sessionFor(tab);
            const label = labelFor(tab);
            const active = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                title={label}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                onClick={() => useTabStore.getState().selectTab(tab.id)}
                className={cn(
                  "relative grid size-[46px] shrink-0 place-items-center rounded-[14px] border border-border-strong bg-background/80 text-sm font-extrabold text-muted-foreground shadow-[0_6px_16px_rgba(0,0,0,.45)] backdrop-blur-md transition-colors",
                  active && "border-primary bg-primary/15 text-primary",
                )}
              >
                {accountInitials(label)}
                <span
                  className={cn(
                    "absolute -right-1 -top-1 size-3 rounded-full border-2 border-background",
                    statusColor(session),
                  )}
                />
              </button>
            );
          })}
        </nav>
      )}

      {activeTab?.type === "game" && showSessionPill && (
        <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/80 px-3.5 py-2 text-xs font-semibold text-foreground shadow-lg backdrop-blur-md">
          <span className={statusDot(activeSession)} />
          <span className="max-w-52 truncate">
            {labelFor(activeTab)} · {statusLabel(activeSession, t)}
          </span>
        </div>
      )}

      <AlertDialog
        open={Boolean(pendingClose)}
        onOpenChange={(nextOpen) => !nextOpen && setPendingClose(undefined)}
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
