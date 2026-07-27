import { describe, expect, it, vi } from "vitest";
import {
  InvalidScriptLigneError,
  createScriptLignes,
  listScriptLignes,
  parseScriptLignesPayload,
  type ScriptLigneDelegate,
} from "../script";

// Tests unitaires de la logique serveur du endpoint (ST 1.3, Definition of
// Done "Tests unitaires sur la logique de surbrillance ; tests avec script
// vide" — le second point est couvert ici côté lecture ; le premier dans
// scriptClient.test.ts).

function makeLigne(overrides: Partial<{
  id: string;
  extraitId: string;
  texte: string;
  timestampDebut: number;
  timestampFin: number;
}>) {
  const now = new Date();
  return {
    id: "id-1",
    extraitId: "extrait-1",
    texte: "Une réplique",
    timestampDebut: 0,
    timestampFin: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("listScriptLignes", () => {
  it("interroge le delegate avec le bon filtre et le bon tri", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listScriptLignes({ findMany }, "extrait-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { extraitId: "extrait-1" },
      orderBy: { timestampDebut: "asc" },
    });
  });

  it("retourne un tableau vide quand l'extrait n'a aucune ligne (pas une erreur)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const result = await listScriptLignes({ findMany }, "extrait-sans-script");
    expect(result).toEqual([]);
  });

  it("retourne les lignes telles que fournies par le delegate", async () => {
    const lignes = [makeLigne({ id: "a" }), makeLigne({ id: "b" })];
    const findMany = vi.fn().mockResolvedValue(lignes);
    const result = await listScriptLignes({ findMany }, "extrait-1");
    expect(result).toBe(lignes);
  });
});

describe("parseScriptLignesPayload", () => {
  it("rejette un corps sans propriété 'lignes'", () => {
    expect(() => parseScriptLignesPayload({})).toThrow(InvalidScriptLigneError);
  });

  it("rejette un corps où 'lignes' n'est pas un tableau", () => {
    expect(() => parseScriptLignesPayload({ lignes: "pas un tableau" })).toThrow(
      InvalidScriptLigneError
    );
  });

  it("rejette un tableau 'lignes' vide", () => {
    expect(() => parseScriptLignesPayload({ lignes: [] })).toThrow(/vide/i);
  });

  it("rejette une entrée qui n'est pas un objet", () => {
    expect(() => parseScriptLignesPayload({ lignes: ["pas un objet"] })).toThrow(/Ligne 1/);
  });

  it("rejette une ligne invalide avec le numéro de ligne concerné (1-indexé)", () => {
    expect(() =>
      parseScriptLignesPayload({
        lignes: [
          { texte: "Ok", timestampDebut: 0, timestampFin: 1 },
          { texte: "", timestampDebut: 0, timestampFin: 1 },
        ],
      })
    ).toThrow(/Ligne 2/);
  });

  it("importe atomiquement : une seule ligne invalide fait échouer tout le lot", () => {
    expect(() =>
      parseScriptLignesPayload({
        lignes: [
          { texte: "Ok", timestampDebut: 0, timestampFin: 1 },
          { texte: "Fin avant début", timestampDebut: 5, timestampFin: 1 },
        ],
      })
    ).toThrow(InvalidScriptLigneError);
  });

  it("accepte et normalise un lot valide", () => {
    const result = parseScriptLignesPayload({
      lignes: [{ texte: "Bonjour", timestampDebut: 0, timestampFin: 1.5 }],
    });
    expect(result).toEqual([{ texte: "Bonjour", timestampDebut: 0, timestampFin: 1.5 }]);
  });
});

describe("createScriptLignes", () => {
  it("insère les lignes avec l'extraitId injecté sur chacune", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const lignes = [
      { texte: "A", timestampDebut: 0, timestampFin: 1 },
      { texte: "B", timestampDebut: 1, timestampFin: 2 },
    ];

    const count = await createScriptLignes({ createMany }, "extrait-1", lignes);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { texte: "A", timestampDebut: 0, timestampFin: 1, extraitId: "extrait-1" },
        { texte: "B", timestampDebut: 1, timestampFin: 2, extraitId: "extrait-1" },
      ],
    });
    expect(count).toBe(2);
  });
});

// Vérifie que le contrat `ScriptLigneDelegate` (utilisé côté route pour
// basculer entre Prisma et le mock) reste satisfaisable par un objet minimal.
describe("ScriptLigneDelegate", () => {
  it("un delegate minimal implémentant findMany/createMany est utilisable", async () => {
    const delegate: ScriptLigneDelegate = {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    await expect(listScriptLignes(delegate, "x")).resolves.toEqual([]);
    await expect(createScriptLignes(delegate, "x", [])).resolves.toBe(0);
  });
});
