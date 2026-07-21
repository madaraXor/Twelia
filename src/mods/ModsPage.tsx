import { Puzzle, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "../i18n/i18n";
import { ModsManager } from "./ModsManager";

export function ModsPage() {
  const { t } = useI18n();

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_14%_0%,var(--color-surface-elevated),var(--color-background)_34rem)]">
      <div className="mx-auto w-full max-w-[1040px] px-5 py-7 sm:px-8 sm:py-9">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              {t("mods.page.eyebrow")}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
                <Puzzle />
              </span>
              <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em]">
                {t("mods.page.title")}
              </h1>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("mods.page.description")}
            </p>
          </div>
          <Badge variant="success" className="w-fit shrink-0">
            {t("mods.page.active")}
          </Badge>
        </header>

        <Alert className="mb-4">
          <ShieldAlert />
          <AlertDescription>{t("settings.mods.enabled.warning")}</AlertDescription>
        </Alert>

        <ModsManager />
      </div>
    </main>
  );
}
