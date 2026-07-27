import { describe, expect, it } from "vitest";
import { resolveActiveLineIndex, validateScriptLigneInput } from "../scriptClient";

// Tests unitaires de la logique de surbrillance (ST 1.3, Definition of Done
// "Tests unitaires sur la logique de surbrillance ; tests avec script vide").

describe("resolveActiveLineIndex", () => {
  const lignes = [
    { timestampDebut: 0, timestampFin: 3.2 },
    { timestampDebut: 3.2, timestampFin: 5.4 },
    // Silence volontaire entre 5.4 et 5.9.
    { timestampDebut: 5.9, timestampFin: 8.9 },
  ];

  it("retourne -1 pour un tableau de lignes vide (script sans aucune ligne)", () => {
    expect(resolveActiveLineIndex([], 2)).toBe(-1);
  });

  it("retourne l'index de la ligne dont l'intervalle couvre `time`", () => {
    expect(resolveActiveLineIndex(lignes, 0)).toBe(0);
    expect(resolveActiveLineIndex(lignes, 1.5)).toBe(0);
    expect(resolveActiveLineIndex(lignes, 4)).toBe(1);
    expect(resolveActiveLineIndex(lignes, 7)).toBe(2);
  });

  it("la borne de début est incluse", () => {
    expect(resolveActiveLineIndex(lignes, 3.2)).toBe(1);
  });

  it("la borne de fin est exclue (pas de chevauchement à la transition)", () => {
    // À l'instant exact 3.2, seule la ligne 1 (qui commence à 3.2) est active,
    // pas la ligne 0 (qui finit à 3.2).
    expect(resolveActiveLineIndex(lignes, 3.2)).not.toBe(0);
  });

  it("retourne -1 avant la première réplique", () => {
    expect(resolveActiveLineIndex(lignes, -1)).toBe(-1);
  });

  it("retourne -1 pendant un silence entre deux répliques", () => {
    expect(resolveActiveLineIndex(lignes, 5.6)).toBe(-1);
  });

  it("retourne -1 après la dernière réplique", () => {
    expect(resolveActiveLineIndex(lignes, 100)).toBe(-1);
  });

  it("ne re-trie pas les lignes : suppose un tableau déjà trié par timestampDebut", () => {
    const desordre = [
      { timestampDebut: 5, timestampFin: 8 },
      { timestampDebut: 0, timestampFin: 3 },
    ];
    // Le premier élément dont l'intervalle couvre `time` est retourné, dans
    // l'ordre du tableau fourni — pas de tri implicite.
    expect(resolveActiveLineIndex(desordre, 6)).toBe(0);
  });
});

describe("validateScriptLigneInput", () => {
  it("rejette un texte vide", () => {
    expect(validateScriptLigneInput({ texte: "", timestampDebut: 0, timestampFin: 1 })).toMatch(
      /texte.*requis/i
    );
  });

  it("rejette un texte composé uniquement d'espaces", () => {
    expect(validateScriptLigneInput({ texte: "   ", timestampDebut: 0, timestampFin: 1 })).toMatch(
      /texte.*requis/i
    );
  });

  it("rejette un timestamp de début négatif", () => {
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: -1, timestampFin: 1 })
    ).toMatch(/début/i);
  });

  it("rejette un timestamp de début non fini (NaN/Infinity)", () => {
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: NaN, timestampFin: 1 })
    ).toMatch(/début/i);
  });

  it("rejette un timestamp de fin négatif", () => {
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: 0, timestampFin: -1 })
    ).toMatch(/fin/i);
  });

  it("rejette une fin antérieure ou égale au début", () => {
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: 3, timestampFin: 3 })
    ).toMatch(/strictement supérieur/i);
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: 3, timestampFin: 2 })
    ).toMatch(/strictement supérieur/i);
  });

  it("accepte une ligne valide", () => {
    expect(
      validateScriptLigneInput({ texte: "Bonjour", timestampDebut: 0, timestampFin: 1 })
    ).toBeNull();
  });
});
