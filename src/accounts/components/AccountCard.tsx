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
import { useI18n } from "../../i18n/i18n";

type Props = {
  account: AccountProfile;
  active: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onDelete: () => void;
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

const avatarClasses: Record<AccountProfile["sessionStatus"], string> = {
  unknown: "border-border-strong bg-accent text-muted-foreground",
  valid: "border-success bg-[var(--success-bg)] text-success",
  expired: "border-warning bg-[var(--warning-bg)] text-warning",
  "logged-out": "border-danger bg-[var(--danger-bg)] text-danger",
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
  const { locale, t } = useI18n();
  const statusLabels: Record<AccountProfile["sessionStatus"], string> = {
    unknown: t("account.status.unknown"),
    valid: t("account.status.valid"),
    expired: t("account.status.expired"),
    "logged-out": t("account.status.loggedOut"),
  };
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-primary/35 hover:shadow-[0_12px_30px_-22px_rgba(231,178,76,.45)]">
      <CardHeader className="flex-row items-start gap-3 space-y-0 p-[18px] pb-4">
        <div
          className={`grid size-11 shrink-0 place-items-center rounded-[11px] border text-sm font-extrabold ${avatarClasses[account.sessionStatus]}`}
        >
          {account.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{account.displayName}</CardTitle>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {maskLoginHint(account.loginHint) ?? t("account.noLogin")}
          </p>
        </div>
        <Badge className="shrink-0" variant={statusVariants[account.sessionStatus]}>
          {statusLabels[account.sessionStatus]}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 px-[18px] pb-4 text-[13px] text-muted-foreground">
        {account.preferredCharacter ?? account.preferredServer ?? t("account.ready")}
        {account.lastUsedAt
          ? ` · ${t("account.lastUsed", {
              date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                new Date(account.lastUsedAt),
              ),
            })}`
          : ""}
      </CardContent>
      <CardFooter className="gap-2 px-[18px] pb-[18px]">
        <Button className="flex-1" onClick={onPlay}>
          <Play /> {active ? t("account.show") : t("account.play")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("account.actions", { name: account.displayName })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {t("account.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReconnect}>
              <RefreshCw /> {t("account.reconnect")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut /> {t("account.logout")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:text-danger" onSelect={onDelete}>
              <Trash2 /> {t("account.deleteLocal")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}
