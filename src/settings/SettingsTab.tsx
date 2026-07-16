import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  AppWindow,
  ArrowLeft,
  Download,
  FileCheck2,
  Gamepad2,
  Gauge,
  Info,
  Keyboard,
  Minus,
  Palette,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAccountStore } from "../accounts/accountStore";
import { matchesSearch } from "../commands/search";
import { toTweliaError } from "../core/errors";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DiagnosticEvent, LogLevel } from "../diagnostics/diagnosticTypes";
import { sanitizeObject } from "../diagnostics/redaction";
import { useGameSessionStore } from "../game/GameSessionManager";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { needsBackgroundGameActivity } from "../game/gameAttention";
import {
  getClientStatus,
  installGameClient,
  onClientInstallProgress,
  type ClientInstallProgress,
  type ClientStatus,
} from "../game/clientService";
import { detectPlatform, isMobilePlatform, isTauriRuntime } from "../platform/platform";
import { findShortcutConflicts, keyboardEventAccelerator } from "../shortcuts/shortcutRegistry";
import { useShortcutStore } from "../shortcuts/shortcutStore";
import type { ShortcutAction } from "../shortcuts/shortcutTypes";
import type { SettingsSection } from "../tabs/tabTypes";
import { settingsBackTabId, useTabStore } from "../tabs/tabStore";
import { useSettingsStore, type AppSettings } from "./settingsStore";
import { SETTING_SEARCH_ENTRIES } from "./settingsCatalog";

const sections: Array<[SettingsSection, MessageKey, typeof AppWindow]> = [
  ["general", "settings.section.general", AppWindow],
  ["accounts", "settings.section.accounts", Users],
  ["interface", "settings.section.interface", Palette],
  ["shortcuts", "settings.section.shortcuts", Keyboard],
  ["client", "settings.section.client", Gamepad2],
  ["performance", "settings.section.performance", Gauge],
  ["logs", "settings.section.logs", ScrollText],
  ["about", "settings.section.about", Info],
];

const sectionSearchTerms: Record<SettingsSection, string> = {
  general:
    "général langue démarrage restauration fermeture mise à jour changement automatique combat invitation",
  accounts: "comptes profils défaut session données",
  interface:
    "interface apparence thème clair sombre système taille échelle onglets notifications animations",
  shortcuts: "raccourcis clavier commandes touches",
  client: "client installation téléchargement intégrité réparer fichiers",
  performance: "performances mémoire arrière-plan sessions rendu diagnostic",
  logs: "journaux diagnostic événements export rapport",
  about: "à propos version licence ankama sécurité",
};

const CLIENT_PROGRESS_KEYS: Record<string, MessageKey> = {
  starting: "settings.client.phase.starting",
  metadata: "settings.client.phase.metadata",
  download: "settings.client.phase.download",
  versions: "settings.client.phase.versions",
  compatibility: "settings.client.phase.compatibility",
  install: "settings.client.phase.install",
  complete: "settings.client.phase.complete",
};

export function SettingsTab({ initialSection = "general" }: { initialSection?: SettingsSection }) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const mobile = isMobilePlatform();
  const workspaceTabs = useTabStore((state) => state.tabs);
  const visibleSections = useMemo(() => {
    if (!query.trim()) return sections;
    return sections.filter(([id, labelKey]) =>
      matchesSearch(
        query,
        t(labelKey),
        sectionSearchTerms[id],
        ...SETTING_SEARCH_ENTRIES.filter((entry) => entry.section === id).flatMap((entry) => [
          t(entry.labelKey),
          entry.keywords,
        ]),
      ),
    );
  }, [query, t]);
  const activeSection = visibleSections.some(([id]) => id === section)
    ? section
    : (visibleSections[0]?.[0] ?? section);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeSection]);

  const activeSectionEntry = sections.find(([id]) => id === activeSection);
  const backTabId = settingsBackTabId(workspaceTabs);
  const returnsToGame = backTabId !== "home";

  if (mobile) {
    return (
      <Tabs
        value={activeSection}
        onValueChange={(value) => setSection(value as SettingsSection)}
        className="grid h-full min-h-0 w-full overflow-hidden bg-[radial-gradient(circle_at_14%_0%,var(--color-surface-elevated),var(--color-background)_34rem)]"
        style={{ gridTemplateColumns: "min(210px, 31vw) minmax(0, 1fr)" }}
      >
        <aside
          data-testid="settings-navigation"
          className="flex min-h-0 min-w-0 flex-col border-r border-border bg-chrome/55"
        >
          <div className="flex shrink-0 items-center gap-2.5 px-3.5 py-3">
            <img src="/twelia-icon.png" alt="" className="size-6 object-contain" />
            <span className="truncate font-serif text-lg font-semibold">{t("settings.title")}</span>
          </div>
          <div className="shrink-0 px-3 pb-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("settings.search.placeholder")}
                className="h-10 bg-card pl-9 text-[13px]"
                aria-label={t("settings.search.label")}
              />
            </div>
          </div>
          <TabsList className="flex h-auto min-h-0 w-full flex-1 flex-col items-stretch justify-start gap-0.5 overflow-y-auto bg-transparent px-2.5 pb-3">
            {visibleSections.map(([id, labelKey, Icon]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-11 w-full shrink-0 justify-start gap-2.5 rounded-[9px] px-3 text-[13px] data-[state=active]:bg-surface-elevated data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Icon className="size-4" /> <span className="truncate">{t(labelKey)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {visibleSections.length === 0 && (
            <p className="px-4 py-5 text-sm text-muted-foreground">{t("settings.search.empty")}</p>
          )}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <h1 className="truncate font-serif text-2xl font-semibold tracking-[-0.01em]">
              {activeSectionEntry ? t(activeSectionEntry[1]) : t("settings.title")}
            </h1>
            <Button
              variant="outline"
              size="sm"
              className="h-10 shrink-0"
              onClick={() => useTabStore.getState().selectTab(backTabId)}
            >
              <ArrowLeft /> {t(returnsToGame ? "home.backToGame" : "home.backToHome")}
            </Button>
          </header>
          <div
            ref={contentRef}
            data-testid="settings-scroll-panel"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 [&_[data-settings-section-header]]:hidden"
          >
            <div className="w-full max-w-[820px]">
              <SettingsPanels />
            </div>
          </div>
        </div>
      </Tabs>
    );
  }

  return (
    <Tabs
      value={activeSection}
      onValueChange={(value) => setSection(value as SettingsSection)}
      className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <header className="shrink-0 border-b border-border bg-background px-5 py-6 sm:px-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          {t("settings.configuration")}
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-none tracking-[-0.01em]">
          {t("settings.title")}
        </h1>
      </header>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)] lg:grid-rows-1">
        <aside
          data-testid="settings-navigation"
          className="min-w-0 shrink-0 border-b border-border bg-chrome/45 p-4 lg:h-full lg:border-b-0 lg:border-r lg:p-5"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.search.placeholder")}
              className="h-10 bg-card pl-9 text-[13px]"
              aria-label={t("settings.search.label")}
            />
          </div>
          <TabsList className="mt-3 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:grid">
            {visibleSections.map(([id, labelKey, Icon]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-10 shrink-0 justify-start gap-2.5 rounded-[9px] px-3 text-[13px] data-[state=active]:bg-surface-elevated data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none lg:w-full"
              >
                <Icon className="size-4" /> {t(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          {visibleSections.length === 0 && (
            <p className="px-2 py-5 text-sm text-muted-foreground">{t("settings.search.empty")}</p>
          )}
        </aside>
        <div
          ref={contentRef}
          data-testid="settings-scroll-panel"
          className="min-h-0 min-w-0 overflow-y-auto bg-background px-5 py-6 sm:px-8 lg:p-10"
        >
          <div className="w-full max-w-[820px]">
            <SettingsPanels />
          </div>
        </div>
      </div>
    </Tabs>
  );
}

function SettingsPanels() {
  return (
    <>
      <TabsContent value="general" className="m-0">
        <GeneralSection />
      </TabsContent>
      <TabsContent value="accounts" className="m-0">
        <AccountsSection />
      </TabsContent>
      <TabsContent value="interface" className="m-0">
        <InterfaceSection />
      </TabsContent>
      <TabsContent value="shortcuts" className="m-0">
        <ShortcutsSection />
      </TabsContent>
      <TabsContent value="client" className="m-0">
        <ClientSection />
      </TabsContent>
      <TabsContent value="performance" className="m-0">
        <PerformanceSection />
      </TabsContent>
      <TabsContent value="logs" className="m-0">
        <LogsSection />
      </TabsContent>
      <TabsContent value="about" className="m-0">
        <AboutSection />
      </TabsContent>
    </>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-4" data-settings-section-header>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
    </header>
  );
}

function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="divide-y divide-border p-0">{children}</CardContent>
    </Card>
  );
}

function SettingRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[72px] flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SettingCopy({ label, description }: { label: string; description: string }) {
  return (
    <div className="grid gap-1">
      <strong className="text-sm font-semibold">{label}</strong>
      <span className="text-xs leading-5 text-muted-foreground">{description}</span>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <SettingRow className="flex-row items-center">
      <Label htmlFor={id} className="cursor-pointer">
        <SettingCopy label={label} description={description} />
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
    </SettingRow>
  );
}

function SettingSelect({
  value,
  onValueChange,
  children,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full sm:w-52" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function useUpdateSetting() {
  return useSettingsStore((state) => state.update);
}

function shortcutLabel(action: ShortcutAction, t: ReturnType<typeof useI18n>["t"]): string {
  if (action.startsWith("select-tab-")) {
    return t("shortcut.selectTab", { number: action.slice("select-tab-".length) });
  }
  const keys: Record<Exclude<ShortcutAction, `select-tab-${number}`>, MessageKey> = {
    "next-tab": "shortcut.nextTab",
    "previous-tab": "shortcut.previousTab",
    "select-last-tab": "shortcut.selectLastTab",
    "new-game-tab": "shortcut.newGame",
    "close-tab": "shortcut.closeTab",
    "reopen-tab": "shortcut.reopenTab",
    "open-settings": "shortcut.openSettings",
    "open-home": "shortcut.openHome",
    "reload-active-session": "shortcut.reload",
    "toggle-fullscreen": "shortcut.fullscreen",
    "open-command-palette": "shortcut.commandPalette",
  };
  return t(keys[action as keyof typeof keys]);
}

function GeneralSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.general.eyebrow")}
        title={t("settings.section.general")}
        description={t("settings.general.description")}
      />
      <SettingsCard>
        <SettingRow>
          <SettingCopy
            label={t("settings.language.label")}
            description={t("settings.language.description")}
          />
          <SettingSelect
            label={t("settings.language.label")}
            value={settings.language}
            onValueChange={(value) => void update("language", value as AppSettings["language"])}
          >
            <SelectItem value="system">{t("settings.language.system")}</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SettingSelect>
        </SettingRow>
        <Toggle
          label={t("settings.restoreTabs.label")}
          description={t("settings.restoreTabs.description")}
          checked={settings.restoreTabs}
          onChange={(value) => void update("restoreTabs", value)}
        />
        <Toggle
          label={t("settings.confirmClose.label")}
          description={t("settings.confirmClose.description")}
          checked={settings.confirmConnectedSessionClose}
          onChange={(value) => void update("confirmConnectedSessionClose", value)}
        />
        <Toggle
          label={t("settings.updates.label")}
          description={t("settings.updates.description")}
          checked={settings.checkUpdatesAutomatically}
          onChange={(value) => void update("checkUpdatesAutomatically", value)}
        />
      </SettingsCard>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("settings.autoSwitch.title")}</CardTitle>
          <p className="text-sm leading-5 text-muted-foreground">
            {t("settings.autoSwitch.description")}
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          <Toggle
            label={t("settings.combatTurn.label")}
            description={t("settings.combatTurn.description")}
            checked={settings.autoSwitchOnCombatTurn}
            onChange={(value) => void update("autoSwitchOnCombatTurn", value)}
          />
          <Toggle
            label={t("settings.partyInvitation.label")}
            description={t("settings.partyInvitation.description")}
            checked={settings.autoSwitchOnPartyInvitation}
            onChange={(value) => void update("autoSwitchOnPartyInvitation", value)}
          />
          <Toggle
            label={t("settings.groupFight.label")}
            description={t("settings.groupFight.description")}
            checked={settings.autoSwitchOnGroupFight}
            onChange={(value) => void update("autoSwitchOnGroupFight", value)}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function AccountsSection() {
  const { t } = useI18n();
  const accounts = useAccountStore((state) => state.accounts);
  const defaultId = useAccountStore((state) => state.defaultAccountId);
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.accounts.eyebrow")}
        title={t("settings.section.accounts")}
        description={t("settings.accounts.description")}
      />
      <SettingsCard>
        {accounts.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("settings.accounts.empty")}</div>
        ) : (
          accounts.map((account) => (
            <SettingRow key={account.id}>
              <SettingCopy label={account.displayName} description={account.sessionStatus} />
              <Button
                variant={defaultId === account.id ? "default" : "outline"}
                onClick={() => void useAccountStore.getState().setDefaultAccount(account.id)}
              >
                {defaultId === account.id
                  ? t("settings.accounts.default")
                  : t("settings.accounts.setDefault")}
              </Button>
            </SettingRow>
          ))
        )}
      </SettingsCard>
    </section>
  );
}

function InterfaceSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  const mobile = isMobilePlatform();
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.interface.eyebrow")}
        title={t("settings.section.interface")}
        description={t("settings.interface.description")}
      />
      <SettingsCard>
        <SettingRow>
          <SettingCopy
            label={t("settings.theme.label")}
            description={t("settings.theme.description")}
          />
          <SettingSelect
            label={t("settings.theme.label")}
            value={settings.theme}
            onValueChange={(value) => void update("theme", value as AppSettings["theme"])}
          >
            <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
            <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
            <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
          </SettingSelect>
        </SettingRow>
        <SettingRow>
          <SettingCopy
            label={t("settings.scale.label")}
            description={`${Math.round(settings.interfaceScale * 100)} %`}
          />
          <Slider
            className="w-full sm:w-52"
            min={0.8}
            max={1.4}
            step={0.05}
            value={[settings.interfaceScale]}
            onValueChange={(values) =>
              void update("interfaceScale", values[0] ?? settings.interfaceScale)
            }
            aria-label={t("settings.scale.label")}
          />
        </SettingRow>
        <Toggle
          label={t("settings.reduceMotion.label")}
          description={t("settings.reduceMotion.description")}
          checked={settings.reduceMotion}
          onChange={(value) => void update("reduceMotion", value)}
        />
        {mobile && (
          <>
            <Toggle
              label={t("settings.mobileQuickSwitch.label")}
              description={t("settings.mobileQuickSwitch.description")}
              checked={settings.showMobileQuickSwitch}
              onChange={(value) => void update("showMobileQuickSwitch", value)}
            />
            <Toggle
              label={t("settings.mobileSessionPill.label")}
              description={t("settings.mobileSessionPill.description")}
              checked={settings.showMobileSessionPill}
              onChange={(value) => void update("showMobileSessionPill", value)}
            />
          </>
        )}
        <Toggle
          label={t("settings.compactTabs.label")}
          description={t("settings.compactTabs.description")}
          checked={settings.compactTabs}
          onChange={(value) => void update("compactTabs", value)}
        />
        <Toggle
          label={t("settings.characterNames.label")}
          description={t("settings.characterNames.description")}
          checked={settings.showCharacterNames}
          onChange={(value) => void update("showCharacterNames", value)}
        />
        <Toggle
          label={t("settings.notifications.label")}
          description={t("settings.notifications.description")}
          checked={settings.showNotifications}
          onChange={(value) => void update("showNotifications", value)}
        />
      </SettingsCard>
    </section>
  );
}

function ShortcutsSection() {
  const { t } = useI18n();
  const bindings = useShortcutStore((state) => state.bindings);
  const [capturing, setCapturing] = useState<ShortcutAction>();
  const conflicts = findShortcutConflicts(bindings);
  useEffect(() => {
    if (!capturing) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return setCapturing(undefined);
      const accelerator = keyboardEventAccelerator(event);
      if (!accelerator || ["Ctrl", "Meta", "Alt", "Shift"].includes(accelerator)) return;
      void useShortcutStore
        .getState()
        .setBinding(capturing, accelerator)
        .then(() => setCapturing(undefined));
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturing]);
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.shortcuts.eyebrow")}
        title={t("settings.section.shortcuts")}
        description={t("settings.shortcuts.description")}
      />
      {conflicts.size > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>{t("settings.shortcuts.conflicts")}</AlertTitle>
          <AlertDescription>
            {t("settings.shortcuts.conflictsDescription", { count: conflicts.size })}
          </AlertDescription>
        </Alert>
      )}
      <SettingsCard>
        {bindings.map((binding) => {
          const conflict = Boolean(binding.accelerator && conflicts.has(binding.accelerator));
          return (
            <SettingRow key={binding.action} className={conflict ? "bg-destructive/5" : undefined}>
              <SettingCopy
                label={shortcutLabel(binding.action, t)}
                description={conflict ? t("settings.shortcuts.conflict") : binding.action}
              />
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  variant="outline"
                  className="min-w-32 flex-1 font-mono sm:flex-none"
                  onClick={() => setCapturing(binding.action)}
                >
                  {capturing === binding.action
                    ? t("settings.shortcuts.press")
                    : (binding.accelerator ?? t("settings.shortcuts.disabled"))}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("settings.shortcuts.disable")}
                  onClick={() => void useShortcutStore.getState().setBinding(binding.action, null)}
                >
                  <Minus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("settings.shortcuts.default")}
                  onClick={() => void useShortcutStore.getState().resetBinding(binding.action)}
                >
                  <RotateCcw />
                </Button>
              </div>
            </SettingRow>
          );
        })}
      </SettingsCard>
    </section>
  );
}

function ClientSection() {
  const { t } = useI18n();
  const android = detectPlatform() === "android";
  const [result, setResult] = useState<string>();
  const [status, setStatus] = useState<ClientStatus>();
  const [progress, setProgress] = useState<ClientInstallProgress>();
  const [installing, setInstalling] = useState(false);
  const progressMessageKey = progress ? CLIENT_PROGRESS_KEYS[progress.phase] : undefined;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getClientStatus()
      .then(setStatus)
      .catch(() => undefined);
    void onClientInstallProgress(setProgress).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = async (command: string) => {
    if (!isTauriRuntime()) return setResult(t("settings.client.tauriOnly"));
    try {
      setResult(JSON.stringify(await invoke(command), null, 2));
    } catch (error) {
      setResult(toTweliaError(error).message);
    }
  };
  const install = async () => {
    setInstalling(true);
    setResult(undefined);
    setProgress({ phase: "starting", message: t("settings.client.preparing"), percent: 0 });
    try {
      const outcome = await installGameClient();
      setResult(JSON.stringify(outcome, null, 2));
      setStatus(await getClientStatus());
    } catch (error) {
      setResult(toTweliaError(error, "CLIENT_INSTALL_FAILED").message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.client.eyebrow")}
        title={t("settings.section.client")}
        description={t("settings.client.description")}
      />
      <Alert variant="warning" className="mb-4">
        <AlertTriangle />
        <AlertTitle>
          {android ? t("settings.client.androidTitle") : t("settings.client.desktopTitle")}
        </AlertTitle>
        <AlertDescription>
          {android ? t("settings.client.androidWarning") : t("settings.client.desktopWarning")}
        </AlertDescription>
      </Alert>
      {status && (
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <strong>
                {status.installed
                  ? t("settings.client.version", { version: status.version ?? "—" })
                  : t("settings.client.notInstalled")}
              </strong>
              <p className="truncate text-sm text-muted-foreground">{status.path}</p>
            </div>
            <Badge variant={status.integrity === "valid" ? "success" : "destructive"}>
              {status.integrity === "valid" ? <ShieldCheck /> : <AlertTriangle />}
              {status.integrity === "valid"
                ? t("settings.client.valid")
                : t("settings.client.repairNeeded")}
            </Badge>
          </CardContent>
        </Card>
      )}
      {progress && (installing || progress.percent === 100) && (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-4" aria-live="polite">
            <div className="flex justify-between gap-3 text-sm">
              <strong>{progressMessageKey ? t(progressMessageKey) : progress.message}</strong>
              <span className="text-primary">{progress.percent} %</span>
            </div>
            <Progress value={progress.percent} />
          </CardContent>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button disabled={installing} onClick={() => void install()}>
          <Download />
          {installing
            ? t("settings.client.installing")
            : status?.installed
              ? t("settings.client.updateRepair")
              : t("settings.client.downloadInstall")}
        </Button>
        <Button variant="outline" onClick={() => void run("get_client_status")}>
          <Search /> {t("settings.client.detect")}
        </Button>
        <Button
          variant="outline"
          disabled={!status?.installed || installing}
          onClick={() => void run("verify_client_integrity")}
        >
          <FileCheck2 /> {t("settings.client.verify")}
        </Button>
      </div>
      {result && (
        <Card>
          <CardContent className="p-0">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 text-xs text-muted-foreground">
              {result}
            </pre>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function PerformanceSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  const attentionNeedsBackground = needsBackgroundGameActivity(settings);
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.performance.eyebrow")}
        title={t("settings.section.performance")}
        description={t("settings.performance.description")}
      />
      <SettingsCard>
        <Toggle
          label={t("settings.backgroundRendering.label")}
          description={t("settings.backgroundRendering.description")}
          checked={settings.limitBackgroundRendering}
          onChange={(value) => void update("limitBackgroundRendering", value)}
        />
        <Toggle
          label={t("settings.muteInactive.label")}
          description={t("settings.muteInactive.description")}
          checked={settings.muteInactiveTabs}
          onChange={(value) => void update("muteInactiveTabs", value)}
        />
        <Toggle
          label={t("settings.suspendInactive.label")}
          description={
            attentionNeedsBackground
              ? t("settings.suspendInactive.attention")
              : t("settings.suspendInactive.description")
          }
          checked={settings.suspendInactiveTabs}
          onChange={(value) => void update("suspendInactiveTabs", value)}
        />
        <SettingRow>
          <SettingCopy
            label={t("settings.maxSessions.label")}
            description={t("settings.maxSessions.description")}
          />
          <Input
            className="w-full sm:w-52"
            type="number"
            min={1}
            max={12}
            value={settings.maxSessions}
            onChange={(event) => void update("maxSessions", Number(event.target.value))}
            aria-label={t("settings.maxSessions.label")}
          />
        </SettingRow>
        <SettingRow>
          <SettingCopy
            label={t("settings.renderQuality.label")}
            description={t("settings.renderQuality.description")}
          />
          <SettingSelect
            label={t("settings.renderQuality.label")}
            value={settings.renderQuality}
            onValueChange={(value) =>
              void update("renderQuality", value as AppSettings["renderQuality"])
            }
          >
            <SelectItem value="low">{t("settings.renderQuality.low")}</SelectItem>
            <SelectItem value="balanced">{t("settings.renderQuality.balanced")}</SelectItem>
            <SelectItem value="high">{t("settings.renderQuality.high")}</SelectItem>
          </SettingSelect>
        </SettingRow>
        <Toggle
          label={t("settings.debug.label")}
          description={t("settings.debug.description")}
          checked={settings.debugMode}
          onChange={(value) => void update("debugMode", value)}
        />
      </SettingsCard>
    </section>
  );
}

function LogsSection() {
  const { t } = useI18n();
  const debug = useSettingsStore((state) => state.debugMode);
  const [events, setEvents] = useState<DiagnosticEvent[]>(diagnosticLogger.getEvents());
  const [level, setLevel] = useState<LogLevel | "ALL">("ALL");
  useEffect(() => diagnosticLogger.subscribe(setEvents), []);
  const visible = useMemo(
    () => events.filter((event) => level === "ALL" || event.level === level),
    [events, level],
  );
  const exportReport = () => {
    const sessions = Object.values(useGameSessionStore.getState().sessions).map((session) => ({
      id: session.id,
      accountId: session.accountId,
      status: session.status,
      updatedAt: session.updatedAt,
    }));
    const report = sanitizeObject({
      generatedAt: new Date().toISOString(),
      tweliaVersion: "1.0.0",
      platform: detectPlatform(),
      sessions,
      events: events.slice(-100),
      configuration: {
        ...useSettingsStore.getState(),
        hydrate: undefined,
        update: undefined,
        reset: undefined,
      },
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `twelia-diagnostic-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.logs.eyebrow")}
        title={t("settings.section.logs")}
        description={t("settings.logs.description")}
      />
      {!debug && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>{t("settings.logs.disabledTitle")}</AlertTitle>
          <AlertDescription>{t("settings.logs.disabledDescription")}</AlertDescription>
        </Alert>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <SettingSelect
          label={t("settings.logs.level")}
          value={level}
          onValueChange={(value) => setLevel(value as LogLevel | "ALL")}
        >
          <SelectItem value="ALL">{t("settings.logs.all")}</SelectItem>
          {["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SettingSelect>
        <Button variant="outline" onClick={exportReport}>
          <Download /> {t("settings.logs.export")}
        </Button>
        <Button variant="outline" onClick={() => diagnosticLogger.clear()}>
          <Trash2 /> {t("settings.logs.clear")}
        </Button>
      </div>
      <Card aria-live="polite" className="overflow-hidden">
        <CardContent className="max-h-[34rem] overflow-auto p-0">
          {!debug ? (
            <p className="p-5 text-sm text-muted-foreground">
              {t("settings.logs.detailsDisabled")}
            </p>
          ) : visible.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{t("settings.logs.empty")}</p>
          ) : (
            visible
              .slice()
              .reverse()
              .map((event, index) => (
                <div key={event.id}>
                  {index > 0 && <Separator />}
                  <article className="grid gap-2 p-3 font-mono text-xs sm:grid-cols-[5.5rem_3.5rem_8rem_1fr_auto]">
                    <time className="text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </time>
                    <Badge
                      variant={
                        event.level === "ERROR"
                          ? "destructive"
                          : event.level === "WARN"
                            ? "warning"
                            : "outline"
                      }
                    >
                      {event.level}
                    </Badge>
                    <code className="text-muted-foreground">{event.module}</code>
                    <span className="break-words">{event.message}</span>
                    <small className="text-muted-foreground">
                      {event.context.gameSessionId?.slice(0, 8)}
                    </small>
                  </article>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function AboutSection() {
  const { t } = useI18n();
  return (
    <section>
      <SectionHeader
        eyebrow={t("settings.about.eyebrow")}
        title={t("settings.about.title")}
        description={t("settings.about.description")}
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="mb-3 grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary/10 p-2">
            <img src="/twelia-icon.png" alt="" className="size-full object-contain" />
          </div>
          <CardTitle className="text-2xl">Twelia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 leading-7 text-muted-foreground">
          <p>{t("settings.about.independent")}</p>
          <p>{t("settings.about.risk")}</p>
          <Separator />
          <p>{t("settings.about.noAutomation")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
