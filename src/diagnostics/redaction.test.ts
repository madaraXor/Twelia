import { redactSensitiveData, sanitizeObject } from "./redaction";

describe("diagnostic redaction", () => {
  it("supprime les secrets et anonymise les e-mails", () => {
    const input = "authorization: Bearer abc.def token=secret cookie=sid42 user@example.test";
    const output = redactSensitiveData(input);
    expect(output).not.toContain("abc.def");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("sid42");
    expect(output).toContain("•••@example.test");
  });

  it("nettoie récursivement les rapports", () => {
    const output = JSON.stringify(
      sanitizeObject({ theme: "dark", nested: { accessToken: "secret", cookies: ["private"] } }),
    );
    expect(output).toContain("dark");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private");
  });
});
