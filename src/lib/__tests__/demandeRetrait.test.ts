import { beforeEach, describe, expect, it } from "vitest";
import {
  appliquerActionDemandeRetrait,
  ContenuDemandeIntrouvableError,
  creerDemandeRetrait,
  DemandeRetraitDejaTraiteeError,
  DemandeRetraitIntrouvableError,
  genererRapportDelais,
  listerDemandesRetrait,
  rejeterDemandeRetrait,
  traiterDemandeRetrait,
  type DemandeRetraitStore,
} from "../demandeRetrait";
import { createInMemoryDemandeRetraitStore } from "../demandeRetrait";
import {
  createInMemoryDecisionModerationStore,
  type ContenuModerationGateway,
  type DecisionModerationStore,
  type StatutRetraitContenu,
} from "../moderation";

// ST 7.3, Definition of Done technique : « Tests unitaires sur le changement de
// statut dédié ».

let demandes: DemandeRetraitStore;
let decisions: DecisionModerationStore;
let gateway: ContenuModerationGateway & {
  retraits: Array<{ type: "EXTRAIT" | "DOUBLAGE"; id: string; statut: StatutRetraitContenu }>;
  extraitExiste: boolean;
};

let horloge = 0;
function now() {
  return new Date(2026, 8, 4, 10, 0, horloge++);
}

beforeEach(() => {
  horloge = 0;
  demandes = createInMemoryDemandeRetraitStore(now);
  decisions = createInMemoryDecisionModerationStore(now);
  gateway = {
    retraits: [],
    extraitExiste: true,
    async retirerExtrait(id, statut = "RETRAIT_MODERATION") {
      if (!this.extraitExiste) return false;
      this.retraits.push({ type: "EXTRAIT", id, statut });
      return true;
    },
    async retirerDoublage(id, statut = "RETRAIT_MODERATION") {
      this.retraits.push({ type: "DOUBLAGE", id, statut });
      return true;
    },
    async suspendreCompte() {
      return true;
    },
  };
});

const payload = {
  contenuType: "EXTRAIT" as const,
  contenuId: "extrait-1",
  oeuvre: "Le Grand Bleu",
  demandeurNom: "Ada Lovelace",
  demandeurEmail: "ada@example.com",
  motif: "Titulaire des droits.",
  declarationBonneFoi: true as const,
};

describe("creerDemandeRetrait", () => {
  it("enregistre une demande EN_ATTENTE après validation", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    expect(demande).toMatchObject({
      contenuType: "EXTRAIT",
      contenuId: "extrait-1",
      statut: "EN_ATTENTE",
      dateTraitement: null,
    });
    expect(await demandes.count()).toBe(1);
  });

  it("propage l'erreur de validation (déclaration manquante)", async () => {
    await expect(
      creerDemandeRetrait(demandes, { ...payload, declarationBonneFoi: false })
    ).rejects.toThrow(/bonne foi/);
    expect(await demandes.count()).toBe(0);
  });
});

describe("traiterDemandeRetrait", () => {
  it("retire le contenu avec le statut RETRAIT_AYANT_DROIT (statut dédié)", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    const res = await traiterDemandeRetrait({ demandes, decisions }, gateway, {
      demandeId: demande.id,
      moderateurId: "mod-1",
      commentaire: "réclamation fondée",
      now,
    });

    expect(gateway.retraits).toEqual([
      { type: "EXTRAIT", id: "extrait-1", statut: "RETRAIT_AYANT_DROIT" },
    ]);
    expect(res.demande.statut).toBe("TRAITEE");
    expect(res.demande.dateTraitement).not.toBeNull();
    expect(res.demande.delaiTraitementHeures).toBeGreaterThanOrEqual(0);
  });

  it("journalise une décision RETRAIT_AYANT_DROIT rattachée à la demande", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    const res = await traiterDemandeRetrait({ demandes, decisions }, gateway, {
      demandeId: demande.id,
      moderateurId: "mod-1",
      now,
    });

    expect(res.decision).toMatchObject({
      action: "RETRAIT_AYANT_DROIT",
      moderateurId: "mod-1",
      contenuType: "EXTRAIT",
      contenuId: "extrait-1",
      demandeRetraitId: demande.id,
    });
    const journal = await decisions.page({ skip: 0, take: 10 });
    expect(journal.total).toBe(1);
  });

  it("route un DOUBLAGE vers retirerDoublage", async () => {
    const demande = await creerDemandeRetrait(demandes, {
      ...payload,
      contenuType: "DOUBLAGE",
      contenuId: "job-7",
    });
    await traiterDemandeRetrait({ demandes, decisions }, gateway, {
      demandeId: demande.id,
      moderateurId: "m",
      now,
    });
    expect(gateway.retraits).toEqual([
      { type: "DOUBLAGE", id: "job-7", statut: "RETRAIT_AYANT_DROIT" },
    ]);
  });

  it("si le contenu est introuvable : erreur, demande EN_ATTENTE, rien journalisé", async () => {
    gateway.extraitExiste = false;
    const demande = await creerDemandeRetrait(demandes, payload);
    await expect(
      traiterDemandeRetrait({ demandes, decisions }, gateway, {
        demandeId: demande.id,
        moderateurId: "m",
        now,
      })
    ).rejects.toBeInstanceOf(ContenuDemandeIntrouvableError);
    expect((await demandes.get(demande.id))?.statut).toBe("EN_ATTENTE");
    expect(await decisions.page({ skip: 0, take: 10 })).toMatchObject({ total: 0 });
  });

  it("refuse de re-traiter une demande déjà close (409)", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    await traiterDemandeRetrait({ demandes, decisions }, gateway, {
      demandeId: demande.id,
      moderateurId: "m",
      now,
    });
    await expect(
      traiterDemandeRetrait({ demandes, decisions }, gateway, {
        demandeId: demande.id,
        moderateurId: "m",
        now,
      })
    ).rejects.toBeInstanceOf(DemandeRetraitDejaTraiteeError);
  });

  it("lève DemandeRetraitIntrouvableError sur un id inconnu", async () => {
    await expect(
      traiterDemandeRetrait({ demandes, decisions }, gateway, {
        demandeId: "nope",
        moderateurId: "m",
        now,
      })
    ).rejects.toBeInstanceOf(DemandeRetraitIntrouvableError);
  });
});

describe("rejeterDemandeRetrait", () => {
  it("clôt en REJETEE sans toucher au contenu ni au journal", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    const res = await rejeterDemandeRetrait(demandes, {
      demandeId: demande.id,
      moderateurId: "mod-1",
      commentaire: "contenu déjà supprimé",
      now,
    });
    expect(res.demande.statut).toBe("REJETEE");
    expect(res.demande.commentaireTraitement).toBe("contenu déjà supprimé");
    expect(res.decision).toBeNull();
    expect(gateway.retraits).toEqual([]);
    expect(await decisions.page({ skip: 0, take: 10 })).toMatchObject({ total: 0 });
  });
});

describe("appliquerActionDemandeRetrait", () => {
  it("aiguille TRAITER vers le retrait", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    const res = await appliquerActionDemandeRetrait({ demandes, decisions }, gateway, {
      action: "TRAITER",
      demandeId: demande.id,
      moderateurId: "m",
      now,
    });
    expect(res.demande.statut).toBe("TRAITEE");
    expect(res.decision).not.toBeNull();
  });

  it("aiguille REJETER sans décision", async () => {
    const demande = await creerDemandeRetrait(demandes, payload);
    const res = await appliquerActionDemandeRetrait({ demandes, decisions }, gateway, {
      action: "REJETER",
      demandeId: demande.id,
      moderateurId: "m",
      now,
    });
    expect(res.demande.statut).toBe("REJETEE");
    expect(res.decision).toBeNull();
  });
});

describe("listerDemandesRetrait", () => {
  it("filtre par statut, trie par ancienneté et pagine", async () => {
    const d1 = await creerDemandeRetrait(demandes, { ...payload, contenuId: "a" });
    await creerDemandeRetrait(demandes, { ...payload, contenuId: "b" });
    const d3 = await creerDemandeRetrait(demandes, { ...payload, contenuId: "c" });
    await rejeterDemandeRetrait(demandes, { demandeId: d3.id, moderateurId: "m", now });

    const file = await listerDemandesRetrait(demandes, {
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 1,
      pageSize: 1,
    });
    expect(file.items.map((i) => i.id)).toEqual([d1.id]);
    expect(file.pagination).toMatchObject({ total: 2, totalPages: 2, page: 1 });
  });

  it("borne une page hors limite à la dernière page valide", async () => {
    await creerDemandeRetrait(demandes, { ...payload, contenuId: "a" });
    const file = await listerDemandesRetrait(demandes, {
      statut: "EN_ATTENTE",
      tri: "RECENCE",
      page: 99,
      pageSize: 20,
    });
    expect(file.pagination.page).toBe(1);
  });
});

describe("genererRapportDelais", () => {
  it("agrège les demandes du store", async () => {
    const d1 = await creerDemandeRetrait(demandes, { ...payload, contenuId: "a" });
    await creerDemandeRetrait(demandes, { ...payload, contenuId: "b" });
    await traiterDemandeRetrait({ demandes, decisions }, gateway, {
      demandeId: d1.id,
      moderateurId: "m",
      now,
    });

    const rapport = await genererRapportDelais(demandes, now());
    expect(rapport).toMatchObject({ total: 2, enAttente: 1, traitees: 1 });
    expect(rapport.delaiMoyenHeures).not.toBeNull();
  });
});
