export type PlatformName = "windows" | "macos" | "linux" | "android" | "ios" | "web";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

export function detectPlatform(): PlatformName {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "web";
}

export function isMobilePlatform(): boolean {
  const platform = detectPlatform();
  return platform === "android" || platform === "ios";
}
