import { useTabStore } from "../tabs/tabStore";

export function navigateTo(tabId: string): void {
  useTabStore.getState().selectTab(tabId);
}
