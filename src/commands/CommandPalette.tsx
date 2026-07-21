import { useEffect, useMemo, useState } from "react";
import {
  FileSearch,
  Gamepad2,
  Home,
  Puzzle,
  RotateCw,
  Settings,
  TerminalSquare,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAccountStore } from "../accounts/accountStore";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { useGameSessionStore } from "../game/GameSessionManager";
import { useI18n } from "../i18n/i18n";
import { dispatchModCommand, listModCommands } from "../mods/modService";
import type { ModCommand } from "../mods/modTypes";
import { SETTING_SEARCH_ENTRIES } from "../settings/settingsCatalog";
import { useTabStore } from "../tabs/tabStore";
import { useCommandUiStore } from "./commandStore";
import { commandFilter } from "./search";

type CommandEntry = {
  id: string;
  label: string;
  group: string;
  icon: typeof Home;
  keywords?: string[];
  run: () => void;
};

export function CommandPalette() {
  const { t } = useI18n();
  const open = useCommandUiStore((state) => state.paletteOpen);
  const close = useCommandUiStore((state) => state.closePalette);
  const accounts = useAccountStore((state) => state.accounts);
  const tabs = useTabStore((state) => state.tabs);
  const [modCommands, setModCommands] = useState<ModCommand[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listModCommands()
      .then((commands) => {
        if (active) setModCommands(commands);
      })
      .catch((error: unknown) => {
        if (active) setModCommands([]);
        diagnosticLogger.warn("mods", `Commandes indisponibles : ${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const commands = useMemo<CommandEntry[]>(
    () => [
      ...accounts.map((account) => ({
        id: `account-${account.id}`,
        label: t("command.openAccount", { name: account.displayName }),
        group: t("command.group.accounts"),
        icon: Gamepad2,
        run: () => useTabStore.getState().openGame(account.id),
      })),
      ...tabs.map((tab) => ({
        id: `tab-${tab.id}`,
        label: t("command.showTab", {
          name:
            tab.type === "home"
              ? "Twelia"
              : tab.type === "settings"
                ? t("common.settings")
                : tab.type === "mods"
                  ? t("mods.page.title")
                  : (accounts.find((account) => account.id === tab.accountId)?.displayName ??
                    t("common.session")),
        }),
        group: t("command.group.tabs"),
        icon:
          tab.type === "game"
            ? Gamepad2
            : tab.type === "settings"
              ? Settings
              : tab.type === "mods"
                ? Puzzle
                : Home,
        run: () => useTabStore.getState().selectTab(tab.id),
      })),
      {
        id: "settings",
        label: t("command.openSettings"),
        group: t("command.group.navigation"),
        icon: Settings,
        run: () => useTabStore.getState().openSettings(),
      },
      {
        id: "home",
        label: t("command.openHome"),
        group: t("command.group.navigation"),
        icon: Home,
        run: () => useTabStore.getState().selectTab("home"),
      },
      {
        id: "reload",
        label: t("command.reload"),
        group: t("command.group.session"),
        icon: RotateCw,
        run: () => {
          const active = useTabStore
            .getState()
            .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId);
          if (active?.type !== "game") return;
          const session = Object.values(useGameSessionStore.getState().sessions).find(
            (item) => item.accountId === active.accountId,
          );
          if (session) void useGameSessionStore.getState().reload(session.id);
        },
      },
      {
        id: "verify",
        label: t("command.verify"),
        group: t("command.group.client"),
        icon: FileSearch,
        run: () => useTabStore.getState().openSettings("client"),
      },
      {
        id: "logs",
        label: t("command.logs"),
        group: t("command.group.diagnostic"),
        icon: TerminalSquare,
        run: () => useTabStore.getState().openSettings("logs"),
      },
      ...SETTING_SEARCH_ENTRIES.map((setting) => {
        const label = t(setting.labelKey);
        return {
          id: `setting-${setting.id}`,
          label: t("command.openSetting", { name: label }),
          group: t("command.group.settings"),
          icon: Settings,
          keywords: [label, setting.keywords],
          run: () => useTabStore.getState().openSettings(setting.section),
        };
      }),
      ...modCommands.map((command) => ({
        id: `mod-${command.modId}-${command.sessionId}-${command.id}`,
        label: command.title,
        group: t("command.group.mods"),
        icon: Puzzle,
        keywords: [command.modId, command.sessionId, command.description ?? ""],
        run: () => {
          void dispatchModCommand(command).catch((error: unknown) => {
            diagnosticLogger.warn("mods", `Commande refusée : ${String(error)}`);
          });
        },
      })),
    ],
    [accounts, modCommands, t, tabs],
  );

  const groups = [...new Set(commands.map((command) => command.group))];
  const run = (command: CommandEntry) => {
    command.run();
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent className="top-[13vh] max-w-[560px] translate-y-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">{t("command.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("command.description")}</DialogDescription>
        <Command filter={commandFilter}>
          <CommandInput autoFocus placeholder={t("command.placeholder")} />
          <CommandList>
            <CommandEmpty>{t("command.empty")}</CommandEmpty>
            {groups.map((group, index) => (
              <div key={group}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group}>
                  {commands
                    .filter((command) => command.group === group)
                    .map((command) => {
                      const Icon = command.icon;
                      return (
                        <CommandItem
                          key={command.id}
                          value={`${command.id} ${command.label} ${command.group}`}
                          keywords={command.keywords}
                          onSelect={() => run(command)}
                        >
                          <Icon className="text-muted-foreground" />
                          <span>{command.label}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {command.group}
                          </span>
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
          <footer className="flex gap-4 border-t border-border px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
            <span>{t("command.footer.navigate")}</span>
            <span>{t("command.footer.run")}</span>
            <span>{t("command.footer.close")}</span>
          </footer>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
