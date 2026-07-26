import { describe, expect, it } from "vitest";
import { buildExtraitsWhere, PAGE_SIZE_DEFAUT } from "@/lib/extraits";
import { MOCK_EXTRAITS, mockExtraitDelegate } from "../extraits.mock";

// Vérifie que le delegate mocké (utilisé quand DATA_SOURCE=mock) se comporte
// comme le client Prisma vis-à-vis de `listExtraits`/`buildExtraitsWhere`
// (mêmes tests que src/lib/__tests__/extraits.test.ts, appliqués ici au jeu
// de données mocké plutôt qu'à des fixtures ad hoc).

describe("MOCK_EXTRAITS (jeu de données ST 1.1 / ST 1.2)", () => {
  it("contient plus d'extraits VALIDE que PAGE_SIZE_DEFAUT (pour tester la pagination)", () => {
    const valides = MOCK_EXTRAITS.filter((e) => e.statut === "VALIDE");
    expect(valides.length).toBeGreaterThan(PAGE_SIZE_DEFAUT);
  });

  it("contient des extraits non VALIDE (EN_ATTENTE, REJETE) à exclure du public", () => {
    expect(MOCK_EXTRAITS.some((e) => e.statut === "EN_ATTENTE")).toBe(true);
    expect(MOCK_EXTRAITS.some((e) => e.statut === "REJETE")).toBe(true);
  });

  it("couvre les 3 origines et les deux sources de lecture (EMBED/UPLOAD)", () => {
    const origines = new Set(MOCK_EXTRAITS.map((e) => e.origine));
    const sources = new Set(MOCK_EXTRAITS.map((e) => e.source));
    expect(origines).toEqual(new Set(["FR", "US", "JP"]));
    expect(sources).toEqual(new Set(["EMBED", "UPLOAD"]));
  });

  it("a des ids uniques", () => {
    const ids = MOCK_EXTRAITS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mockExtraitDelegate.count", () => {
  it("ne compte que les extraits VALIDE quand le statut est forcé (comportement public)", async () => {
    const where = buildExtraitsWhere({});
    const total = await mockExtraitDelegate.count({ where });
    const expected = MOCK_EXTRAITS.filter((e) => e.statut === "VALIDE").length;
    expect(total).toBe(expected);
  });

  it("applique le filtre origine", async () => {
    const where = buildExtraitsWhere({ origine: "JP" });
    const total = await mockExtraitDelegate.count({ where });
    const expected = MOCK_EXTRAITS.filter(
      (e) => e.statut === "VALIDE" && e.origine === "JP"
    ).length;
    expect(total).toBe(expected);
    expect(total).toBeGreaterThan(0);
  });

  it("applique le filtre type", async () => {
    const where = buildExtraitsWhere({ type: "DESSIN_ANIME" });
    const total = await mockExtraitDelegate.count({ where });
    const expected = MOCK_EXTRAITS.filter(
      (e) => e.statut === "VALIDE" && e.type === "DESSIN_ANIME"
    ).length;
    expect(total).toBe(expected);
    expect(total).toBeGreaterThan(0);
  });

  it("applique la recherche texte insensible à la casse sur le titre", async () => {
    const where = buildExtraitsWhere({ q: "odyssée" });
    const total = await mockExtraitDelegate.count({ where });
    expect(total).toBe(1);
  });
});

describe("mockExtraitDelegate.findMany", () => {
  it("trie par date de création décroissante", async () => {
    const where = buildExtraitsWhere({});
    const items = await mockExtraitDelegate.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        items[i].createdAt.getTime()
      );
    }
  });

  it("respecte skip/take pour la pagination", async () => {
    const where = buildExtraitsWhere({});
    const page1 = await mockExtraitDelegate.findMany({ where, skip: 0, take: 20 });
    const page2 = await mockExtraitDelegate.findMany({ where, skip: 20, take: 20 });

    expect(page1.length).toBe(20);
    expect(page2.length).toBeGreaterThan(0);
    const page1Ids = new Set(page1.map((e) => e.id));
    expect(page2.every((e) => !page1Ids.has(e.id))).toBe(true);
  });

  it("n'inclut jamais les extraits non VALIDE (endpoint public)", async () => {
    const where = buildExtraitsWhere({});
    const items = await mockExtraitDelegate.findMany({ where, take: 100 });
    expect(items.every((e) => e.statut === "VALIDE")).toBe(true);
  });
});
