import { useEffect } from "react";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { useGameSessionStore } from "../game/GameSessionManager";
import { keyboardEventAccelerator, normalizeAccelerator } from "../shortcuts/shortcutRegistry";
import { useTabStore } from "../tabs/tabStore";
import { dispatchModCommand, listModCommands } from "./modService";
import { useModStore } from "./modStore";
import type { ModCommand } from "./modTypes";

export function ModCommandShortcuts() {
  const enabled = useModStore((state) => state.enabled);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let commands: ModCommand[] = [];
    let refreshFailed = false;
    const refresh = async () => {
      try {
        const next = await listModCommands();
        if (!disposed) commands = next.filter((command) => command.shortcut);
        refreshFailed = false;
      } catch (error) {
        if (!disposed) commands = [];
        if (!refreshFailed) {
          diagnosticLogger.warn("mods", `Raccourcis de mods indisponibles : ${String(error)}`);
          refreshFailed = true;
        }
      }
    };
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 2_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target as HTMLElement | null)?.closest(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        return;
      }
      const accelerator = keyboardEventAccelerator(event);
      const candidates = commands.filter(
        (command) => normalizeAccelerator(command.shortcut ?? "") === accelerator,
      );
      if (!candidates.length) return;
      const activeTab = useTabStore
        .getState()
        .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId);
      const activeSession =
        activeTab?.type === "game"
          ? Object.values(useGameSessionStore.getState().sessions).find(
              (session) => session.accountId === activeTab.accountId,
            )
          : undefined;
      const command =
        candidates.find((candidate) => candidate.sessionId === activeSession?.id) ?? candidates[0];
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      void dispatchModCommand(command).catch((error: unknown) => {
        diagnosticLogger.warn("mods", `Raccourci de mod refusé : ${String(error)}`);
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [enabled]);

  return null;
}
