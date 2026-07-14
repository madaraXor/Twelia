import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccountStore } from "../accounts/accountStore";
import { createId } from "../core/id";
import { useI18n } from "../i18n/i18n";
import { isMobilePlatform } from "../platform/platform";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "../tabs/tabStore";
import { gameTabId } from "../tabs/tabTypes";
import { findSessionByAccount, useGameSessionStore } from "./GameSessionManager";
import {
  getGameSessionUrl,
  layoutGameSession,
  MOBILE_GAME_RELOAD_EVENT,
  type MobileGameReloadDetail,
} from "./GameRuntime";
import { type GameAttentionKind } from "./gameAttention";
import { handleGameAttention } from "./handleGameAttention";
import {
  clearMobileOAuthTarget,
  rememberMobileOAuthTarget,
  subscribeMobileOAuthCallback,
  type MobileOAuthCallback,
} from "./mobileGameBridge";
import { computeMobileGameFrameLayout, type MobileGameFrameLayout } from "./mobileGameLayout";

function postMobileGameMuted(
  iframe: HTMLIFrameElement | null,
  mobileUrl: string | undefined,
  muted: boolean,
): void {
  if (!iframe || !mobileUrl) return;
  iframe.contentWindow?.postMessage(
    { source: "twelia-host", type: "set-muted", muted },
    new URL(mobileUrl).origin,
  );
}

function requestMobileGameConnectionStatus(
  iframe: HTMLIFrameElement | null,
  mobileUrl: string | undefined,
): void {
  if (!iframe || !mobileUrl) return;
  iframe.contentWindow?.postMessage(
    { source: "twelia-host", type: "get-connection-status" },
    new URL(mobileUrl).origin,
  );
}

export function GameTab({ accountId }: { accountId: string }) {
  const { t } = useI18n();
  const account = useAccountStore((state) => state.accounts.find((item) => item.id === accountId));
  const sessions = useGameSessionStore((state) => state.sessions);
  const session = findSessionByAccount(sessions, accountId);
  const sessionId = session?.id;
  const sessionStatus = session?.status;
  const viewportRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mobile = isMobilePlatform();
  const active = useTabStore((state) => state.activeTabId === gameTabId(accountId));
  const muteInactiveTabs = useSettingsStore((state) => state.muteInactiveTabs);
  const [mobileUrl, setMobileUrl] = useState<string>();
  const [authError, setAuthError] = useState<string>();
  const [mobileFrameLayout, setMobileFrameLayout] = useState<MobileGameFrameLayout>();
  const mobileMutedRef = useRef(muteInactiveTabs && !active);
  const mobileOAuthRetryTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    mobileMutedRef.current = muteInactiveTabs && !active;
  }, [active, muteInactiveTabs]);

  useEffect(() => {
    if (session || !account) return;
    void useGameSessionStore
      .getState()
      .createForAccount(accountId)
      .then((created) => useGameSessionStore.getState().start(created.id))
      .catch(() => undefined);
  }, [account, accountId, session]);

  useEffect(() => {
    if (mobile) return;
    const viewport = viewportRef.current;
    if (!viewport || !sessionId || sessionStatus === "error" || sessionStatus === "stopped") return;
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = viewport.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        void layoutGameSession(sessionId, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }).catch(() => undefined);
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.cancelAnimationFrame(frame);
    };
  }, [mobile, sessionId, sessionStatus]);

  useEffect(() => {
    if (!mobile || !sessionId || sessionStatus !== "running") return;
    let disposed = false;
    void getGameSessionUrl(sessionId)
      .then((url) => {
        if (!disposed) setMobileUrl(url);
      })
      .catch((error) => {
        if (!disposed)
          useGameSessionStore
            .getState()
            .setStatus(sessionId, "error", error instanceof Error ? error.message : String(error));
      });
    return () => {
      disposed = true;
    };
  }, [mobile, sessionId, sessionStatus]);

  useLayoutEffect(() => {
    if (!mobile || !mobileUrl) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const rect = viewport.getBoundingClientRect();
      const next = computeMobileGameFrameLayout(rect.width, rect.height);
      if (!next) return;
      setMobileFrameLayout((current) =>
        current &&
        Math.abs(current.width - next.width) < 0.1 &&
        Math.abs(current.height - next.height) < 0.1 &&
        Math.abs(current.scale - next.scale) < 0.0001
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    sync();
    return () => observer.disconnect();
  }, [mobile, mobileUrl]);

  useEffect(() => {
    if (!mobile || !mobileUrl || !sessionId) return;
    const onReload = (event: Event) => {
      const detail = (event as CustomEvent<MobileGameReloadDetail>).detail;
      if (detail.sessionId !== sessionId) return;
      const iframe = iframeRef.current;
      if (!iframe) return;
      useGameSessionStore.getState().setConnectionStatus(sessionId, "connecting");
      iframe.src = mobileUrl;
    };
    window.addEventListener(MOBILE_GAME_RELOAD_EVENT, onReload);
    return () => window.removeEventListener(MOBILE_GAME_RELOAD_EVENT, onReload);
  }, [mobile, mobileUrl, sessionId]);

  useEffect(() => {
    if (!mobile || !mobileUrl) return;
    const gameOrigin = new URL(mobileUrl).origin;
    const retryTimers = mobileOAuthRetryTimersRef.current;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== gameOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        type?: string;
        url?: string;
        kind?: string;
        status?: string;
        muted?: boolean;
        requestId?: string;
        accepted?: boolean;
        compatibilityVersion?: number;
      };
      if (data?.source !== "twelia-game") return;
      if (data.type === "bridge-ready") {
        postMobileGameMuted(iframeRef.current, mobileUrl, mobileMutedRef.current);
        requestMobileGameConnectionStatus(iframeRef.current, mobileUrl);
        console.info(`Pont du jeu mobile prêt (compatibilité ${data.compatibilityVersion ?? "?"})`);
      }
      if (
        data.type === "mute-state" &&
        typeof data.muted === "boolean" &&
        data.muted !== mobileMutedRef.current
      ) {
        postMobileGameMuted(iframeRef.current, mobileUrl, mobileMutedRef.current);
      }
      if (
        data.type === "connection-status" &&
        ["connecting", "connected", "disconnected"].includes(data.status ?? "") &&
        sessionId
      ) {
        const connectionStatus = data.status as "connecting" | "connected" | "disconnected";
        useGameSessionStore.getState().setConnectionStatus(sessionId, connectionStatus);
        void useAccountStore
          .getState()
          .setSessionStatus(accountId, connectionStatus === "connected" ? "valid" : "logged-out");
      }
      if (data.type === "oauth-callback-received" && data.accepted === true && data.requestId) {
        const timer = retryTimers.get(data.requestId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          retryTimers.delete(data.requestId);
          setAuthError(undefined);
        }
      }
      if (data.type === "open-auth" && data.url) {
        try {
          const url = new URL(data.url);
          if (url.protocol === "https:") {
            setAuthError(undefined);
            rememberMobileOAuthTarget(accountId);
            void invoke("open_external_auth_url", { url: url.toString() }).catch(
              (error: unknown) => {
                clearMobileOAuthTarget(accountId);
                const message =
                  error instanceof Error
                    ? error.message
                    : typeof error === "object" &&
                        error !== null &&
                        "message" in error &&
                        typeof error.message === "string"
                      ? error.message
                      : t("game.authOpenFailed");
                console.error(message, error);
                setAuthError(message);
              },
            );
          }
        } catch {
          return;
        }
      }
      if (
        data.type === "attention" &&
        ["combat-turn", "party-invitation", "group-fight"].includes(data.kind ?? "")
      ) {
        const kind = data.kind as GameAttentionKind;
        handleGameAttention({ accountId, kind, sessionId });
      }
    };
    const onOAuth = (callback: MobileOAuthCallback) => {
      const requestId = createId();
      let attempts = 0;
      const send = () => {
        attempts += 1;
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: "twelia-host",
            type: "oauth-callback",
            requestId,
            payload: callback.payload,
          },
          gameOrigin,
        );
        const timer = window.setTimeout(() => {
          if (attempts >= 10) {
            retryTimers.delete(requestId);
            setAuthError(t("game.authCallbackFailed"));
            return;
          }
          send();
        }, 500);
        retryTimers.set(requestId, timer);
      };
      setAuthError(undefined);
      send();
    };
    window.addEventListener("message", onMessage);
    const unsubscribeOAuth = subscribeMobileOAuthCallback(accountId, onOAuth);
    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribeOAuth();
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      retryTimers.clear();
    };
  }, [accountId, mobile, mobileUrl, sessionId, t]);

  useEffect(() => {
    if (!mobile) return;
    postMobileGameMuted(iframeRef.current, mobileUrl, muteInactiveTabs && !active);
  }, [active, mobile, mobileUrl, muteInactiveTabs]);

  if (!account) {
    return (
      <main className="grid h-full place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <TriangleAlert />
          <AlertTitle>{t("game.profileMissing")}</AlertTitle>
          <AlertDescription>{t("game.accountDeleted")}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const failed = session?.status === "error";
  if (mobile && session?.status === "running" && mobileUrl) {
    return (
      <main
        ref={viewportRef}
        className="game-page relative h-full min-h-0 overflow-hidden bg-black"
      >
        {authError && (
          <Alert variant="destructive" className="absolute left-3 right-3 top-3 z-20 w-auto">
            <TriangleAlert />
            <AlertTitle>{t("game.authFailed")}</AlertTitle>
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        )}
        <iframe
          ref={iframeRef}
          src={mobileUrl}
          title={`DOFUS Touch — ${account.displayName}`}
          className="absolute left-0 top-0 block border-0 bg-black"
          allow="autoplay; fullscreen"
          onLoad={() => {
            postMobileGameMuted(iframeRef.current, mobileUrl, muteInactiveTabs && !active);
            requestMobileGameConnectionStatus(iframeRef.current, mobileUrl);
          }}
          style={
            mobileFrameLayout
              ? {
                  width: mobileFrameLayout.width,
                  height: mobileFrameLayout.height,
                  transform: `scale(${mobileFrameLayout.scale})`,
                  transformOrigin: "top left",
                }
              : { width: "100%", height: "100%" }
          }
        />
      </main>
    );
  }
  return (
    <main className="game-page grid h-full min-h-0 grid-rows-[1fr]">
      <section
        ref={viewportRef}
        className="game-viewport relative min-h-0 min-w-0 overflow-hidden bg-black"
      >
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle,var(--color-card),var(--color-background)_62%)] p-6 text-center">
          <Card className="w-full max-w-lg bg-card/85 backdrop-blur">
            <CardHeader className="items-center">
              <div className="grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
                {failed ? (
                  <TriangleAlert />
                ) : session?.status === "running" ? (
                  <ShieldCheck />
                ) : (
                  <LoaderCircle className="animate-spin" />
                )}
              </div>
              <CardTitle className="pt-2 text-2xl">
                {failed
                  ? t("game.startFailed")
                  : session?.status === "running"
                    ? t("game.started")
                    : t("game.starting")}
              </CardTitle>
              <Badge
                variant={
                  failed ? "destructive" : session?.status === "running" ? "success" : "warning"
                }
              >
                {session?.status ?? t("game.creating")}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                {session?.error ?? t("game.loadingDescription")}
              </p>
              <Card className="bg-background/50 text-left shadow-none">
                <CardContent className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-xs">
                  <span className="text-muted-foreground">{t("game.session")}</span>
                  <code>{session?.id.slice(0, 8) ?? "—"}</code>
                  <span className="text-muted-foreground">{t("game.isolation")}</span>
                  <code className="truncate">{session?.runtimeDirectory ?? t("game.managed")}</code>
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
