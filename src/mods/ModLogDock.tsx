import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  LayoutPanelTop,
  LoaderCircle,
  PanelsTopLeft,
  Play,
  ScrollText,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n/i18n";
import {
  clearModLogs,
  dispatchModUiAction,
  listInstalledMods,
  listModInstances,
  listModLogs,
  listModUiPanels,
  loadModInstance,
  unloadModInstance,
} from "./modService";
import type {
  InstalledMod,
  ModInstance,
  ModInstanceState,
  ModLogEntry,
  ModUiPanel,
} from "./modTypes";
import { ModUiPanelView } from "./ModUiPanelView";

type DockView = "interfaces" | "mods" | "logs";

const levelClassName: Record<ModLogEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const panelKey = (panel: ModUiPanel) => `${panel.modId}:${panel.id}`;

export function ModLogDock({ sessionId }: { sessionId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeView, setActiveView] = useState<DockView>("interfaces");
  const [entries, setEntries] = useState<ModLogEntry[]>([]);
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [instances, setInstances] = useState<ModInstance[]>([]);
  const [panels, setPanels] = useState<ModUiPanel[]>([]);
  const [selectedPanelKey, setSelectedPanelKey] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setEntries([]);
      setMods([]);
      setInstances([]);
      setPanels([]);
      return;
    }
    try {
      const [nextEntries, installed, running, nextPanels] = await Promise.all([
        listModLogs(sessionId),
        listInstalledMods(),
        listModInstances(),
        listModUiPanels(sessionId),
      ]);
      setEntries(nextEntries);
      setMods(installed);
      setInstances(running.filter((instance) => instance.sessionId === sessionId));
      setPanels((current) =>
        nextPanels.map(
          (panel) =>
            current.find(
              (candidate) =>
                panelKey(candidate) === panelKey(panel) && candidate.revision === panel.revision,
            ) ?? panel,
        ),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 750);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [open, refresh]);

  useEffect(() => {
    const available = new Set(panels.map(panelKey));
    setSelectedPanelKey((current) =>
      current && available.has(current) ? current : panels[0] ? panelKey(panels[0]) : undefined,
    );
  }, [panels]);

  useEffect(() => {
    if (open && activeView === "logs") endRef.current?.scrollIntoView({ block: "end" });
  }, [activeView, entries, open]);

  const selectedPanel = useMemo(
    () => panels.find((panel) => panelKey(panel) === selectedPanelKey),
    [panels, selectedPanelKey],
  );

  const clear = async () => {
    if (!sessionId) return;
    try {
      await clearModLogs(sessionId);
      setEntries([]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  const toggleRuntime = async (modId: string, loaded: boolean) => {
    if (!sessionId) return;
    setPendingId(modId);
    setFailed(false);
    try {
      if (loaded) {
        await unloadModInstance(sessionId, modId);
      } else {
        await loadModInstance(sessionId, modId);
      }
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setPendingId(undefined);
    }
  };

  const sendUiAction = async (panel: ModUiPanel, actionId: string, value?: unknown) => {
    if (!sessionId) return;
    setFailed(false);
    try {
      await dispatchModUiAction(sessionId, panel.modId, panel.id, actionId, value);
    } catch {
      setFailed(true);
    }
  };

  const stateLabel = (state: ModInstanceState | undefined) => {
    switch (state) {
      case "starting":
        return t("mods.logs.state.starting");
      case "running":
        return t("mods.logs.state.running");
      case "failed":
        return t("mods.logs.state.failed");
      default:
        return t("mods.logs.state.stopped");
    }
  };

  const modName = (modId: string) =>
    mods.find((mod) => mod.manifest.id === modId)?.manifest.name ?? modId;

  if (!open) {
    return (
      <aside className="z-30 flex w-11 shrink-0 flex-col items-center border-l border-border bg-chrome/95 py-2 shadow-[-8px_0_24px_-20px_var(--shadow)]">
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9"
          onClick={() => setOpen(true)}
          aria-label={t("mods.dock.open")}
          title={t("mods.dock.open")}
        >
          <PanelsTopLeft className="size-4" />
          {panels.length > 0 && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </aside>
    );
  }

  return (
    <aside className="z-30 flex w-[clamp(290px,34vw,420px)] max-w-[58vw] shrink-0 flex-col border-l border-border bg-[#101218] text-slate-100 shadow-[-14px_0_30px_-24px_black]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        <PanelsTopLeft className="ml-1 size-4 text-primary" />
        <strong className="min-w-0 flex-1 truncate text-xs font-semibold">
          {t("mods.dock.title")}
        </strong>
        {activeView === "logs" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-slate-400 hover:bg-white/10 hover:text-white"
            disabled={!sessionId || entries.length === 0}
            onClick={() => void clear()}
            aria-label={t("mods.logs.clear")}
            title={t("mods.logs.clear")}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => setOpen(false)}
          aria-label={t("mods.dock.close")}
          title={t("mods.dock.close")}
        >
          <X className="size-4" />
        </Button>
      </header>

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as DockView)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid h-9 shrink-0 grid-cols-3 bg-white/5 p-0.5">
          <TabsTrigger
            value="interfaces"
            className="gap-1.5 px-1 text-[10px] data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            <LayoutPanelTop className="size-3" /> {t("mods.dock.interfaces")}
          </TabsTrigger>
          <TabsTrigger
            value="mods"
            className="gap-1.5 px-1 text-[10px] data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            <Blocks className="size-3" /> {t("mods.dock.mods")}
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="gap-1.5 px-1 text-[10px] data-[state=active]:bg-white/10 data-[state=active]:text-white"
          >
            <ScrollText className="size-3" /> {t("mods.dock.logs")}
          </TabsTrigger>
        </TabsList>

        {failed && (
          <p className="mx-3 mt-2 rounded-md bg-red-400/10 px-2 py-1.5 text-center text-[10px] text-red-300">
            {t("mods.dock.error")}
          </p>
        )}

        <TabsContent value="interfaces" className="mt-0 min-h-0 flex-1 overflow-hidden">
          {panels.length === 0 ? (
            <div className="grid h-full min-h-40 place-items-center px-5 text-center text-slate-500">
              <div>
                <LayoutPanelTop className="mx-auto mb-2 size-6" />
                <p className="text-xs">{t("mods.dock.interfacesEmpty")}</p>
                <p className="mt-1 text-[10px] leading-4">{t("mods.dock.interfacesEmptyHint")}</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/8 px-3 py-2">
                {panels.map((panel) => {
                  const key = panelKey(panel);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "max-w-40 shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors",
                        key === selectedPanelKey
                          ? "bg-primary/15 text-primary"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white",
                      )}
                      onClick={() => setSelectedPanelKey(key)}
                    >
                      <span className="block truncate">{panel.title}</span>
                    </button>
                  );
                })}
              </div>
              {selectedPanel && (
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <div className="mb-3">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {selectedPanel.title}
                    </h3>
                    <p className="truncate text-[10px] text-violet-300">
                      {modName(selectedPanel.modId)}
                    </p>
                  </div>
                  <ModUiPanelView
                    panel={selectedPanel}
                    onAction={(actionId, value) => sendUiAction(selectedPanel, actionId, value)}
                  />
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mods" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t("mods.logs.runtimes")}
            </strong>
            <span className="text-[10px] text-slate-600">{t("mods.logs.sessionScope")}</span>
          </div>
          <div className="space-y-1.5">
            {mods.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-500">
                {t("settings.mods.empty")}
              </p>
            ) : (
              mods.map((mod) => {
                const instance = instances.find((candidate) => candidate.modId === mod.manifest.id);
                const loaded = instance?.state === "starting" || instance?.state === "running";
                const pending = pendingId === mod.manifest.id;
                return (
                  <div
                    key={mod.manifest.id}
                    className="flex items-center gap-2 rounded-md border border-white/8 bg-white/[0.025] px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <strong className="truncate text-[11px] font-medium text-slate-200">
                          {mod.manifest.name}
                        </strong>
                        {!mod.enabled && (
                          <span className="shrink-0 rounded bg-amber-400/10 px-1 text-[9px] text-amber-300">
                            {t("mods.logs.configDisabled")}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-[10px]",
                          loaded
                            ? "text-emerald-400"
                            : instance?.state === "failed"
                              ? "text-red-400"
                              : "text-slate-500",
                        )}
                      >
                        {stateLabel(instance?.state)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white"
                      disabled={!sessionId || pending}
                      onClick={() => void toggleRuntime(mod.manifest.id, loaded)}
                    >
                      {pending ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : loaded ? (
                        <Square className="size-3" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      {t(loaded ? "mods.logs.unload" : "mods.logs.load")}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="logs"
          className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5"
        >
          {entries.length === 0 ? (
            <div className="grid h-full min-h-32 place-items-center text-center text-slate-500">
              <div>
                <ScrollText className="mx-auto mb-2 size-5" />
                <p>{t("mods.logs.empty")}</p>
              </div>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.sequence}
                className="grid grid-cols-[auto_auto_1fr] gap-x-2 border-b border-white/5 py-1"
              >
                <time className="text-slate-600">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
                <span className={cn("uppercase", levelClassName[entry.level])}>{entry.level}</span>
                <div className="min-w-0">
                  <span className="mr-1 text-violet-400">[{entry.modId}]</span>
                  <span className="break-words text-slate-300">{entry.message}</span>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
