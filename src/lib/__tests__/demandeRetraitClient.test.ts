import { describe, expect, it } from "vitest";
import {
  ActionDemandeRetraitError,
  calculerRapportDelais,
  DELAI_CIBLE_TRAITEMENT_HEURES,
  DemandeRetraitPayloadError,
  FileDemandesRetraitQueryError,
  parseActionDemandeRetraitPayload,
  parseDemandeRetraitPayload,
  parseFileDemandesRetraitQuery,
  type DemandePourRapport,
} from "../demandeRetraitClient";

// ST 7.3 — validation client-safe des corps de requête + calcul (pur) du
// rapport de délais de traitement.

const basePayload = {
  contenuType: "EXTRAIT",
  contenuId: "extrait-1",
  oeuvre: "Le Grand Bleu",
  demandeurNom: "Ada Lovelace",
  demandeurEmail: "ada@example.com",
  motif: "Je détiens les droits sur cet extrait.",
  declarationBonneFoi: true,
};

describe("parseDemandeRetraitPayload", () => {
  it("accepte un corps valide et trime les chaînes", () => {
    const payload = parseDemandeRetraitPayload({
      ...basePayload,
      contenuId: "  extrait-9  ",
      demandeurOrganisation: "  Studios ACME  ",
    });
    expect(payload).toEqual({
      contenuType: "EXTRAIT",
      contenuId: "extrait-9",
      oeuvre: "Le Grand Bleu",
      demandeurNom: "Ada Lovelace",
      demandeurEmail: "ada@example.com",
      demandeurOrganisation: "Studios ACME",
      motif: "Je détiens les droits sur cet extrait.",
      declarationBonneFoi: true,
    });
  });

  it("met l'organisation à null si absente ou vide", () => {
    expect(parseDemandeRetraitPayload(basePayload).demandeurOrganisation).toBeNull();
    expect(
      parseDemandeRetraitPayload({ ...basePayload, demandeurOrganisation: "   " })
        .demandeurOrganisation
    ).toBeNull();
  });

  it("rejette un corps non-objet", () => {
    expect(() => parseDemandeRetraitPayload(null)).toThrow(DemandeRetraitPayloadError);
    expect(() => parseDemandeRetraitPayload("x")).toThrow(DemandeRetraitPayloadError);
  });

  it("rejette un contenuType hors énumération", () => {
    try {
      parseDemandeRetraitPayload({ ...basePayload, contenuType: "COMMENTAIRE" });
      expect.unreachable();
    } catch (err) {
      expect((err as DemandeRetraitPayloadError).field).toBe("contenuType");
    }
  });

  it("rejette les champs obligatoires manquants", () => {
    for (const field of ["contenuId", "oeuvre", "demandeurNom", "demandeurEmail", "motif"] as const) {
      try {
        parseDemandeRetraitPayload({ ...basePayload, [field]: "   " });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(DemandeRetraitPayloadError);
        expect((err as DemandeRetraitPayloadError).field).toBe(field);
      }
    }
  });

  it("rejette un email manifestement invalide", () => {
    try {
      parseDemandeRetraitPayload({ ...basePayload, demandeurEmail: "ada[at]example" });
      expect.unreachable();
    } catch (err) {
      expect((err as DemandeRetraitPayloadError).field).toBe("demandeurEmail");
    }
  });

  it("rejette une déclaration de bonne foi absente ou fausse (obligatoire)", () => {
    for (const declarationBonneFoi of [undefined, false, "true", 1]) {
      try {
        parseDemandeRetraitPayload({ ...basePayload, declarationBonneFoi });
        expect.unreachable();
      } catch (err) {
        expect((err as DemandeRetraitPayloadError).field).toBe("declarationBonneFoi");
      }
    }
  });
});

describe("parseActionDemandeRetraitPayload", () => {
  it("accepte TRAITER / REJETER avec demandeId et trime le commentaire", () => {
    expect(
      parseActionDemandeRetraitPayload({
        action: "TRAITER",
        demandeId: "  d-1  ",
        commentaire: "  fondée  ",
      })
    ).toEqual({ action: "TRAITER", demandeId: "d-1", commentaire: "fondée" });
  });

  it("rejette une action inconnue", () => {
    try {
      parseActionDemandeRetraitPayload({ action: "SUPPRIMER", demandeId: "d-1" });
      expect.unreachable();
    } catch (err) {
      expect((err as ActionDemandeRetraitError).field).toBe("action");
    }
  });

  it("exige demandeId", () => {
    try {
      parseActionDemandeRetraitPayload({ action: "REJETER", demandeId: "" });
      expect.unreachable();
    } catch (err) {
      expect((err as ActionDemandeRetraitError).field).toBe("demandeId");
    }
  });
});

describe("parseFileDemandesRetraitQuery", () => {
  it("applique les défauts (EN_ATTENTE, ANCIENNETE, 1, 20)", () => {
    expect(parseFileDemandesRetraitQuery(new URLSearchParams())).toEqual({
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 1,
      pageSize: 20,
    });
  });

  it("plafonne pageSize à 100 et rejette un statut inconnu", () => {
    expect(
      parseFileDemandesRetraitQuery(new URLSearchParams({ pageSize: "500" })).pageSize
    ).toBe(100);
    expect(() =>
      parseFileDemandesRetraitQuery(new URLSearchParams({ statut: "PERDUE" }))
    ).toThrow(FileDemandesRetraitQueryError);
  });
});

describe("calculerRapportDelais", () => {
  const maintenant = new Date("2026-09-10T00:00:00.000Z");

  function demande(
    over: Partial<DemandePourRapport> & Pick<DemandePourRapport, "statut">
  ): DemandePourRapport {
    return {
      dateCreation: "2026-09-01T00:00:00.000Z",
      dateTraitement: null,
      ...over,
    };
  }

  it("compte les demandes par statut", () => {
    const rapport = calculerRapportDelais(
      [
        demande({ statut: "EN_ATTENTE" }),
        demande({ statut: "TRAITEE", dateTraitement: "2026-09-01T06:00:00.000Z" }),
        demande({ statut: "REJETEE", dateTraitement: "2026-09-01T02:00:00.000Z" }),
      ],
      maintenant
    );
    expect(rapport).toMatchObject({ total: 3, enAttente: 1, traitees: 1, rejetees: 1 });
  });

  it("calcule moyenne, médiane et max sur les demandes closes", () => {
    const rapport = calculerRapportDelais(
      [
        demande({ statut: "TRAITEE", dateTraitement: "2026-09-01T02:00:00.000Z" }), // 2 h
        demande({ statut: "TRAITEE", dateTraitement: "2026-09-01T04:00:00.000Z" }), // 4 h
        demande({ statut: "REJETEE", dateTraitement: "2026-09-01T12:00:00.000Z" }), // 12 h
      ],
      maintenant
    );
    expect(rapport.delaiMoyenHeures).toBe(6);
    expect(rapport.delaiMedianHeures).toBe(4);
    expect(rapport.delaiMaxHeures).toBe(12);
  });

  it("sépare les demandes closes dans / hors délai cible", () => {
    const horsCible = DELAI_CIBLE_TRAITEMENT_HEURES + 10;
    const rapport = calculerRapportDelais(
      [
        demande({ statut: "TRAITEE", dateTraitement: "2026-09-01T01:00:00.000Z" }),
        demande({
          statut: "TRAITEE",
          dateCreation: "2026-09-01T00:00:00.000Z",
          dateTraitement: new Date(
            Date.parse("2026-09-01T00:00:00.000Z") + horsCible * 3_600_000
          ).toISOString(),
        }),
      ],
      maintenant
    );
    expect(rapport.closesDansDelaiCible).toBe(1);
    expect(rapport.closesHorsDelaiCible).toBe(1);
  });

  it("compte les demandes en attente au-delà de la cible", () => {
    const rapport = calculerRapportDelais(
      [demande({ statut: "EN_ATTENTE", dateCreation: "2026-08-01T00:00:00.000Z" })],
      maintenant
    );
    expect(rapport.enAttenteHorsDelaiCible).toBe(1);
  });

  it("borne à 0 un délai négatif (horloge incohérente)", () => {
    const rapport = calculerRapportDelais(
      [
        demande({
          statut: "TRAITEE",
          dateCreation: "2026-09-02T00:00:00.000Z",
          dateTraitement: "2026-09-01T00:00:00.000Z",
        }),
      ],
      maintenant
    );
    expect(rapport.delaiMaxHeures).toBe(0);
  });

  it("renvoie null pour les délais quand aucune demande close", () => {
    const rapport = calculerRapportDelais([demande({ statut: "EN_ATTENTE" })], maintenant);
    expect(rapport.delaiMoyenHeures).toBeNull();
    expect(rapport.delaiMedianHeures).toBeNull();
    expect(rapport.delaiMaxHeures).toBeNull();
  });
});
