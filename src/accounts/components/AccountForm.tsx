import { useState, type FormEvent } from "react";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountDraft, AccountProfile } from "../accountTypes";
import { useI18n } from "../../i18n/i18n";

type Props = {
  account?: AccountProfile;
  onSubmit: (draft: AccountDraft) => Promise<void>;
  onClose: () => void;
};

export function AccountForm({ account, onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [loginHint, setLoginHint] = useState(account?.loginHint ?? "");
  const [preferredServer, setPreferredServer] = useState(account?.preferredServer ?? "");
  const [preferredCharacter, setPreferredCharacter] = useState(account?.preferredCharacter ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ displayName, loginHint, preferredServer, preferredCharacter });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("account.form.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {t("account.form.localProfile")}
            </p>
            <DialogTitle>{account ? t("account.form.edit") : t("account.form.add")}</DialogTitle>
            <DialogDescription>{t("account.form.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="display-name">{t("account.form.name")}</Label>
            <Input
              id="display-name"
              autoFocus
              required
              maxLength={64}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("account.form.namePlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="login-hint">{t("account.form.login")}</Label>
            <Input
              id="login-hint"
              maxLength={254}
              value={loginHint}
              onChange={(event) => setLoginHint(event.target.value)}
              placeholder={t("account.form.loginPlaceholder")}
              autoComplete="username"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="preferred-server">{t("account.form.server")}</Label>
              <Input
                id="preferred-server"
                value={preferredServer}
                onChange={(event) => setPreferredServer(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preferred-character">{t("account.form.character")}</Label>
              <Input
                id="preferred-character"
                value={preferredCharacter}
                onChange={(event) => setPreferredCharacter(event.target.value)}
              />
            </div>
          </div>

          <Alert>
            <ShieldCheck />
            <AlertDescription>{t("account.form.security")}</AlertDescription>
          </Alert>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? t("account.form.saving") : t("account.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
