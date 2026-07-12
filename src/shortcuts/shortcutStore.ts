import { create } from "zustand";
import { storageGateway } from "../storage/storageGateway";
import {
  defaultBindings,
  findShortcutConflicts,
  migrateShortcuts,
  normalizeAccelerator,
  validateAccelerator,
} from "./shortcutRegistry";
import type { ShortcutAction, ShortcutBinding, ShortcutsDocument } from "./shortcutTypes";

type ShortcutState = ShortcutsDocument & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setBinding: (action: ShortcutAction, accelerator: string | null) => Promise<string | null>;
  resetBinding: (action: ShortcutAction) => Promise<void>;
  resetAll: () => Promise<void>;
  conflicts: () => Map<string, ShortcutAction[]>;
};

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  schemaVersion: 1,
  bindings: defaultBindings(),
  hydrated: false,
  hydrate: async () => {
    const saved = await storageGateway.load<ShortcutsDocument>("shortcuts");
    set({ ...migrateShortcuts(saved), hydrated: true });
  },
  setBinding: async (action, accelerator) => {
    const validation = validateAccelerator(accelerator);
    if (validation) return validation;
    const bindings = get().bindings.map((binding) =>
      binding.action === action
        ? { ...binding, accelerator: accelerator ? normalizeAccelerator(accelerator) : null }
        : binding,
    );
    const document = { schemaVersion: 1 as const, bindings };
    set(document);
    await storageGateway.save("shortcuts", document);
    return null;
  },
  resetBinding: async (action) => {
    const bindings = get().bindings.map((binding) =>
      binding.action === action ? { ...binding, accelerator: binding.defaultAccelerator } : binding,
    );
    const document = { schemaVersion: 1 as const, bindings };
    set(document);
    await storageGateway.save("shortcuts", document);
  },
  resetAll: async () => {
    const document = { schemaVersion: 1 as const, bindings: defaultBindings() };
    set(document);
    await storageGateway.save("shortcuts", document);
  },
  conflicts: () => findShortcutConflicts(get().bindings),
}));

export function findBindingForAccelerator(
  bindings: ShortcutBinding[],
  accelerator: string,
): ShortcutBinding | undefined {
  const normalized = normalizeAccelerator(accelerator);
  return bindings.find(
    (binding) => binding.accelerator && normalizeAccelerator(binding.accelerator) === normalized,
  );
}
