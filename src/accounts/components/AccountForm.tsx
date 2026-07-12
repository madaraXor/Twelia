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

type Props = {
  account?: AccountProfile;
  onSubmit: (draft: AccountDraft) => Promise<void>;
  onClose: () => void;
};

export function AccountForm({ account, onSubmit, onClose }: Props) {
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
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer le profil.");
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
              Profil local
            </p>
            <DialogTitle>{account ? "Modifier le compte" : "Ajouter un compte"}</DialogTitle>
            <DialogDescription>
              Ce profil reste local et ne contient jamais votre mot de passe.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="display-name">Nom dans Twelia</Label>
            <Input
              id="display-name"
              autoFocus
              required
              maxLength={64}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Mon Crâ"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="login-hint">Identifiant public ou e-mail</Label>
            <Input
              id="login-hint"
              maxLength={254}
              value={loginHint}
              onChange={(event) => setLoginHint(event.target.value)}
              placeholder="Affiché sous forme masquée"
              autoComplete="username"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="preferred-server">Serveur préféré</Label>
              <Input
                id="preferred-server"
                value={preferredServer}
                onChange={(event) => setPreferredServer(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preferred-character">Personnage préféré</Label>
              <Input
                id="preferred-character"
                value={preferredCharacter}
                onChange={(event) => setPreferredCharacter(event.target.value)}
              />
            </div>
          </div>

          <Alert>
            <ShieldCheck />
            <AlertDescription>
              Twelia ne demande ni ne conserve le mot de passe. L’authentification s’effectue dans
              la fenêtre officielle Ankama.
            </AlertDescription>
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
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
