import { describe, expect, it } from "vitest";
import {
  buildHistoriqueApiUrl,
  HISTORIQUE_PAGE_SIZE_DEFAUT,
  HISTORIQUE_PAGE_SIZE_MAX,
  HistoriqueQueryError,
  parseHistoriqueQuery,
} from "../doublageSauvegardeClient";

// ST 6.2 « Historique des doublages » — parsing/validation des query params du
// endpoint `GET /api/doublages?utilisateur=me` et construction de l'URL d'appel
// (fonctions pures, cf. `lib/extraitsClient` pour ST 1.1).

function params(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

describe("parseHistoriqueQuery", () => {
  it("accepte utilisateur=me et applique les valeurs par défaut", () => {
    expect(parseHistoriqueQuery(params("utilisateur=me"))).toEqual({
      page: 1,
      pageSize: HISTORIQUE_PAGE_SIZE_DEFAUT,
    });
  });

  it("lit page et pageSize", () => {
    expect(parseHistoriqueQuery(params("utilisateur=me&page=3&pageSize=5"))).toEqual({
      page: 3,
      pageSize: 5,
    });
  });

  it("plafonne pageSize à HISTORIQUE_PAGE_SIZE_MAX", () => {
    expect(parseHistoriqueQuery(params("utilisateur=me&pageSize=9999")).pageSize).toBe(
      HISTORIQUE_PAGE_SIZE_MAX
    );
  });

  it("refuse un utilisateur absent", () => {
    expect(() => parseHistoriqueQuery(params(""))).toThrow(HistoriqueQueryError);
  });

  it("refuse un utilisateur autre que « me » (pas d'historique d'un tiers)", () => {
    expect(() => parseHistoriqueQuery(params("utilisateur=user-123"))).toThrow(
      HistoriqueQueryError
    );
  });

  it.each(["0", "-1", "abc", "1.5"])("refuse page=%s", (page) => {
    expect(() => parseHistoriqueQuery(params(`utilisateur=me&page=${page}`))).toThrow(
      HistoriqueQueryError
    );
  });

  it.each(["0", "-2", "x"])("refuse pageSize=%s", (pageSize) => {
    expect(() =>
      parseHistoriqueQuery(params(`utilisateur=me&pageSize=${pageSize}`))
    ).toThrow(HistoriqueQueryError);
  });
});

describe("buildHistoriqueApiUrl", () => {
  it("cible /api/doublages avec utilisateur=me", () => {
    expect(buildHistoriqueApiUrl()).toBe("/api/doublages?utilisateur=me");
  });

  it("n'ajoute le paramètre page qu'au-delà de la page 1", () => {
    expect(buildHistoriqueApiUrl({ page: 1 })).toBe("/api/doublages?utilisateur=me");
    expect(buildHistoriqueApiUrl({ page: 4 })).toBe("/api/doublages?utilisateur=me&page=4");
  });
});
