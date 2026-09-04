import { describe, expect, it } from "vitest";
import {
  buildFavorisApiUrl,
  buildFavoriToggleApiUrl,
  FAVORIS_PAGE_SIZE_DEFAUT,
  FAVORIS_PAGE_SIZE_MAX,
  FavorisQueryError,
  parseFavorisQuery,
} from "../favoriClient";

// ST 8.1 « Marquer une scène en favori » — parsing/validation des query
// params du endpoint `GET /api/favoris` et construction des URLs d'appel
// (fonctions pures, cf. `lib/doublageSauvegardeClient` pour ST 6.2).

function params(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

describe("parseFavorisQuery", () => {
  it("applique les valeurs par défaut sans query params", () => {
    expect(parseFavorisQuery(params(""))).toEqual({
      page: 1,
      pageSize: FAVORIS_PAGE_SIZE_DEFAUT,
    });
  });

  it("lit page et pageSize", () => {
    expect(parseFavorisQuery(params("page=3&pageSize=5"))).toEqual({
      page: 3,
      pageSize: 5,
    });
  });

  it("plafonne pageSize à FAVORIS_PAGE_SIZE_MAX", () => {
    expect(parseFavorisQuery(params("pageSize=9999")).pageSize).toBe(FAVORIS_PAGE_SIZE_MAX);
  });

  it.each(["0", "-1", "abc", "1.5"])("refuse page=%s", (page) => {
    expect(() => parseFavorisQuery(params(`page=${page}`))).toThrow(FavorisQueryError);
  });

  it.each(["0", "-2", "x"])("refuse pageSize=%s", (pageSize) => {
    expect(() => parseFavorisQuery(params(`pageSize=${pageSize}`))).toThrow(FavorisQueryError);
  });
});

describe("buildFavorisApiUrl", () => {
  it("cible /api/favoris sans query par défaut", () => {
    expect(buildFavorisApiUrl()).toBe("/api/favoris");
  });

  it("n'ajoute le paramètre page qu'au-delà de la page 1", () => {
    expect(buildFavorisApiUrl({ page: 1 })).toBe("/api/favoris");
    expect(buildFavorisApiUrl({ page: 4 })).toBe("/api/favoris?page=4");
  });

  it("ajoute pageSize quand fourni", () => {
    expect(buildFavorisApiUrl({ pageSize: 50 })).toBe("/api/favoris?pageSize=50");
    expect(buildFavorisApiUrl({ page: 2, pageSize: 50 })).toBe("/api/favoris?page=2&pageSize=50");
  });
});

describe("buildFavoriToggleApiUrl", () => {
  it("cible /api/extraits/:id/favori", () => {
    expect(buildFavoriToggleApiUrl("mock-002")).toBe("/api/extraits/mock-002/favori");
  });

  it("encode l'id de l'extrait", () => {
    expect(buildFavoriToggleApiUrl("a/b c")).toBe("/api/extraits/a%2Fb%20c/favori");
  });
});
