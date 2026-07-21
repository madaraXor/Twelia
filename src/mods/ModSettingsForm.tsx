import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toTweliaError } from "../core/errors";
import { useI18n } from "../i18n/i18n";
import { getModSettings, resetModSettings, setModSetting } from "./modService";
import type { InstalledMod } from "./modTypes";

function toInputValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function ModSettingsForm({ mod }: { mod: InstalledMod }) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setValues(await getModSettings(mod.manifest.id));
    } catch (cause) {
      setError(toTweliaError(cause).message);
    } finally {
      setLoading(false);
    }
  }, [mod.manifest.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (key: string, value: unknown) => {
    setSavingKey(key);
    setError(undefined);
    try {
      setValues(await setModSetting(mod.manifest.id, key, value));
    } catch (cause) {
      setError(toTweliaError(cause).message);
    } finally {
      setSavingKey(undefined);
    }
  };

  const reset = async () => {
    setSavingKey("*");
    setError(undefined);
    try {
      setValues(await resetModSettings(mod.manifest.id));
    } catch (cause) {
      setError(toTweliaError(cause).message);
    } finally {
      setSavingKey(undefined);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-20 place-items-center text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 border-t border-border bg-muted/20 px-5 py-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(mod.manifest.settings).map(([key, definition]) => {
          const id = `mod-setting-${mod.manifest.id}-${key}`;
          const pending = savingKey === key || savingKey === "*";
          const description = definition.description && (
            <p className="text-xs leading-4 text-muted-foreground">{definition.description}</p>
          );
          if (definition.type === "boolean") {
            return (
              <div
                key={key}
                className="flex items-start justify-between gap-4 rounded-lg border p-3"
              >
                <div className="grid gap-1">
                  <Label htmlFor={id}>{definition.label}</Label>
                  {description}
                </div>
                <Switch
                  id={id}
                  checked={Boolean(values[key])}
                  disabled={pending}
                  onCheckedChange={(value) => void save(key, value)}
                />
              </div>
            );
          }
          if (definition.type === "select") {
            return (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={id}>{definition.label}</Label>
                {description}
                <select
                  id={id}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={toInputValue(values[key])}
                  disabled={pending}
                  onChange={(event) => void save(key, event.target.value)}
                >
                  {(definition.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (definition.type === "secret") {
            return (
              <div key={key} className="grid gap-1 rounded-lg border border-dashed p-3">
                <Label>{definition.label}</Label>
                {description}
                <p className="text-xs text-muted-foreground">{t("settings.mods.secretScoped")}</p>
              </div>
            );
          }
          const current = values[key];
          return (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={id}>{definition.label}</Label>
              {description}
              <Input
                id={id}
                type={definition.type === "number" ? "number" : "text"}
                value={toInputValue(current)}
                min={definition.minimum}
                max={definition.maximum}
                step={definition.step}
                placeholder={definition.placeholder}
                disabled={pending}
                onChange={(event) =>
                  setValues((existing) => ({ ...existing, [key]: event.target.value }))
                }
                onBlur={(event) => {
                  const value =
                    definition.type === "number" ? Number(event.target.value) : event.target.value;
                  void save(key, value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </div>
          );
        })}
      </div>
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={Boolean(savingKey)}
          onClick={() => void reset()}
        >
          {savingKey === "*" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
          {t("settings.mods.resetSettings")}
        </Button>
      </div>
    </div>
  );
}
