import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette } from "../commands/CommandPalette";
import { useCommandUiStore } from "../commands/commandStore";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { findSessionByAccount, useGameSessionStore } from "../game/GameSessionManager";
import {
  needsBackgroundGameActivity,
  shouldAutoSwitchToGame,
  type GameAttentionEvent,
} from "../game/gameAttention";
import { keepGameSessionActive, setGameSessionVisibility } from "../game/GameRuntime";
import { useMobileGameDeepLinks } from "../game/mobileGameBridge";
import { isMobilePlatform, isTauriRuntime } from "../platform/platform";
import { ShortcutProvider } from "../shortcuts/ShortcutProvider";
import { useSettingsStore } from "../settings/settingsStore";
import { TabBar } from "../tabs/TabBar";
import { TabContent } from "../tabs/TabContent";
import { MobileTabMenu } from "../tabs/MobileTabMenu";
import { useTabStore } from "../tabs/tabStore";
import { startup } from "./startup";
import { DesktopTitleBar } from "./DesktopTitleBar";

export function App() {
  useMobileGameDeepLinks();
  const mobile = isMobilePlatform();
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string>();
  const activeTabId = useTabStore((state) => state.activeTabId);
  const sessions = useGameSessionStore((state) => state.sessions);
  const interfaceScale = useSettingsStore((state) => state.interfaceScale);
  const theme = useSettingsStore((state) => state.theme);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const suspendInactiveTabs = useSettingsStore((state) => state.suspendInactiveTabs);
  const keepGamesActive = useSettingsStore(needsBackgroundGameActivity);

  useEffect(() => {
    void startup()
      .then(() => setReady(true))
      .catch((error) => {
        diagnosticLogger.error("startup", String(error));
        setStartupError(error instanceof Error ? error.message : String(error));
        setReady(true);
      });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      root.dataset.theme = theme === "system" ? (media.matches ? "light" : "dark") : theme;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    if (!ready) return;
    const active = useTabStore.getState().tabs.find((tab) => tab.id === activeTabId);
    for (const session of Object.values(sessions)) {
      const visible =
        active?.type === "game" &&
        active.accountId === session.accountId &&
        !["error", "stopped"].includes(session.status);
      void setGameSessionVisibility(session.id, visible).catch(() => undefined);
    }
  }, [activeTabId, ready, sessions]);

  useEffect(() => {
    if (!ready || !suspendInactiveTabs) return;
    if (keepGamesActive) {
      for (const session of Object.values(useGameSessionStore.getState().sessions)) {
        if (session.status !== "suspended") continue;
        void keepGameSessionActive(session.id)
          .then(() => useGameSessionStore.getState().setStatus(session.id, "running"))
          .catch(() => undefined);
      }
      return;
    }
    const active = useTabStore.getState().tabs.find((tab) => tab.id === activeTabId);
    for (const tab of useTabStore.getState().tabs) {
      if (tab.type !== "game") continue;
      const session = findSessionByAccount(useGameSessionStore.getState().sessions, tab.accountId);
      if (!session) continue;
      if (tab.id === active?.id && session.status === "suspended")
        void useGameSessionStore.getState().resume(session.id);
      if (tab.id !== active?.id && session.status === "running")
        void useGameSessionStore.getState().suspend(session.id);
    }
  }, [activeTabId, keepGamesActive, ready, sessions, suspendInactiveTabs]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden || needsBackgroundGameActivity(useSettingsStore.getState())) return;
      for (const session of Object.values(useGameSessionStore.getState().sessions)) {
        if (session.status === "running") void useGameSessionStore.getState().suspend(session.id);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const onBack = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useCommandUiStore.getState().paletteOpen)
        return useCommandUiStore.getState().closePalette();
      if (useTabStore.getState().activeTabId !== "home")
        return useTabStore.getState().selectTab("home");
    };
    window.addEventListener("keydown", onBack);
    return () => window.removeEventListener("keydown", onBack);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<GameAttentionEvent>("game-attention", ({ payload }) => {
      const settings = useSettingsStore.getState();
      if (!shouldAutoSwitchToGame(settings, payload.kind)) return;
      const session = useGameSessionStore.getState().sessions[payload.sessionId];
      if (!session) return;
      const tabs = useTabStore.getState();
      const target = tabs.tabs.find(
        (tab) => tab.type === "game" && tab.accountId === session.accountId,
      );
      if (target?.id === tabs.activeTabId) return;
      if (target) tabs.selectTab(target.id);
      else tabs.openGame(session.accountId);
      diagnosticLogger.info("game-attention", `Changement d’onglet: ${payload.kind}`, {
        gameSessionId: payload.sessionId,
        accountId: session.accountId,
      });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!ready) {
    return (
      <main className="grid h-full place-items-center bg-[radial-gradient(circle,var(--color-card),var(--color-background)_62%)] p-6">
        <Card className="w-full max-w-sm bg-card/80 backdrop-blur">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary/10 p-2">
              <img src="/twelia-icon.png" alt="" className="size-full object-contain" />
            </div>
            <strong className="text-2xl">Twelia</strong>
            <p className="text-sm text-muted-foreground">Restauration de l’espace de travail…</p>
            <Skeleton className="h-1.5 w-32" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <ShortcutProvider>
      <div className="app-shell" style={{ fontSize: `${interfaceScale}rem` }}>
        {!mobile && <DesktopTitleBar />}
        {mobile ? <MobileTabMenu /> : <TabBar />}
        {startupError && (
          <Alert variant="destructive" className="z-30 rounded-none border-x-0 border-t-0 py-2">
            <AlertCircle />
            <AlertDescription>Restauration partielle : {startupError}</AlertDescription>
          </Alert>
        )}
        <div className="tab-content">
          <TabContent />
        </div>
        <CommandPalette />
      </div>
    </ShortcutProvider>
  );
}
