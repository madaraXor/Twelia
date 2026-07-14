import { useMemo } from "react";
import { FileSearch, Gamepad2, Home, RotateCw, Settings, TerminalSquare } from "lucide-react";
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
import { useGameSessionStore } from "../game/GameSessionManager";
import { useTabStore } from "../tabs/tabStore";
import { useCommandUiStore } from "./commandStore";

type CommandEntry = {
  id: string;
  label: string;
  group: string;
  icon: typeof Home;
  run: () => void;
};

export function CommandPalette() {
  const open = useCommandUiStore((state) => state.paletteOpen);
  const close = useCommandUiStore((state) => state.closePalette);
  const accounts = useAccountStore((state) => state.accounts);
  const tabs = useTabStore((state) => state.tabs);

  const commands = useMemo<CommandEntry[]>(
    () => [
      ...accounts.map((account) => ({
        id: `account-${account.id}`,
        label: `Ouvrir ${account.displayName}`,
        group: "Comptes",
        icon: Gamepad2,
        run: () => useTabStore.getState().openGame(account.id),
      })),
      ...tabs.map((tab) => ({
        id: `tab-${tab.id}`,
        label: `Afficher ${tab.type === "home" ? "Twelia" : tab.type === "settings" ? "Paramètres" : (accounts.find((account) => account.id === tab.accountId)?.displayName ?? "session")}`,
        group: "Onglets",
        icon: tab.type === "game" ? Gamepad2 : tab.type === "settings" ? Settings : Home,
        run: () => useTabStore.getState().selectTab(tab.id),
      })),
      {
        id: "settings",
        label: "Ouvrir les paramètres",
        group: "Navigation",
        icon: Settings,
        run: () => useTabStore.getState().openSettings(),
      },
      {
        id: "home",
        label: "Revenir à Twelia",
        group: "Navigation",
        icon: Home,
        run: () => useTabStore.getState().selectTab("home"),
      },
      {
        id: "reload",
        label: "Recharger la session active",
        group: "Session",
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
        label: "Vérifier les fichiers du client",
        group: "Client",
        icon: FileSearch,
        run: () => useTabStore.getState().openSettings("client"),
      },
      {
        id: "logs",
        label: "Ouvrir le diagnostic",
        group: "Diagnostic",
        icon: TerminalSquare,
        run: () => useTabStore.getState().openSettings("logs"),
      },
    ],
    [accounts, tabs],
  );

  const groups = [...new Set(commands.map((command) => command.group))];
  const run = (command: CommandEntry) => {
    command.run();
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent className="top-[13vh] max-w-[560px] translate-y-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Palette de commandes</DialogTitle>
        <DialogDescription className="sr-only">
          Rechercher une commande, un compte ou un onglet.
        </DialogDescription>
        <Command>
          <CommandInput autoFocus placeholder="Rechercher une commande ou un compte…" />
          <CommandList>
            <CommandEmpty>Aucune commande trouvée.</CommandEmpty>
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
                          value={`${command.label} ${command.group}`}
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
            <span>↑↓ naviguer</span>
            <span>Entrée exécuter</span>
            <span>Échap fermer</span>
          </footer>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
