import { describe, expect, it } from "vitest";
import {
  ActionModerationError,
  COMMENTAIRE_MODERATION_MAX_LENGTH,
  FileModerationQueryError,
  parseActionModerationPayload,
  parseFileModerationQuery,
} from "../moderationClient";

// ST 7.2 — validation client-safe des entrées du dashboard (query de la file,
// corps d'une action). Fonctions pures, testées sans runtime Next.

describe("parseFileModerationQuery", () => {
  const q = (s: string) => parseFileModerationQuery(new URLSearchParams(s));

  it("applique les défauts (EN_ATTENTE, ANCIENNETE, page 1, pageSize 20)", () => {
    expect(q("")).toEqual({ statut: "EN_ATTENTE", tri: "ANCIENNETE", page: 1, pageSize: 20 });
  });

  it("lit statut / tri / page / pageSize valides", () => {
    expect(q("statut=REJETE&tri=RECENCE&page=3&pageSize=50")).toEqual({
      statut: "REJETE",
      tri: "RECENCE",
      page: 3,
      pageSize: 50,
    });
  });

  it("plafonne pageSize à 100", () => {
    expect(q("pageSize=999").pageSize).toBe(100);
  });

  it("rejette un statut, un tri ou une page invalides", () => {
    expect(() => q("statut=BROUILLON")).toThrow(FileModerationQueryError);
    expect(() => q("tri=ALPHA")).toThrow(FileModerationQueryError);
    expect(() => q("page=0")).toThrow(FileModerationQueryError);
    expect(() => q("page=-2")).toThrow(FileModerationQueryError);
    expect(() => q("pageSize=abc")).toThrow(FileModerationQueryError);
  });
});

describe("parseActionModerationPayload", () => {
  it("REJETER exige signalementId", () => {
    expect(parseActionModerationPayload({ action: "REJETER", signalementId: " s1 " })).toEqual({
      action: "REJETER",
      signalementId: "s1",
      compteCibleId: undefined,
      commentaire: undefined,
    });
    expect(() => parseActionModerationPayload({ action: "REJETER" })).toThrow(
      ActionModerationError
    );
  });

  it("RETIRER_CONTENU exige signalementId et accepte un commentaire trimé", () => {
    expect(
      parseActionModerationPayload({
        action: "RETIRER_CONTENU",
        signalementId: "s2",
        commentaire: "  droits d'auteur manifestes  ",
      })
    ).toMatchObject({ action: "RETIRER_CONTENU", signalementId: "s2", commentaire: "droits d'auteur manifestes" });
  });

  it("SUSPENDRE_COMPTE exige compteCibleId, signalementId optionnel", () => {
    expect(
      parseActionModerationPayload({ action: "SUSPENDRE_COMPTE", compteCibleId: "u9" })
    ).toMatchObject({ action: "SUSPENDRE_COMPTE", compteCibleId: "u9", signalementId: undefined });
    expect(() =>
      parseActionModerationPayload({ action: "SUSPENDRE_COMPTE" })
    ).toThrow(ActionModerationError);
  });

  it("rejette une action inconnue ou un corps non-objet", () => {
    expect(() => parseActionModerationPayload({ action: "BANNIR" })).toThrow(
      ActionModerationError
    );
    expect(() => parseActionModerationPayload(null)).toThrow(ActionModerationError);
  });

  it("rejette un commentaire trop long", () => {
    const trop = "x".repeat(COMMENTAIRE_MODERATION_MAX_LENGTH + 1);
    expect(() =>
      parseActionModerationPayload({ action: "REJETER", signalementId: "s1", commentaire: trop })
    ).toThrow(/2000/);
  });

  it("ignore un commentaire vide (undefined plutôt que chaîne vide)", () => {
    const p = parseActionModerationPayload({
      action: "REJETER",
      signalementId: "s1",
      commentaire: "   ",
    });
    expect(p.commentaire).toBeUndefined();
  });
});
