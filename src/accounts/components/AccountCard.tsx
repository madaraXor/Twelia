import { LogOut, MoreHorizontal, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountProfile } from "../accountTypes";
import { maskLoginHint } from "../accountTypes";

type Props = {
  account: AccountProfile;
  active: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onDelete: () => void;
};

const statusLabels: Record<AccountProfile["sessionStatus"], string> = {
  unknown: "À vérifier",
  valid: "Session valide",
  expired: "Session expirée",
  "logged-out": "Déconnecté",
};

const statusVariants: Record<
  AccountProfile["sessionStatus"],
  "outline" | "success" | "warning" | "destructive"
> = {
  unknown: "outline",
  valid: "success",
  expired: "warning",
  "logged-out": "destructive",
};

export function AccountCard({
  account,
  active,
  onPlay,
  onEdit,
  onReconnect,
  onLogout,
  onDelete,
}: Props) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden transition-colors hover:border-primary/35">
      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-sm font-bold text-primary">
          {account.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{account.displayName}</CardTitle>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {maskLoginHint(account.loginHint) ?? "Aucun identifiant renseigné"}
          </p>
        </div>
        <Badge className="shrink-0" variant={statusVariants[account.sessionStatus]}>
          {statusLabels[account.sessionStatus]}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 pb-4 text-sm text-muted-foreground">
        {account.preferredCharacter ?? account.preferredServer ?? "Profil prêt"}
        {account.lastUsedAt
          ? ` · utilisé ${new Intl.DateTimeFormat("fr", { dateStyle: "medium" }).format(new Date(account.lastUsedAt))}`
          : ""}
      </CardContent>
      <CardFooter className="gap-2">
        <Button className="flex-1" onClick={onPlay}>
          <Play /> {active ? "Afficher" : "Jouer"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Actions pour ${account.displayName}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Modifier
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReconnect}>
              <RefreshCw /> Se reconnecter
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut /> Déconnecter
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-300 focus:text-red-200" onSelect={onDelete}>
              <Trash2 /> Supprimer les données locales
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}
