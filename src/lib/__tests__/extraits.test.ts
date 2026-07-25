import { describe, expect, it, vi } from "vitest";
import {
  InvalidQueryParamError,
  PAGE_SIZE_DEFAUT,
  PAGE_SIZE_MAX,
  buildExtraitsWhere,
  listExtraits,
  parseExtraitsQueryParams,
} from "../extraits";
import type { Extrait } from "@prisma/client";

// Tests unitaires du endpoint GET /api/extraits (ST 1.1, Definition of Done
// "Tests unitaires sur le endpoint (filtres, pagination)").

describe("parseExtraitsQueryParams", () => {
  it("applique les valeurs par défaut en l'absence de paramètres", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams());
    expect(result).toEqual({
      origine: undefined,
      type: undefined,
      q: undefined,
      page: 1,
      pageSize: PAGE_SIZE_DEFAUT,
    });
  });

  it("accepte et normalise une origine valide en majuscules", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams("origine=fr"));
    expect(result.origine).toBe("FR");
  });

  it("rejette une origine invalide", () => {
    expect(() =>
      parseExtraitsQueryParams(new URLSearchParams("origine=DE"))
    ).toThrow(InvalidQueryParamError);
  });

  it("accepte et normalise un type valide", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams("type=film"));
    expect(result.type).toBe("FILM");
  });

  it("rejette un type invalide", () => {
    expect(() =>
      parseExtraitsQueryParams(new URLSearchParams("type=documentaire"))
    ).toThrow(InvalidQueryParamError);
  });

  it("supprime les espaces superflus du paramètre de recherche", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams("q=  naruto  "));
    expect(result.q).toBe("naruto");
  });

  it("traite une recherche vide/espaces comme absente", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams("q=   "));
    expect(result.q).toBeUndefined();
  });

  it("rejette une page non entière ou < 1", () => {
    expect(() => parseExtraitsQueryParams(new URLSearchParams("page=0"))).toThrow(
      InvalidQueryParamError
    );
    expect(() => parseExtraitsQueryParams(new URLSearchParams("page=abc"))).toThrow(
      InvalidQueryParamError
    );
    expect(() => parseExtraitsQueryParams(new URLSearchParams("page=1.5"))).toThrow(
      InvalidQueryParamError
    );
  });

  it("accepte une page valide", () => {
    const result = parseExtraitsQueryParams(new URLSearchParams("page=3"));
    expect(result.page).toBe(3);
  });

  it("plafonne pageSize à PAGE_SIZE_MAX plutôt que de rejeter", () => {
    const result = parseExtraitsQueryParams(
      new URLSearchParams(`pageSize=${PAGE_SIZE_MAX + 100}`)
    );
    expect(result.pageSize).toBe(PAGE_SIZE_MAX);
  });

  it("rejette un pageSize non entier ou < 1", () => {
    expect(() =>
      parseExtraitsQueryParams(new URLSearchParams("pageSize=0"))
    ).toThrow(InvalidQueryParamError);
    expect(() =>
      parseExtraitsQueryParams(new URLSearchParams("pageSize=-5"))
    ).toThrow(InvalidQueryParamError);
  });
});

describe("buildExtraitsWhere", () => {
  it("force toujours le statut VALIDE, même sans filtre", () => {
    const where = buildExtraitsWhere({});
    expect(where.statut).toBe("VALIDE");
  });

  it("ignore toute tentative de filtrage sur le statut par le client (non exposé)", () => {
    // Le type ExtraitsQueryParams n'expose pas de champ "statut" : ce test
    // documente explicitement l'exigence de sécurité de ST 1.1.
    const where = buildExtraitsWhere({ origine: "FR" });
    expect(where.statut).toBe("VALIDE");
    expect(where.origine).toBe("FR");
  });

  it("ajoute le filtre origine si fourni", () => {
    const where = buildExtraitsWhere({ origine: "JP" });
    expect(where.origine).toBe("JP");
  });

  it("ajoute le filtre type si fourni", () => {
    const where = buildExtraitsWhere({ type: "SERIE" });
    expect(where.type).toBe("SERIE");
  });

  it("ajoute une recherche texte insensible à la casse sur le titre", () => {
    const where = buildExtraitsWhere({ q: "Naruto" });
    expect(where.titre).toEqual({ contains: "Naruto", mode: "insensitive" });
  });

  it("n'ajoute pas de filtre titre si q est absent", () => {
    const where = buildExtraitsWhere({});
    expect(where.titre).toBeUndefined();
  });
});

describe("listExtraits", () => {
  const fakeExtrait = (overrides: Partial<Extrait> = {}): Extrait =>
    ({
      id: "extrait-1",
      titre: "Un extrait",
      origine: "FR",
      type: "FILM",
      source: "EMBED",
      urlSource: "https://example.com/embed/1",
      thumbnail: null,
      statut: "VALIDE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as Extrait;

  it("retourne les items et la pagination calculée", async () => {
    const items = [fakeExtrait({ id: "a" }), fakeExtrait({ id: "b" })];
    const findMany = vi.fn().mockResolvedValue(items);
    const count = vi.fn().mockResolvedValue(42);

    const result = await listExtraits(
      { findMany, count },
      { page: 2, pageSize: 20 }
    );

    expect(result.items).toBe(items);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 20,
      total: 42,
      totalPages: 3, // ceil(42 / 20)
    });
  });

  it("calcule skip/take correctement pour la pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    await listExtraits({ findMany, count }, { page: 3, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it("trie par date de création décroissante", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    await listExtraits({ findMany, count }, { page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });

  it("retourne totalPages = 1 minimum même si total = 0", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    const result = await listExtraits({ findMany, count }, { page: 1, pageSize: 20 });

    expect(result.pagination.totalPages).toBe(1);
  });

  it("propage les filtres (origine/type/q) dans le where transmis à Prisma", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    await listExtraits(
      { findMany, count },
      { origine: "JP", type: "DESSIN_ANIME", q: "spirited", page: 1, pageSize: 20 }
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          statut: "VALIDE",
          origine: "JP",
          type: "DESSIN_ANIME",
          titre: { contains: "spirited", mode: "insensitive" },
        },
      })
    );
  });
});
