import { DEFAULT_SETTINGS, migrateSettings } from "./settingsStore";

describe("settings migration", () => {
  it("migre un ancien document et borne les valeurs", () => {
    expect(
      migrateSettings({ restoreTabs: false, maxSessions: 99, interfaceScale: 0.1 }),
    ).toMatchObject({
      schemaVersion: 1,
      restoreTabs: false,
      maxSessions: 12,
      interfaceScale: 0.8,
      autoSwitchOnCombatTurn: true,
      autoSwitchOnPartyInvitation: true,
      autoSwitchOnGroupFight: true,
    });
  });

  it("restaure les valeurs par défaut si le document est absent", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.theme).toBe("system");
  });
});
