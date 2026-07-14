import { DEFAULT_SETTINGS, migrateSettings } from "./settingsStore";

describe("settings migration", () => {
  it("migre un ancien document et borne les valeurs", () => {
    expect(
      migrateSettings({ restoreTabs: false, maxSessions: 99, interfaceScale: 0.1 }),
    ).toMatchObject({
      schemaVersion: 2,
      restoreTabs: false,
      maxSessions: 12,
      interfaceScale: 0.8,
      autoSwitchOnCombatTurn: true,
      autoSwitchOnPartyInvitation: true,
      autoSwitchOnGroupFight: true,
      muteInactiveTabs: true,
    });
  });

  it("restaure les valeurs par défaut si le document est absent", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS.language).toBe("system");
    expect(DEFAULT_SETTINGS.muteInactiveTabs).toBe(true);
  });

  it("conserve une langue explicite et rejette une préférence inconnue", () => {
    expect(migrateSettings({ schemaVersion: 2, language: "fr" }).language).toBe("fr");
    expect(migrateSettings({ schemaVersion: 2, language: "es" }).language).toBe("system");
    expect(migrateSettings({ schemaVersion: 1, language: "fr" }).language).toBe("system");
  });
});
