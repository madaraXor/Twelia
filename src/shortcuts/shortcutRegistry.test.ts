import {
  defaultBindings,
  findShortcutConflicts,
  migrateShortcuts,
  normalizeAccelerator,
  validateAccelerator,
} from "./shortcutRegistry";

describe("shortcut registry", () => {
  it("normalise et valide les accélérateurs", () => {
    expect(normalizeAccelerator("shift + ctrl + p")).toBe("Ctrl+Shift+P");
    expect(validateAccelerator("Ctrl+Shift+P")).toBeNull();
    expect(validateAccelerator("Ctrl+Shift")).toMatch(/touche principale/);
    expect(validateAccelerator(null)).toBeNull();
  });

  it("détecte les conflits sans compter les raccourcis désactivés", () => {
    const bindings = defaultBindings(false);
    bindings[0] = { ...bindings[0]!, accelerator: "Ctrl+P" };
    bindings[1] = { ...bindings[1]!, accelerator: "Ctrl+P" };
    bindings[2] = { ...bindings[2]!, accelerator: null };
    expect(findShortcutConflicts(bindings).get("Ctrl+P")).toEqual(["next-tab", "previous-tab"]);
  });

  it("utilise Ctrl+K pour ouvrir la palette", () => {
    const palette = defaultBindings(false).find(
      (binding) => binding.action === "open-command-palette",
    );
    expect(palette?.accelerator).toBe("Ctrl+K");
    expect(palette?.defaultAccelerator).toBe("Ctrl+K");
  });

  it("migre l’ancien raccourci par défaut sans écraser une personnalisation", () => {
    const legacy = defaultBindings(false).map((binding) =>
      binding.action === "open-command-palette"
        ? { ...binding, accelerator: "Ctrl+Shift+P", defaultAccelerator: "Ctrl+Shift+P" }
        : binding,
    );
    const migrated = migrateShortcuts({ schemaVersion: 1, bindings: legacy });
    expect(
      migrated.bindings.find((binding) => binding.action === "open-command-palette")?.accelerator,
    ).toBe("Ctrl+K");

    const customized = legacy.map((binding) =>
      binding.action === "open-command-palette" ? { ...binding, accelerator: "Ctrl+J" } : binding,
    );
    expect(
      migrateShortcuts({ schemaVersion: 1, bindings: customized }).bindings.find(
        (binding) => binding.action === "open-command-palette",
      )?.accelerator,
    ).toBe("Ctrl+J");
  });
});
