import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import {
  Code2,
  FileCode2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toTweliaError } from "../core/errors";
import { useI18n } from "../i18n/i18n";
import { isMobilePlatform } from "../platform/platform";
import {
  createModProject,
  listInstalledMods,
  openModEntry,
  openModGameEntry,
  reloadModInstances,
  setModEnabled,
} from "./modService";
import { ModSettingsForm } from "./ModSettingsForm";
import type { InstalledMod } from "./modTypes";

export function ModsManager() {
  const { t } = useI18n();
  const nameId = useId();
  const mobile = isMobilePlatform();
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState<string>();
  const [savingId, setSavingId] = useState<string>();
  const [reloadingId, setReloadingId] = useState<string>();
  const [expandedId, setExpandedId] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setMods(await listInstalledMods());
    } catch (cause) {
      setError(toTweliaError(cause).message || t("settings.mods.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setCreating(true);
    setError(undefined);
    try {
      const created = await createModProject(trimmedName);
      setMods((current) =>
        [...current.filter((item) => item.manifest.id !== created.manifest.id), created].sort(
          (left, right) => left.manifest.name.localeCompare(right.manifest.name),
        ),
      );
      setName("");
      setDialogOpen(false);
    } catch (cause) {
      setError(toTweliaError(cause).message || t("settings.mods.createError"));
    } finally {
      setCreating(false);
    }
  };

  const openEntry = async (modId: string, target: "main" | "game") => {
    const openingKey = `${modId}:${target}`;
    setOpeningId(openingKey);
    setError(undefined);
    try {
      if (target === "game") await openModGameEntry(modId);
      else await openModEntry(modId);
    } catch (cause) {
      setError(toTweliaError(cause).message || t("settings.mods.openError"));
    } finally {
      setOpeningId(undefined);
    }
  };

  const updateActivation = async (modId: string, enabled: boolean) => {
    setSavingId(modId);
    setError(undefined);
    try {
      await setModEnabled(modId, enabled);
      setMods((current) =>
        current.map((mod) => (mod.manifest.id === modId ? { ...mod, enabled } : mod)),
      );
    } catch (cause) {
      setError(toTweliaError(cause).message || t("settings.mods.saveError"));
    } finally {
      setSavingId(undefined);
    }
  };

  const reload = async (modId: string) => {
    setReloadingId(modId);
    setError(undefined);
    try {
      await reloadModInstances(modId);
    } catch (cause) {
      setError(toTweliaError(cause).message || t("settings.mods.reloadError"));
    } finally {
      setReloadingId(undefined);
    }
  };

  return (
    <section>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code2 className="size-4 text-primary" /> {t("settings.mods.workshop.title")}
            </CardTitle>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {t("settings.mods.workshop.description")}
            </p>
          </div>
          {!mobile && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="shrink-0">
                  <Plus /> {t("settings.mods.new")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={(event) => void createProject(event)} className="grid gap-5">
                  <DialogHeader>
                    <DialogTitle>{t("settings.mods.newTitle")}</DialogTitle>
                    <DialogDescription>{t("settings.mods.newDescription")}</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2">
                    <Label htmlFor={nameId}>{t("settings.mods.name")}</Label>
                    <Input
                      id={nameId}
                      value={name}
                      maxLength={80}
                      autoFocus
                      placeholder={t("settings.mods.namePlaceholder")}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" disabled={creating || !name.trim()}>
                      {creating && <LoaderCircle className="animate-spin" />}
                      {t(creating ? "settings.mods.creating" : "settings.mods.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="border-t border-border p-0">
          {mobile && (
            <p className="border-b border-border px-5 py-4 text-sm text-muted-foreground">
              {t("settings.mods.desktopOnly")}
            </p>
          )}
          {loading ? (
            <div className="grid min-h-28 place-items-center text-muted-foreground">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : mods.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              {t("settings.mods.empty")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {mods.map((mod) => {
                const { manifest } = mod;
                const isOpening = openingId?.startsWith(`${manifest.id}:`) ?? false;
                return (
                  <div key={manifest.id}>
                    <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm font-semibold">
                            {manifest.name}
                          </strong>
                          <Badge variant="secondary">v{manifest.version}</Badge>
                        </div>
                        <code className="mt-1 block truncate text-[11px] text-muted-foreground">
                          {manifest.id}
                        </code>
                        {manifest.capabilities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {manifest.capabilities.map((capability) => (
                              <Badge
                                key={capability}
                                variant="outline"
                                className="font-mono text-[9px]"
                              >
                                {capability}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Label
                          htmlFor={`mod-enabled-${manifest.id}`}
                          className="cursor-pointer text-xs text-muted-foreground"
                        >
                          {t(
                            mod.enabled ? "settings.mods.modEnabled" : "settings.mods.modDisabled",
                          )}
                        </Label>
                        <Switch
                          id={`mod-enabled-${manifest.id}`}
                          checked={mod.enabled}
                          disabled={savingId === manifest.id}
                          onCheckedChange={(enabled) => void updateActivation(manifest.id, enabled)}
                          aria-label={t("settings.mods.toggle", { name: manifest.name })}
                        />
                        {!mobile && (
                          <div className="flex items-center gap-2">
                            {Object.keys(manifest.settings).length > 0 && (
                              <Button
                                variant={expandedId === manifest.id ? "secondary" : "outline"}
                                size="icon"
                                title={t("settings.mods.configure")}
                                onClick={() =>
                                  setExpandedId((current) =>
                                    current === manifest.id ? undefined : manifest.id,
                                  )
                                }
                              >
                                <SlidersHorizontal />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="icon"
                              title={t("settings.mods.reload")}
                              disabled={reloadingId === manifest.id}
                              onClick={() => void reload(manifest.id)}
                            >
                              <RefreshCw
                                className={reloadingId === manifest.id ? "animate-spin" : undefined}
                              />
                            </Button>
                            <Button
                              variant="outline"
                              className="shrink-0"
                              disabled={isOpening}
                              onClick={() => void openEntry(manifest.id, "main")}
                            >
                              {openingId === `${manifest.id}:main` ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <FileCode2 />
                              )}
                              {t(
                                openingId === `${manifest.id}:main`
                                  ? "settings.mods.opening"
                                  : "settings.mods.open",
                              )}
                            </Button>
                            {manifest.gameEntry && (
                              <Button
                                variant="outline"
                                className="shrink-0"
                                disabled={isOpening}
                                onClick={() => void openEntry(manifest.id, "game")}
                              >
                                {openingId === `${manifest.id}:game` ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : (
                                  <FileCode2 />
                                )}
                                {t(
                                  openingId === `${manifest.id}:game`
                                    ? "settings.mods.opening"
                                    : "settings.mods.openGame",
                                )}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {expandedId === manifest.id && <ModSettingsForm mod={mod} />}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
