import { describe, expect, it } from "vitest";
import {
  composeMotif,
  MOTIFS_SIGNALEMENT,
  parseSignalementPayload,
  SIGNALEMENT_MOTIF_MAX_LENGTH,
  SignalementPayloadError,
} from "../signalementClient";

// ST 7.1 — validation client-safe du corps de `POST /api/signalements`
// (« motif obligatoire ») et composition du texte de motif.

describe("parseSignalementPayload", () => {
  const base = { contenuType: "EXTRAIT", contenuId: "mock-001", motif: "Spam" };

  it("accepte un corps valide et trime les chaînes", () => {
    const payload = parseSignalementPayload({
      contenuType: "DOUBLAGE",
      contenuId: "  job-9  ",
      motif: "  Contenu choquant  ",
    });
    expect(payload).toEqual({
      contenuType: "DOUBLAGE",
      contenuId: "job-9",
      motif: "Contenu choquant",
    });
  });

  it("rejette un corps non-objet", () => {
    expect(() => parseSignalementPayload(null)).toThrow(SignalementPayloadError);
    expect(() => parseSignalementPayload("x")).toThrow(SignalementPayloadError);
  });

  it("rejette un contenuType hors énumération", () => {
    try {
      parseSignalementPayload({ ...base, contenuType: "COMMENTAIRE" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SignalementPayloadError);
      expect((err as SignalementPayloadError).field).toBe("contenuType");
    }
  });

  it("rejette un contenuId vide", () => {
    try {
      parseSignalementPayload({ ...base, contenuId: "   " });
      expect.unreachable();
    } catch (err) {
      expect((err as SignalementPayloadError).field).toBe("contenuId");
    }
  });

  it("rejette un motif manquant ou vide (motif obligatoire)", () => {
    for (const motif of [undefined, "", "   ", 42]) {
      try {
        parseSignalementPayload({ ...base, motif });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(SignalementPayloadError);
        expect((err as SignalementPayloadError).field).toBe("motif");
      }
    }
  });

  it("rejette un motif au-delà de la longueur maximale", () => {
    const motif = "a".repeat(SIGNALEMENT_MOTIF_MAX_LENGTH + 1);
    expect(() => parseSignalementPayload({ ...base, motif })).toThrow(
      /caractères/
    );
  });

  it("accepte un motif pile à la longueur maximale", () => {
    const motif = "a".repeat(SIGNALEMENT_MOTIF_MAX_LENGTH);
    expect(parseSignalementPayload({ ...base, motif }).motif).toHaveLength(
      SIGNALEMENT_MOTIF_MAX_LENGTH
    );
  });
});

describe("composeMotif", () => {
  it("combine le libellé de la catégorie et les précisions", () => {
    expect(composeMotif("droits_auteur", "  scène complète du film  ")).toBe(
      "Atteinte aux droits d'auteur — scène complète du film"
    );
  });

  it("se limite au libellé si aucune précision", () => {
    expect(composeMotif("spam")).toBe("Spam ou contenu trompeur");
  });

  it("retombe sur les précisions seules si la catégorie est inconnue", () => {
    expect(composeMotif("", "propos haineux")).toBe("propos haineux");
  });

  it("renvoie une chaîne vide si ni catégorie connue ni précision", () => {
    expect(composeMotif("")).toBe("");
    expect(composeMotif("inconnu", "   ")).toBe("");
  });

  it("chaque option du catalogue est composable", () => {
    for (const option of MOTIFS_SIGNALEMENT) {
      expect(composeMotif(option.id)).toBe(option.label);
    }
  });
});
