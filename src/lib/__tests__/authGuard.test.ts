import { describe, expect, it } from "vitest";
import {
  buildLoginRedirectPath,
  DEFAULT_POST_LOGIN_PATH,
  isProtectedPath,
  LOGIN_PATH,
  resolveSafeNext,
} from "../authGuard";

// ST 4.2 — logique pure de protection des routes (utilisée par src/middleware.ts).

describe("isProtectedPath", () => {
  it("protège les préfixes réservés aux comptes et leurs sous-chemins", () => {
    for (const p of ["/mon-espace", "/mon-espace/historique", "/import", "/import/nouveau"]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
  });

  it("laisse passer les routes publiques", () => {
    for (const p of ["/", "/bibliotheque", "/connexion", "/inscription", "/doublage/abc", "/api/doublages"]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });

  it("ne se laisse pas piéger par un préfixe partiel", () => {
    expect(isProtectedPath("/mon-espace-public")).toBe(false);
    expect(isProtectedPath("/importateur")).toBe(false);
  });
});

describe("resolveSafeNext", () => {
  it("accepte un chemin interne", () => {
    expect(resolveSafeNext("/mon-espace/historique")).toBe("/mon-espace/historique");
  });

  it("rejette une URL externe ou protocol-relative (anti-redirection ouverte)", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(resolveSafeNext(bad), bad).toBe(DEFAULT_POST_LOGIN_PATH);
    }
  });

  it("retombe sur le fallback pour une valeur vide ou absente", () => {
    expect(resolveSafeNext(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolveSafeNext(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(resolveSafeNext("", "/x")).toBe("/x");
  });
});

describe("buildLoginRedirectPath", () => {
  it("pointe vers la page de connexion en conservant la cible encodée", () => {
    const path = buildLoginRedirectPath("/mon-espace/historique?page=2");
    expect(path.startsWith(`${LOGIN_PATH}?next=`)).toBe(true);
    const next = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("next");
    expect(next).toBe("/mon-espace/historique?page=2");
  });

  it("neutralise une cible externe", () => {
    const path = buildLoginRedirectPath("https://evil.example");
    const next = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("next");
    expect(next).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});
