import { describe, expect, it } from "vitest";
import { commandFilter, matchesSearch, normalizeSearchText } from "./search";

describe("search normalization", () => {
  it("ignores accents and letter casing", () => {
    expect(normalizeSearchText("  GÉnéral  ")).toBe("general");
    expect(matchesSearch("parametres", "Paramètres")).toBe(true);
    expect(matchesSearch("qualite rendu", "Qualité de rendu")).toBe(true);
  });

  it("keeps unrelated results filtered out", () => {
    expect(commandFilter("Ouvrir les journaux", "theme")).toBe(0);
  });
});
