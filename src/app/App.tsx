import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "../commands/CommandPalette";
import { useCommandUiStore } from "../commands/commandStore";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { findSessionByAccount, useGameSessionStore } from "../game/GameSessionManager";
import { needsBackgroundGameActivity, type GameAttentionEvent } from "../game/gameAttention";
import { handleGameAttention } from "../game/handleGameAttention";
import {
  keepGameSessionActive,
  setGameSessionMuted,
  setGameSessionVisibility,
} from "../game/GameRuntime";
import { useI18n } from "../i18n/i18n";
import { useMobileGameDeepLinks } from "../game/mobileGameBridge";
import { ModCommandShortcuts } from "../mods/ModCommandShortcuts";
import { isMobilePlatform, isTauriRuntime } from "../platform/platform";
import { ShortcutProvider } from "../shortcuts/ShortcutProvider";
import { useSettingsStore } from "../settings/settingsStore";
import { TabBar } from "../tabs/TabBar";
import { TabContent } from "../tabs/TabContent";
import { MobileTabMenu } from "../tabs/MobileTabMenu";
import { useTabStore } from "../tabs/tabStore";
import { startup } from "./startup";
import { DesktopTitleBar } from "./DesktopTitleBar";

type ModNotificationEvent = {
  modId: string;
  sessionId: string;
  title: string;
  body: string;
};

type ModFileDialogEvent = {
  requestId: string;
  operation: "open" | "save";
  suggestedName?: string;
};

export function App() {
  const { t } = useI18n();
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
  const muteInactiveTabs = useSettingsStore((state) => state.muteInactiveTabs);
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
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ModFileDialogEvent>("mod-file-dialog", ({ payload }) => {
      void (async () => {
        let path: string | null = null;
        try {
          if (payload.operation === "save") {
            path = await saveFileDialog({ defaultPath: payload.suggestedName });
          } else {
            const selected = await openFileDialog({ multiple: false, directory: false });
            path = typeof selected === "string" ? selected : null;
          }
        } finally {
          await invoke("complete_mod_file_dialog", {
            requestId: payload.requestId,
            path,
          });
        }
      })().catch((error) => {
        diagnosticLogger.warn("mods", `Sélecteur de fichier du mod interrompu : ${String(error)}`);
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ModNotificationEvent>("mod-notification", ({ payload }) => {
      toast(payload.title, {
        description: payload.body,
        id: `mod-${payload.modId}-${payload.sessionId}-${payload.title}`,
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
      void setGameSessionMuted(session.id, muteInactiveTabs && !visible).catch(() => undefined);
    }
  }, [activeTabId, muteInactiveTabs, ready, sessions]);

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
      if (useCommandUiStore.getState().paletteOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        useCommandUiStore.getState().closePalette();
        return;
      }
      if (
        event.defaultPrevented ||
        (event.target as HTMLElement | null)?.closest('[role="dialog"]')
      )
        return;
      if (Date.now() - useCommandUiStore.getState().paletteClosedAt < 250) return;
      if (useTabStore.getState().activeTabId !== "home")
        return useTabStore.getState().selectTab("home");
    };
    window.addEventListener("keydown", onBack, true);
    return () => window.removeEventListener("keydown", onBack, true);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<GameAttentionEvent>("game-attention", ({ payload }) => {
      const session = useGameSessionStore.getState().sessions[payload.sessionId];
      if (!session) return;
      handleGameAttention({
        accountId: session.accountId,
        kind: payload.kind,
        sessionId: payload.sessionId,
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
            <p className="text-sm text-muted-foreground">{t("app.restoring")}</p>
            <Skeleton className="h-1.5 w-32" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <ShortcutProvider>
      <ModCommandShortcuts />
      <div className="app-shell" style={{ fontSize: `${interfaceScale}rem` }}>
        {!mobile && <DesktopTitleBar />}
        {mobile ? <MobileTabMenu /> : <TabBar />}
        {startupError && (
          <Alert variant="destructive" className="z-30 rounded-none border-x-0 border-t-0 py-2">
            <AlertCircle />
            <AlertDescription>{t("app.partialRestore", { error: startupError })}</AlertDescription>
          </Alert>
        )}
        <div className="tab-content">
          <TabContent />
        </div>
        <CommandPalette />
        <Toaster />
      </div>
    </ShortcutProvider>
  );
}
