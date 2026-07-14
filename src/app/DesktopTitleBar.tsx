import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, Moon, Search, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommandUiStore } from "../commands/commandStore";
import { isTauriRuntime } from "../platform/platform";
import { useI18n } from "../i18n/i18n";
import { useSettingsStore } from "../settings/settingsStore";

type WindowAction = "minimize" | "toggleMaximize" | "close";

async function runWindowAction(action: WindowAction) {
  if (!isTauriRuntime()) return;
  await getCurrentWindow()[action]();
}

export function DesktopTitleBar() {
  const { t } = useI18n();
  const theme = useSettingsStore((state) => state.theme);
  const updateSetting = useSettingsStore((state) => state.update);
  const resolvedTheme =
    typeof document === "undefined" ? "dark" : (document.documentElement.dataset.theme ?? "dark");
  const light = theme === "light" || (theme === "system" && resolvedTheme === "light");

  const toggleTheme = () => {
    void updateSetting(
      "theme",
      theme === "light" || (theme === "system" && light) ? "dark" : "light",
    );
  };

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-10 shrink-0 select-none items-center border-b border-border bg-chrome pl-3"
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("[data-tauri-drag-region]")) return;
        void runWindowAction("toggleMaximize");
      }}
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
      >
        <img src="/twelia-icon.png" alt="" className="size-4 object-contain" />
        <span data-tauri-drag-region>Twelia</span>
      </div>
      <div data-tauri-drag-region className="min-w-4 flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="mr-2 h-7 gap-1.5 rounded-[7px] border-border bg-card px-2.5 font-mono text-[10px] font-medium text-muted-foreground shadow-none hover:text-foreground"
        onClick={() => useCommandUiStore.getState().openPalette()}
        aria-label={t("titlebar.openCommands")}
      >
        <Search className="size-3.5" />
        <kbd className="rounded border border-border-strong px-1.5 py-0.5 leading-none">Ctrl K</kbd>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="mr-1.5 size-7 rounded-[7px] border-border bg-card text-muted-foreground shadow-none hover:text-foreground"
        onClick={toggleTheme}
        aria-label={light ? t("titlebar.useDark") : t("titlebar.useLight")}
      >
        {light ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </Button>
      <div className="flex h-10 items-stretch">
        <button
          type="button"
          className="grid w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => void runWindowAction("minimize")}
          aria-label={t("titlebar.minimize")}
        >
          <Minus className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="grid w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => void runWindowAction("toggleMaximize")}
          aria-label={t("titlebar.maximize")}
        >
          <Maximize2 className="size-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="grid w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-[#c4483e] hover:text-white"
          onClick={() => void runWindowAction("close")}
          aria-label={t("common.close")}
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
