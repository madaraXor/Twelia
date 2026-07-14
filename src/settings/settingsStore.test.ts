import { DEFAULT_SETTINGS, migrateSettings } from "./settingsStore";

describe("settings migration", () => {
  it("migre un ancien document et borne les valeurs", () => {
    expect(
      migrateSettings({ restoreTabs: false, maxSessions: 99, interfaceScale: 0.1 }),
    ).toMatchObject({
      schemaVersion: 3,
      restoreTabs: false,
      maxSessions: 12,
      interfaceScale: 0.8,
      autoSwitchOnCombatTurn: true,
      autoSwitchOnPartyInvitation: true,
      autoSwitchOnGroupFight: true,
      muteInactiveTabs: true,
      limitBackgroundRendering: false,
      suspendInactiveTabs: false,
      showMobileQuickSwitch: true,
      showMobileSessionPill: false,
    });
  });

  it("restaure les valeurs par défaut si le document est absent", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS.language).toBe("system");
    expect(DEFAULT_SETTINGS.muteInactiveTabs).toBe(true);
    expect(DEFAULT_SETTINGS.limitBackgroundRendering).toBe(false);
    expect(DEFAULT_SETTINGS.suspendInactiveTabs).toBe(false);
    expect(DEFAULT_SETTINGS.showMobileQuickSwitch).toBe(true);
    expect(DEFAULT_SETTINGS.showMobileSessionPill).toBe(false);
  });

  it("conserve une langue explicite et rejette une préférence inconnue", () => {
    expect(migrateSettings({ schemaVersion: 2, language: "fr" }).language).toBe("fr");
    expect(migrateSettings({ schemaVersion: 2, language: "es" }).language).toBe("system");
    expect(migrateSettings({ schemaVersion: 1, language: "fr" }).language).toBe("system");
  });

  it("applique une fois les nouveaux défauts de performance aux anciens réglages", () => {
    const migrated = migrateSettings({
      schemaVersion: 2,
      limitBackgroundRendering: true,
      suspendInactiveTabs: true,
    });

    expect(migrated.limitBackgroundRendering).toBe(false);
    expect(migrated.suspendInactiveTabs).toBe(false);
  });

  it("conserve ensuite les choix explicites avec le schéma courant", () => {
    const migrated = migrateSettings({
      schemaVersion: 3,
      limitBackgroundRendering: true,
      suspendInactiveTabs: true,
      showMobileQuickSwitch: false,
      showMobileSessionPill: true,
    });

    expect(migrated).toMatchObject({
      limitBackgroundRendering: true,
      suspendInactiveTabs: true,
      showMobileQuickSwitch: false,
      showMobileSessionPill: true,
    });
  });
});
