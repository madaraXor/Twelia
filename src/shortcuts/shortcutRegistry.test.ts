import {
  defaultBindings,
  findShortcutConflicts,
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
});
