import { useAccountStore } from "../accounts/accountStore";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { showGameAttentionNotification } from "../notifications/gameAttentionNotification";
import { useSettingsStore } from "../settings/settingsStore";
import { useTabStore } from "../tabs/tabStore";
import { decideGameAttention, type GameAttentionKind } from "./gameAttention";

type HandleGameAttentionOptions = {
  accountId: string;
  kind: GameAttentionKind;
  sessionId?: string;
};

export function handleGameAttention({
  accountId,
  kind,
  sessionId,
}: HandleGameAttentionOptions): void {
  const tabs = useTabStore.getState();
  const target = tabs.tabs.find((tab) => tab.type === "game" && tab.accountId === accountId);
  const alreadyActive = target?.id === tabs.activeTabId;
  const decision = decideGameAttention(useSettingsStore.getState(), kind, alreadyActive);

  if (decision.autoSwitch) {
    if (target) tabs.selectTab(target.id);
    else tabs.openGame(accountId);

    diagnosticLogger.info("game-attention", `Changement d’onglet : ${kind}`, {
      ...(sessionId ? { gameSessionId: sessionId } : {}),
      accountId,
    });
  }

  const accountName = useAccountStore
    .getState()
    .accounts.find((account) => account.id === accountId)?.displayName;

  showGameAttentionNotification({
    accountId,
    accountName,
    kind,
    autoSwitched: decision.autoSwitch,
    offerNavigation: decision.offerNavigation,
  });
}
