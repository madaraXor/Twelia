import type { ShortcutAction, ShortcutBinding, ShortcutsDocument } from "./shortcutTypes";

const ctrl = (isMac: boolean) => (isMac ? "Meta" : "Ctrl");
const LEGACY_COMMAND_PALETTE_DEFAULTS = new Set(["Ctrl+Shift+P", "Meta+Shift+P"]);

export function defaultBindings(
  isMac = /Mac|iPhone|iPad/.test(navigator.platform),
): ShortcutBinding[] {
  const mod = ctrl(isMac);
  const entries: Array<[ShortcutAction, string, string]> = [
    ["next-tab", "Onglet suivant", `${mod}+Tab`],
    ["previous-tab", "Onglet précédent", `${mod}+Shift+Tab`],
    ["select-tab-1", "Sélectionner l’onglet 1", `${mod}+1`],
    ["select-tab-2", "Sélectionner l’onglet 2", `${mod}+2`],
    ["select-tab-3", "Sélectionner l’onglet 3", `${mod}+3`],
    ["select-tab-4", "Sélectionner l’onglet 4", `${mod}+4`],
    ["select-tab-5", "Sélectionner l’onglet 5", `${mod}+5`],
    ["select-tab-6", "Sélectionner l’onglet 6", `${mod}+6`],
    ["select-tab-7", "Sélectionner l’onglet 7", `${mod}+7`],
    ["select-tab-8", "Sélectionner l’onglet 8", `${mod}+8`],
    ["select-last-tab", "Sélectionner le dernier onglet", `${mod}+9`],
    ["new-game-tab", "Ouvrir une session", `${mod}+T`],
    ["close-tab", "Fermer l’onglet", `${mod}+W`],
    ["reopen-tab", "Rouvrir le dernier onglet", `${mod}+Shift+T`],
    ["open-settings", "Ouvrir les paramètres", `${mod}+Comma`],
    ["open-home", "Ouvrir l’accueil", `${mod}+L`],
    ["reload-active-session", "Recharger la session", `${mod}+R`],
    ["toggle-fullscreen", "Basculer le plein écran", "F11"],
    ["open-command-palette", "Ouvrir la palette", `${mod}+K`],
  ];
  return entries.map(([action, label, accelerator]) => ({
    action,
    label,
    accelerator,
    defaultAccelerator: accelerator,
  }));
}

const MODIFIER_ORDER = ["Ctrl", "Meta", "Alt", "Shift"];

export function normalizeAccelerator(accelerator: string): string {
  const aliases: Record<string, string> = {
    control: "Ctrl",
    ctrl: "Ctrl",
    cmd: "Meta",
    command: "Meta",
    meta: "Meta",
    option: "Alt",
    alt: "Alt",
    shift: "Shift",
    ",": "Comma",
  };
  const parts = accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => aliases[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part));
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier));
  const keys = parts.filter((part) => !MODIFIER_ORDER.includes(part));
  return [...modifiers, ...keys].join("+");
}

export function validateAccelerator(accelerator: string | null): string | null {
  if (accelerator === null) return null;
  const normalized = normalizeAccelerator(accelerator);
  const parts = normalized.split("+");
  const keyParts = parts.filter((part) => !MODIFIER_ORDER.includes(part));
  if (keyParts.length !== 1) return "Le raccourci doit contenir exactement une touche principale.";
  if (parts.length > 4) return "Le raccourci contient trop de modificateurs.";
  return null;
}

export function findShortcutConflicts(bindings: ShortcutBinding[]): Map<string, ShortcutAction[]> {
  const byAccelerator = new Map<string, ShortcutAction[]>();
  for (const binding of bindings) {
    if (!binding.accelerator) continue;
    const normalized = normalizeAccelerator(binding.accelerator);
    byAccelerator.set(normalized, [...(byAccelerator.get(normalized) ?? []), binding.action]);
  }
  return new Map([...byAccelerator].filter(([, actions]) => actions.length > 1));
}

export function keyboardEventAccelerator(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.code === "Comma" ? "Comma" : event.code.replace(/^Key/, "").replace(/^Digit/, "");
  if (
    ![
      "ControlLeft",
      "ControlRight",
      "MetaLeft",
      "MetaRight",
      "AltLeft",
      "AltRight",
      "ShiftLeft",
      "ShiftRight",
    ].includes(event.code)
  ) {
    parts.push(key);
  }
  return normalizeAccelerator(parts.join("+"));
}

export function migrateShortcuts(input: unknown): ShortcutsDocument {
  const defaults = defaultBindings();
  if (!input || typeof input !== "object") return { schemaVersion: 1, bindings: defaults };
  const raw = input as Partial<ShortcutsDocument>;
  if (!Array.isArray(raw.bindings)) return { schemaVersion: 1, bindings: defaults };
  const custom = new Map(raw.bindings.map((binding) => [binding.action, binding]));
  return {
    schemaVersion: 1,
    bindings: defaults.map((binding) => {
      const saved = custom.get(binding.action);
      if (!saved) return binding;
      const savedAccelerator = saved.accelerator ? normalizeAccelerator(saved.accelerator) : null;
      const usedLegacyDefault =
        binding.action === "open-command-palette" &&
        savedAccelerator !== null &&
        LEGACY_COMMAND_PALETTE_DEFAULTS.has(savedAccelerator) &&
        LEGACY_COMMAND_PALETTE_DEFAULTS.has(normalizeAccelerator(saved.defaultAccelerator));
      return {
        ...binding,
        accelerator: usedLegacyDefault ? binding.accelerator : savedAccelerator,
      };
    }),
  };
}
