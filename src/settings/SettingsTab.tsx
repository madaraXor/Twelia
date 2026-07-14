import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  AppWindow,
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
import { toTweliaError } from "../core/errors";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import type { DiagnosticEvent, LogLevel } from "../diagnostics/diagnosticTypes";
import { sanitizeObject } from "../diagnostics/redaction";
import { useGameSessionStore } from "../game/GameSessionManager";
import { needsBackgroundGameActivity } from "../game/gameAttention";
import {
  getClientStatus,
  installGameClient,
  onClientInstallProgress,
  type ClientInstallProgress,
  type ClientStatus,
} from "../game/clientService";
import { detectPlatform, isTauriRuntime } from "../platform/platform";
import { findShortcutConflicts, keyboardEventAccelerator } from "../shortcuts/shortcutRegistry";
import { useShortcutStore } from "../shortcuts/shortcutStore";
import type { ShortcutAction } from "../shortcuts/shortcutTypes";
import type { SettingsSection } from "../tabs/tabTypes";
import { useSettingsStore, type AppSettings } from "./settingsStore";

const sections: Array<[SettingsSection, string, typeof AppWindow]> = [
  ["general", "Général", AppWindow],
  ["accounts", "Comptes", Users],
  ["interface", "Interface", Palette],
  ["shortcuts", "Raccourcis", Keyboard],
  ["client", "Client", Gamepad2],
  ["performance", "Performances", Gauge],
  ["logs", "Journaux", ScrollText],
  ["about", "À propos", Info],
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

export function SettingsTab({ initialSection = "general" }: { initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const visibleSections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    if (!normalized) return sections;
    return sections.filter(
      ([id, label]) =>
        label.toLocaleLowerCase("fr").includes(normalized) ||
        sectionSearchTerms[id].includes(normalized),
    );
  }, [query]);
  const activeSection = visibleSections.some(([id]) => id === section)
    ? section
    : (visibleSections[0]?.[0] ?? section);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeSection]);

  return (
    <Tabs
      value={activeSection}
      onValueChange={(value) => setSection(value as SettingsSection)}
      className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <header className="shrink-0 border-b border-border bg-background px-5 py-6 sm:px-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Configuration
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-none tracking-[-0.01em]">
          Paramètres
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
              placeholder="Rechercher un réglage…"
              className="h-10 bg-card pl-9 text-[13px]"
              aria-label="Rechercher dans les paramètres"
            />
          </div>
          <TabsList className="mt-3 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:grid">
            {visibleSections.map(([id, label, Icon]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-10 shrink-0 justify-start gap-2.5 rounded-[9px] px-3 text-[13px] data-[state=active]:bg-surface-elevated data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none lg:w-full"
              >
                <Icon className="size-4" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {visibleSections.length === 0 && (
            <p className="px-2 py-5 text-sm text-muted-foreground">Aucun réglage trouvé.</p>
          )}
        </aside>
        <div
          ref={contentRef}
          data-testid="settings-scroll-panel"
          className="min-h-0 min-w-0 overflow-y-auto bg-background px-5 py-6 sm:px-8 lg:p-10"
        >
          <div className="w-full max-w-[820px]">
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
          </div>
        </div>
      </div>
    </Tabs>
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
    <header className="mb-4">
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

function GeneralSection() {
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  return (
    <section>
      <SectionHeader
        eyebrow="Application"
        title="Général"
        description="Démarrage, restauration et comportement de fermeture."
      />
      <SettingsCard>
        <SettingRow>
          <SettingCopy label="Langue" description="Langue de l’interface" />
          <SettingSelect
            label="Langue"
            value={settings.language}
            onValueChange={(value) => void update("language", value as AppSettings["language"])}
          >
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SettingSelect>
        </SettingRow>
        <Toggle
          label="Restaurer les onglets"
          description="Rouvrir l’espace de travail du lancement précédent."
          checked={settings.restoreTabs}
          onChange={(value) => void update("restoreTabs", value)}
        />
        <Toggle
          label="Confirmer la fermeture"
          description="Demander avant de fermer une session encore connectée."
          checked={settings.confirmConnectedSessionClose}
          onChange={(value) => void update("confirmConnectedSessionClose", value)}
        />
        <Toggle
          label="Rechercher les mises à jour"
          description="Vérification automatique au démarrage."
          checked={settings.checkUpdatesAutomatically}
          onChange={(value) => void update("checkUpdatesAutomatically", value)}
        />
      </SettingsCard>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Changement automatique d’onglet</CardTitle>
          <p className="text-sm leading-5 text-muted-foreground">
            Affiche immédiatement le compte qui demande votre attention.
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          <Toggle
            label="Début de votre tour"
            description="Basculer sur le personnage qui doit jouer en combat."
            checked={settings.autoSwitchOnCombatTurn}
            onChange={(value) => void update("autoSwitchOnCombatTurn", value)}
          />
          <Toggle
            label="Invitation de groupe"
            description="Basculer sur le compte qui reçoit une invitation de groupe."
            checked={settings.autoSwitchOnPartyInvitation}
            onChange={(value) => void update("autoSwitchOnPartyInvitation", value)}
          />
          <Toggle
            label="Combat du groupe"
            description="Basculer lorsqu’un membre du groupe propose de rejoindre son combat."
            checked={settings.autoSwitchOnGroupFight}
            onChange={(value) => void update("autoSwitchOnGroupFight", value)}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function AccountsSection() {
  const accounts = useAccountStore((state) => state.accounts);
  const defaultId = useAccountStore((state) => state.defaultAccountId);
  return (
    <section>
      <SectionHeader
        eyebrow="Profils"
        title="Comptes"
        description="Les métadonnées restent séparées des secrets de session."
      />
      <SettingsCard>
        {accounts.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Aucun profil enregistré.</div>
        ) : (
          accounts.map((account) => (
            <SettingRow key={account.id}>
              <SettingCopy label={account.displayName} description={account.sessionStatus} />
              <Button
                variant={defaultId === account.id ? "default" : "outline"}
                onClick={() => void useAccountStore.getState().setDefaultAccount(account.id)}
              >
                {defaultId === account.id ? "Par défaut" : "Définir par défaut"}
              </Button>
            </SettingRow>
          ))
        )}
      </SettingsCard>
    </section>
  );
}

function InterfaceSection() {
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  return (
    <section>
      <SectionHeader
        eyebrow="Apparence"
        title="Interface"
        description="Ajustez la densité pour la souris ou le tactile."
      />
      <SettingsCard>
        <SettingRow>
          <SettingCopy label="Thème" description="Clair, sombre ou synchronisé avec le système." />
          <SettingSelect
            label="Thème"
            value={settings.theme}
            onValueChange={(value) => void update("theme", value as AppSettings["theme"])}
          >
            <SelectItem value="dark">Sombre</SelectItem>
            <SelectItem value="light">Clair</SelectItem>
            <SelectItem value="system">Système</SelectItem>
          </SettingSelect>
        </SettingRow>
        <SettingRow>
          <SettingCopy
            label="Taille de l’interface"
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
            aria-label="Taille de l’interface"
          />
        </SettingRow>
        <Toggle
          label="Réduire les animations"
          description="Neutralise les pulsations et les transitions décoratives."
          checked={settings.reduceMotion}
          onChange={(value) => void update("reduceMotion", value)}
        />
        <Toggle
          label="Onglets compacts"
          description="Réduit la largeur de la barre d’onglets."
          checked={settings.compactTabs}
          onChange={(value) => void update("compactTabs", value)}
        />
        <Toggle
          label="Afficher les personnages"
          description="Ajoute le personnage actif au libellé du compte."
          checked={settings.showCharacterNames}
          onChange={(value) => void update("showCharacterNames", value)}
        />
        <Toggle
          label="Indicateurs de notification"
          description="Affiche les alertes dans l’application et sur les onglets."
          checked={settings.showNotifications}
          onChange={(value) => void update("showNotifications", value)}
        />
      </SettingsCard>
    </section>
  );
}

function ShortcutsSection() {
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
        eyebrow="Navigation"
        title="Raccourcis"
        description="Actifs uniquement quand Twelia a le focus."
      />
      {conflicts.size > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Conflits détectés</AlertTitle>
          <AlertDescription>
            {conflicts.size} raccourci(s) en conflit. Les actions concernées sont désactivées.
          </AlertDescription>
        </Alert>
      )}
      <SettingsCard>
        {bindings.map((binding) => {
          const conflict = Boolean(binding.accelerator && conflicts.has(binding.accelerator));
          return (
            <SettingRow key={binding.action} className={conflict ? "bg-destructive/5" : undefined}>
              <SettingCopy
                label={binding.label}
                description={conflict ? "Conflit de raccourci" : binding.action}
              />
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  variant="outline"
                  className="min-w-32 flex-1 font-mono sm:flex-none"
                  onClick={() => setCapturing(binding.action)}
                >
                  {capturing === binding.action ? "Appuyez…" : (binding.accelerator ?? "Désactivé")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Désactiver"
                  onClick={() => void useShortcutStore.getState().setBinding(binding.action, null)}
                >
                  <Minus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Valeur par défaut"
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
  const android = detectPlatform() === "android";
  const [result, setResult] = useState<string>();
  const [status, setStatus] = useState<ClientStatus>();
  const [progress, setProgress] = useState<ClientInstallProgress>();
  const [installing, setInstalling] = useState(false);

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
    if (!isTauriRuntime()) return setResult("Disponible dans l’application Tauri.");
    try {
      setResult(JSON.stringify(await invoke(command), null, 2));
    } catch (error) {
      setResult(toTweliaError(error).message);
    }
  };
  const install = async () => {
    setInstalling(true);
    setResult(undefined);
    setProgress({ phase: "starting", message: "Préparation de l’installation…", percent: 0 });
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
        eyebrow="Fichiers officiels"
        title="Client"
        description="Téléchargement, vérification et lancement du client DOFUS Touch."
      />
      <Alert variant="warning" className="mb-4">
        <AlertTriangle />
        <AlertTitle>
          {android ? "Client Android officiel adapté" : "Client non officiel"}
        </AlertTitle>
        <AlertDescription>
          {android
            ? "Twelia conserve le comportement mobile du client et ajoute uniquement son serveur d’assets et le pont de connexion externe."
            : "Le jeu sur PC via un client non officiel n’est pas pris en charge par Ankama et peut exposer le compte à une sanction. Twelia conserve les fichiers téléchargés intacts et crée une couche de compatibilité séparée."}
        </AlertDescription>
      </Alert>
      {status && (
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <strong>
                {status.installed ? `Version ${status.version}` : "Client non installé"}
              </strong>
              <p className="truncate text-sm text-muted-foreground">{status.path}</p>
            </div>
            <Badge variant={status.integrity === "valid" ? "success" : "destructive"}>
              {status.integrity === "valid" ? <ShieldCheck /> : <AlertTriangle />}
              {status.integrity === "valid" ? "Intègre" : "À installer ou réparer"}
            </Badge>
          </CardContent>
        </Card>
      )}
      {progress && (installing || progress.percent === 100) && (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-4" aria-live="polite">
            <div className="flex justify-between gap-3 text-sm">
              <strong>{progress.message}</strong>
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
            ? "Installation en cours…"
            : status?.installed
              ? "Mettre à jour / réparer"
              : "Télécharger et installer"}
        </Button>
        <Button variant="outline" onClick={() => void run("get_client_status")}>
          <Search /> Détecter
        </Button>
        <Button
          variant="outline"
          disabled={!status?.installed || installing}
          onClick={() => void run("verify_client_integrity")}
        >
          <FileCheck2 /> Vérifier les fichiers
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
  const settings = useSettingsStore();
  const update = useUpdateSetting();
  const attentionNeedsBackground = needsBackgroundGameActivity(settings);
  return (
    <section>
      <SectionHeader
        eyebrow="Ressources"
        title="Performances"
        description="Les valeurs par défaut limitent fortement les sessions masquées."
      />
      <SettingsCard>
        <Toggle
          label="Limiter le rendu en arrière-plan"
          description="Réduit l’activité des onglets masqués."
          checked={settings.limitBackgroundRendering}
          onChange={(value) => void update("limitBackgroundRendering", value)}
        />
        <Toggle
          label="Suspendre les onglets inactifs"
          description={
            attentionNeedsBackground
              ? "Ignoré tant qu’une bascule automatique ou les notifications sont activées."
              : "Recommandé sur Android et les appareils à mémoire limitée."
          }
          checked={settings.suspendInactiveTabs}
          onChange={(value) => void update("suspendInactiveTabs", value)}
        />
        <SettingRow>
          <SettingCopy label="Sessions simultanées" description="Maximum local, de 1 à 12." />
          <Input
            className="w-full sm:w-52"
            type="number"
            min={1}
            max={12}
            value={settings.maxSessions}
            onChange={(event) => void update("maxSessions", Number(event.target.value))}
            aria-label="Sessions simultanées"
          />
        </SettingRow>
        <SettingRow>
          <SettingCopy
            label="Qualité de rendu"
            description="Adaptée automatiquement en arrière-plan."
          />
          <SettingSelect
            label="Qualité de rendu"
            value={settings.renderQuality}
            onValueChange={(value) =>
              void update("renderQuality", value as AppSettings["renderQuality"])
            }
          >
            <SelectItem value="low">Économie</SelectItem>
            <SelectItem value="balanced">Équilibrée</SelectItem>
            <SelectItem value="high">Élevée</SelectItem>
          </SettingSelect>
        </SettingRow>
        <Toggle
          label="Mode diagnostic"
          description="Désactivé par défaut en production. Les secrets restent masqués."
          checked={settings.debugMode}
          onChange={(value) => void update("debugMode", value)}
        />
      </SettingsCard>
    </section>
  );
}

function LogsSection() {
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
        eyebrow="Diagnostic"
        title="Journaux"
        description="Événements nettoyés et corrélés, sans contenu de session."
      />
      {!debug && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Affichage désactivé</AlertTitle>
          <AlertDescription>
            Activez le mode diagnostic dans Performances pour afficher les détails techniques.
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <SettingSelect
          label="Niveau des journaux"
          value={level}
          onValueChange={(value) => setLevel(value as LogLevel | "ALL")}
        >
          <SelectItem value="ALL">Tous les niveaux</SelectItem>
          {["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SettingSelect>
        <Button variant="outline" onClick={exportReport}>
          <Download /> Exporter le rapport
        </Button>
        <Button variant="outline" onClick={() => diagnosticLogger.clear()}>
          <Trash2 /> Vider
        </Button>
      </div>
      <Card aria-live="polite" className="overflow-hidden">
        <CardContent className="max-h-[34rem] overflow-auto p-0">
          {!debug ? (
            <p className="p-5 text-sm text-muted-foreground">Affichage détaillé désactivé.</p>
          ) : visible.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Aucun événement.</p>
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
  return (
    <section>
      <SectionHeader
        eyebrow="Version 1.0.0"
        title="À propos de Twelia"
        description="Client multiplateforme indépendant construit avec Tauri 2."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="mb-3 grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary/10 p-2">
            <img src="/twelia-icon.png" alt="" className="size-full object-contain" />
          </div>
          <CardTitle className="text-2xl">Twelia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 leading-7 text-muted-foreground">
          <p>Twelia est un projet indépendant et non affilié à Ankama.</p>
          <p>
            Twelia cherche à utiliser les fichiers officiels sans les modifier, mais son utilisation
            n’est pas officiellement approuvée et l’absence de sanction ou de bannissement ne peut
            pas être garantie.
          </p>
          <Separator />
          <p>
            Aucun bot, autoclic, macro, diffusion d’action, injection ou modification du trafic
            n’est inclus.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
