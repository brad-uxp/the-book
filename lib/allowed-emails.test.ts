import { describe, it, expect } from "vitest";
import { ALLOWED_EMAILS, MOBILE_ALLOWED_EMAILS } from "./allowed-emails";

describe("MOBILE_ALLOWED_EMAILS", () => {
  it("es solo el Gmail personal", () => {
    expect(MOBILE_ALLOWED_EMAILS).toEqual(["bradlyls95@gmail.com"]);
  });

  it("nunca es más amplio que el allowlist de la web", () => {
    for (const email of MOBILE_ALLOWED_EMAILS) expect(ALLOWED_EMAILS).toContain(email);
  });

  it("la cuenta de Workspace sigue entrando a la web, no al teléfono", () => {
    expect(ALLOWED_EMAILS).toContain("brad@uxprogramming.com");
    expect(MOBILE_ALLOWED_EMAILS).not.toContain("brad@uxprogramming.com");
  });
});
