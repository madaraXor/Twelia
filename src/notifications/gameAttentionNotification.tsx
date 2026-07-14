import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "../tabs/tabStore";
import { describeGameAttention, type GameAttentionKind } from "../game/gameAttention";

type GameAttentionNotificationOptions = {
  accountId: string;
  accountName?: string;
  kind: GameAttentionKind;
  autoSwitched: boolean;
  offerNavigation: boolean;
};

const ATTENTION_TITLES: Record<GameAttentionKind, string> = {
  "combat-turn": "À vous de jouer",
  "party-invitation": "Invitation reçue",
  "group-fight": "Combat de groupe",
};

export function showGameAttentionNotification({
  accountId,
  accountName,
  kind,
  autoSwitched,
  offerNavigation,
}: GameAttentionNotificationOptions): void {
  if (!useSettingsStore.getState().showNotifications) return;

  const title = autoSwitched ? "Changement automatique" : ATTENTION_TITLES[kind];
  const description = describeGameAttention(kind, accountName);
  const duration = offerNavigation ? 12_000 : 4_500;

  toast.custom(
    (toastId) => (
      <div
        data-testid="game-attention-toast"
        role={offerNavigation ? "alert" : "status"}
        className="pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-center gap-3 rounded-[14px] border border-border-strong bg-popover/95 px-4 py-3 text-popover-foreground shadow-[0_16px_36px_var(--shadow)] backdrop-blur-xl"
      >
        <span
          aria-hidden="true"
          className={cn(
            "session-dot-pulse size-2.5 shrink-0 rounded-full",
            offerNavigation ? "bg-warning" : "bg-primary",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-5">{title}</div>
          <div className="truncate text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
        {offerNavigation && (
          <Button
            size="sm"
            className="h-8 px-3"
            onClick={() => {
              useTabStore.getState().openGame(accountId);
              toast.dismiss(toastId);
            }}
          >
            Y aller
          </Button>
        )}
        <button
          type="button"
          aria-label="Fermer la notification"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => toast.dismiss(toastId)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    ),
    {
      id: `game-attention:${accountId}:${kind}`,
      duration,
      dismissible: true,
    },
  );
}
