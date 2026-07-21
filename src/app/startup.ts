import { useAccountStore } from "../accounts/accountStore";
import { diagnosticLogger } from "../diagnostics/diagnosticLogger";
import { useModStore } from "../mods/modStore";
import { useSettingsStore } from "../settings/settingsStore";
import { useShortcutStore } from "../shortcuts/shortcutStore";
import { useTabStore } from "../tabs/tabStore";

export async function startup(): Promise<void> {
  const startedAt = performance.now();
  diagnosticLogger.info("startup", "Démarrage de Twelia");
  await useSettingsStore.getState().hydrate();
  await useAccountStore.getState().hydrate();
  if (useSettingsStore.getState().restoreTabs) await useTabStore.getState().hydrate();
  try {
    await useModStore.getState().load();
    if (!useModStore.getState().enabled) useTabStore.getState().closeTab("mods");
  } catch (error) {
    diagnosticLogger.warn("mods", `État global indisponible : ${String(error)}`);
  }
  await useShortcutStore.getState().hydrate();
  diagnosticLogger.info(
    "startup",
    `Interface restaurée en ${Math.round(performance.now() - startedAt)} ms`,
  );
}
