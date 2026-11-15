import { describe, it, expect } from "vitest";
import { ALLOWED_EMAILS, CREDENTIAL_EMAILS, isCredentialEmail } from "./allowed-emails";

describe("CREDENTIAL_EMAILS", () => {
  it("es solo el Gmail personal", () => {
    expect(CREDENTIAL_EMAILS).toEqual(["bradlyls95@gmail.com"]);
  });

  it("nunca es más amplio que el allowlist de la web", () => {
    for (const email of CREDENTIAL_EMAILS) expect(ALLOWED_EMAILS).toContain(email);
  });

  it("la cuenta de Workspace sigue entrando a la web, pero no emite credenciales largas", () => {
    expect(ALLOWED_EMAILS).toContain("brad@uxprogramming.com");
    expect(CREDENTIAL_EMAILS).not.toContain("brad@uxprogramming.com");
    expect(isCredentialEmail("brad@uxprogramming.com")).toBe(false);
  });

  it("isCredentialEmail compara exacto y solo strings", () => {
    expect(isCredentialEmail("bradlyls95@gmail.com")).toBe(true);
    for (const v of ["BRADLYLS95@gmail.com", " bradlyls95@gmail.com", "", null, undefined, 1, {}]) {
      expect(isCredentialEmail(v)).toBe(false);
    }
  });
});
