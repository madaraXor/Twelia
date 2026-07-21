import { GameTab } from "../game/GameTab";
import { HomeTab } from "../home/HomeTab";
import { ModsPage } from "../mods/ModsPage";
import { useModStore } from "../mods/modStore";
import { SettingsTab } from "../settings/SettingsTab";
import { isMobilePlatform } from "../platform/platform";
import { useTabStore } from "./tabStore";

export function TabContent() {
  const activeTabId = useTabStore((state) => state.activeTabId);
  const tabs = useTabStore((state) => state.tabs);
  const modsEnabled = useModStore((state) => state.enabled);
  const tab = tabs.find((item) => item.id === activeTabId);
  if (isMobilePlatform()) {
    const gameTabs = tabs.filter((item) => item.type === "game");
    return (
      <div className="relative h-full min-h-0">
        {(!tab || tab.type === "home") && <HomeTab />}
        {tab?.type === "settings" && (
          <SettingsTab key={tab.settingsSection} initialSection={tab.settingsSection} />
        )}
        {tab?.type === "mods" && (modsEnabled ? <ModsPage /> : <HomeTab />)}
        {gameTabs.map((gameTab) => (
          <div
            key={gameTab.id}
            className={
              gameTab.id === activeTabId
                ? "absolute inset-0 z-10 visible"
                : "pointer-events-none absolute inset-0 invisible"
            }
            aria-hidden={gameTab.id !== activeTabId}
          >
            <GameTab accountId={gameTab.accountId} />
          </div>
        ))}
      </div>
    );
  }
  if (!tab || tab.type === "home") return <HomeTab />;
  if (tab.type === "settings")
    return <SettingsTab key={tab.settingsSection} initialSection={tab.settingsSection} />;
  if (tab.type === "mods") return modsEnabled ? <ModsPage /> : <HomeTab />;
  return <GameTab accountId={tab.accountId} />;
}
