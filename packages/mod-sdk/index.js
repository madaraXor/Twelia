export function defineMod(definition) {
  if (globalThis.twelia) {
    if (typeof definition.load === "function") {
      globalThis.twelia.on("load", () => definition.load(globalThis.twelia), { once: true });
    }
    if (typeof definition.unload === "function") {
      globalThis.twelia.on("unload", () => definition.unload(), { once: true });
    }
  }
  return definition;
}
