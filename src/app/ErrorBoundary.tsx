import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { resolveLanguage, translate } from "../i18n/i18n";
import { useSettingsStore } from "../settings/settingsStore";

type State = { error?: Error };

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    diagnosticLogger.error("frontend", `${error.message}\n${info.componentStack ?? ""}`);
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const language = resolveLanguage(useSettingsStore.getState().language);
    const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
    return (
      <main className="grid h-full place-items-center p-6">
        <Card className="w-full max-w-xl">
          <CardContent className="space-y-5 p-6">
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t("error.title")}</AlertTitle>
              <AlertDescription>{this.state.error.message}</AlertDescription>
            </Alert>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => window.location.reload()}>
                <RotateCcw /> {t("error.reload")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  this.setState({ error: undefined });
                  window.location.hash = "#home";
                }}
              >
                {t("error.home")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }
}
