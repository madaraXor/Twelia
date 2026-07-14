import { describe, expect, it } from "vitest";
import { resolveLanguage, translate } from "./i18n";

describe("interface language", () => {
  it("uses an explicit preference", () => {
    expect(resolveLanguage("fr", ["en-US"])).toBe("fr");
  });

  it("picks the first supported system language and falls back to English", () => {
    expect(resolveLanguage("system", ["de-DE", "fr-FR", "en-US"])).toBe("fr");
    expect(resolveLanguage("system", ["de-DE"])).toBe("en");
  });

  it("interpolates translated values", () => {
    expect(translate("en", "command.openAccount", { name: "Math" })).toBe("Open Math");
  });
});
