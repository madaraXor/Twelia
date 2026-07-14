import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, type PropsWithChildren } from "react";
import { useAccountStore } from "../accounts/accountStore";
import { useCommandUiStore } from "../commands/commandStore";
import { useGameSessionStore } from "../game/GameSessionManager";
import { configureGameSessionShortcuts } from "../game/GameRuntime";
import { isTauriRuntime } from "../platform/platform";
import { useTabStore } from "../tabs/tabStore";
import {
  findShortcutConflicts,
  keyboardEventAccelerator,
  normalizeAccelerator,
} from "./shortcutRegistry";
import { findBindingForAccelerator, useShortcutStore } from "./shortcutStore";
import type { ShortcutAction } from "./shortcutTypes";

const isEditable = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
};

export function ShortcutProvider({ children }: PropsWithChildren) {
  const bindings = useShortcutStore((state) => state.bindings);
  const sessions = useGameSessionStore((state) => state.sessions);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accelerator = keyboardEventAccelerator(event);
      if (isEditable(event.target)) {
        const normalized = normalizeAccelerator(accelerator);
        const binding = findBindingForAccelerator(bindings, normalized);
        if (
          binding?.action !== "open-command-palette" ||
          findShortcutConflicts(bindings).has(normalized)
        )
          return;
      }
      if (!executeAccelerator(bindings, accelerator)) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>("game-shortcut", (event) => {
      executeAccelerator(bindings, event.payload);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bindings]);

  useEffect(() => {
    const accelerators = bindings.flatMap((binding) =>
      binding.accelerator ? [normalizeAccelerator(binding.accelerator)] : [],
    );
    for (const session of Object.values(sessions)) {
      if (["created", "error", "stopped"].includes(session.status)) continue;
      void configureGameSessionShortcuts(session.id, accelerators).catch(() => undefined);
    }
  }, [bindings, sessions]);

  return children;
}

function executeAccelerator(
  bindings: ReturnType<typeof useShortcutStore.getState>["bindings"],
  accelerator: string,
): boolean {
  const normalized = normalizeAccelerator(accelerator);
  if (findShortcutConflicts(bindings).has(normalized)) return false;
  const binding = findBindingForAccelerator(bindings, normalized);
  if (!binding) return false;
  executeAction(binding.action);
  return true;
}

function executeAction(action: ShortcutAction): void {
  const tabs = useTabStore.getState();
  const activeIndex = tabs.tabs.findIndex((tab) => tab.id === tabs.activeTabId);
  const selectAt = (index: number) => tabs.selectTab(tabs.tabs[index]?.id ?? "home");
  if (action === "next-tab") return selectAt((activeIndex + 1) % tabs.tabs.length);
  if (action === "previous-tab")
    return selectAt((activeIndex - 1 + tabs.tabs.length) % tabs.tabs.length);
  if (action.startsWith("select-tab-")) return selectAt(Number(action.slice(-1)) - 1);
  if (action === "select-last-tab") return selectAt(tabs.tabs.length - 1);
  if (action === "new-game-tab") {
    const account = useAccountStore.getState().accounts[0];
    return account ? tabs.openGame(account.id) : tabs.selectTab("home");
  }
  if (action === "close-tab") return tabs.closeTab(tabs.activeTabId);
  if (action === "reopen-tab") return tabs.reopenLast();
  if (action === "open-settings") return tabs.openSettings();
  if (action === "open-home") return tabs.selectTab("home");
  if (action === "open-command-palette") return useCommandUiStore.getState().openPalette();
  if (action === "reload-active-session") {
    const active = tabs.tabs.find((tab) => tab.id === tabs.activeTabId);
    if (active?.type !== "game") return;
    const session = Object.values(useGameSessionStore.getState().sessions).find(
      (item) => item.accountId === active.accountId,
    );
    if (session) void useGameSessionStore.getState().reload(session.id);
    return;
  }
  if (action === "toggle-fullscreen") {
    if (isTauriRuntime()) {
      const window = getCurrentWindow();
      void window.isFullscreen().then((value) => window.setFullscreen(!value));
    } else if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
}
