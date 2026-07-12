import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect } from "react";
import { detectPlatform, isTauriRuntime } from "../platform/platform";

export const MOBILE_OAUTH_CALLBACK_EVENT = "twelia:mobile-oauth-callback";
const MOBILE_OAUTH_TARGET_KEY = "twelia:pending-mobile-oauth-profile";

export type MobileOAuthPayload = { code: string } | { error: string };
export type MobileOAuthCallback = {
  accountId: string;
  payload: MobileOAuthPayload;
};

export function rememberMobileOAuthTarget(accountId: string): void {
  window.localStorage.setItem(MOBILE_OAUTH_TARGET_KEY, accountId);
}

export function clearMobileOAuthTarget(accountId: string): void {
  if (window.localStorage.getItem(MOBILE_OAUTH_TARGET_KEY) === accountId) {
    window.localStorage.removeItem(MOBILE_OAUTH_TARGET_KEY);
  }
}

export function consumeMobileOAuthTarget(): string | undefined {
  const accountId = window.localStorage.getItem(MOBILE_OAUTH_TARGET_KEY) ?? undefined;
  window.localStorage.removeItem(MOBILE_OAUTH_TARGET_KEY);
  return accountId;
}

export function oauthPayloadFromUrl(value: string): MobileOAuthPayload | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "dofustouch:" || url.hostname !== "authorized") return;
    const code = url.searchParams.get("code");
    if (code) return { code };
    const error = url.searchParams.get("error");
    if (error) return { error };
  } catch {
    return;
  }
}

function dispatchUrls(urls: string[] | null): void {
  for (const value of urls ?? []) {
    const payload = oauthPayloadFromUrl(value);
    if (!payload) continue;
    const accountId = consumeMobileOAuthTarget();
    if (!accountId) continue;
    window.dispatchEvent(
      new CustomEvent<MobileOAuthCallback>(MOBILE_OAUTH_CALLBACK_EVENT, {
        detail: { accountId, payload },
      }),
    );
  }
}

export function useMobileGameDeepLinks(): void {
  useEffect(() => {
    if (!isTauriRuntime() || detectPlatform() !== "android") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrent()
      .then(dispatchUrls)
      .catch(() => undefined);
    void onOpenUrl(dispatchUrls).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
