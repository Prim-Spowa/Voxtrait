import { beforeEach, describe, expect, it } from "vitest";
import {
  chargerJournalModeration,
  CompteModereIntrouvableError,
  ContenuModereIntrouvableError,
  createInMemoryDecisionModerationStore,
  listerFileModeration,
  rejeterSignalement,
  retirerContenuSignale,
  SignalementDejaTraiteError,
  SignalementIntrouvableError,
  suspendreCompte,
  type ContenuModerationGateway,
  type DecisionModerationStore,
} from "../moderation";
import {
  createInMemorySignalementStore,
  type SignalementStore,
} from "../signalement";

// ST 7.2, Definition of Done technique : « Tests unitaires sur les actions de
// modération et le contrôle de rôle » (le contrôle de rôle est couvert par
// authz.test.ts).

let signalements: SignalementStore;
let decisions: DecisionModerationStore;
let gateway: ContenuModerationGateway & {
  extraitsRetires: string[];
  doublagesRetires: string[];
  comptesSuspendus: string[];
  extraitExiste: boolean;
  compteExiste: boolean;
};

let horloge = 0;
function now() {
  return new Date(2026, 8, 4, 10, 0, horloge++);
}

beforeEach(() => {
  horloge = 0;
  signalements = createInMemorySignalementStore(now);
  decisions = createInMemoryDecisionModerationStore(now);
  gateway = {
    extraitsRetires: [],
    doublagesRetires: [],
    comptesSuspendus: [],
    extraitExiste: true,
    compteExiste: true,
    async retirerExtrait(id) {
      if (!this.extraitExiste) return false;
      this.extraitsRetires.push(id);
      return true;
    },
    async retirerDoublage(id) {
      this.doublagesRetires.push(id);
      return true;
    },
    async suspendreCompte(id) {
      if (!this.compteExiste) return false;
      this.comptesSuspendus.push(id);
      return true;
    },
  };
});

async function seed(
  overrides: Partial<{ contenuType: "EXTRAIT" | "DOUBLAGE"; contenuId: string; auteurId: string | null; motif: string }> = {}
) {
  return signalements.create({
    contenuType: overrides.contenuType ?? "EXTRAIT",
    contenuId: overrides.contenuId ?? "extrait-1",
    motif: overrides.motif ?? "Contenu choquant",
    auteurId: overrides.auteurId ?? null,
  });
}

describe("listerFileModeration", () => {
  it("ne renvoie que les signalements du statut demandé, les plus anciens d'abord", async () => {
    const s1 = await seed({ contenuId: "a" });
    const s2 = await seed({ contenuId: "b" });
    await signalements.setStatut(s2.id, "REJETE");

    const file = await listerFileModeration(signalements, {
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 1,
      pageSize: 20,
    });

    expect(file.items.map((i) => i.id)).toEqual([s1.id]);
    expect(file.pagination.total).toBe(1);
  });

  it("expose le motif et l'auteur (contrairement à la vue publique de ST 7.1)", async () => {
    await seed({ auteurId: "user-3", motif: "Propos haineux" });
    const file = await listerFileModeration(signalements, {
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 1,
      pageSize: 20,
    });
    expect(file.items[0]).toMatchObject({ motif: "Propos haineux", auteurId: "user-3" });
  });

  it("regroupe : nombreSignalementsContenu compte tous les signalements du même contenu", async () => {
    await seed({ contenuId: "viral" });
    await seed({ contenuId: "viral" });
    await seed({ contenuId: "autre" });

    const file = await listerFileModeration(signalements, {
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 1,
      pageSize: 20,
    });
    const viral = file.items.filter((i) => i.contenuId === "viral");
    expect(viral).toHaveLength(2);
    expect(viral.every((i) => i.nombreSignalementsContenu === 2)).toBe(true);
  });

  it("tri RECENCE inverse l'ordre", async () => {
    const s1 = await seed({ contenuId: "a" });
    const s2 = await seed({ contenuId: "b" });
    const file = await listerFileModeration(signalements, {
      statut: "EN_ATTENTE",
      tri: "RECENCE",
      page: 1,
      pageSize: 20,
    });
    expect(file.items.map((i) => i.id)).toEqual([s2.id, s1.id]);
  });

  it("borne une page hors limite à la dernière page valide", async () => {
    await seed({ contenuId: "a" });
    await seed({ contenuId: "b" });
    await seed({ contenuId: "c" });
    const file = await listerFileModeration(signalements, {
      statut: "EN_ATTENTE",
      tri: "ANCIENNETE",
      page: 9,
      pageSize: 2,
    });
    // 3 signalements, pageSize 2 → 2 pages ; page 9 est ramenée à la page 2.
    expect(file.pagination).toMatchObject({ page: 2, totalPages: 2, total: 3 });
    expect(file.items).toHaveLength(1);
  });
});

describe("rejeterSignalement", () => {
  it("passe le signalement à REJETE et journalise, sans toucher au contenu", async () => {
    const s = await seed();
    const res = await rejeterSignalement(
      { signalements, decisions },
      { signalementId: s.id, moderateurId: "mod-1", commentaire: "infondé" }
    );

    expect(res.signalement?.statut).toBe("REJETE");
    expect(res.decision).toMatchObject({
      action: "REJET_SIGNALEMENT",
      moderateurId: "mod-1",
      signalementId: s.id,
      commentaire: "infondé",
    });
    expect(gateway.extraitsRetires).toEqual([]);
    expect((await signalements.get(s.id))?.statut).toBe("REJETE");
  });

  it("refuse de re-traiter un signalement déjà traité (409)", async () => {
    const s = await seed();
    await signalements.setStatut(s.id, "RETENU");
    await expect(
      rejeterSignalement({ signalements, decisions }, { signalementId: s.id, moderateurId: "m" })
    ).rejects.toBeInstanceOf(SignalementDejaTraiteError);
  });

  it("lève SignalementIntrouvableError sur un id inconnu", async () => {
    await expect(
      rejeterSignalement({ signalements, decisions }, { signalementId: "nope", moderateurId: "m" })
    ).rejects.toBeInstanceOf(SignalementIntrouvableError);
  });
});

describe("retirerContenuSignale", () => {
  it("retire un EXTRAIT, passe le signalement à RETENU et journalise", async () => {
    const s = await seed({ contenuType: "EXTRAIT", contenuId: "extrait-42" });
    const res = await retirerContenuSignale(
      { signalements, decisions },
      gateway,
      { signalementId: s.id, moderateurId: "mod-1" }
    );

    expect(gateway.extraitsRetires).toEqual(["extrait-42"]);
    expect(res.signalement?.statut).toBe("RETENU");
    expect(res.decision.action).toBe("RETRAIT_CONTENU");
  });

  it("route un DOUBLAGE vers retirerDoublage", async () => {
    const s = await seed({ contenuType: "DOUBLAGE", contenuId: "job-7" });
    await retirerContenuSignale({ signalements, decisions }, gateway, {
      signalementId: s.id,
      moderateurId: "m",
    });
    expect(gateway.doublagesRetires).toEqual(["job-7"]);
    expect(gateway.extraitsRetires).toEqual([]);
  });

  it("si le contenu est introuvable : 404 et le signalement reste EN_ATTENTE", async () => {
    gateway.extraitExiste = false;
    const s = await seed();
    await expect(
      retirerContenuSignale({ signalements, decisions }, gateway, {
        signalementId: s.id,
        moderateurId: "m",
      })
    ).rejects.toBeInstanceOf(ContenuModereIntrouvableError);
    expect((await signalements.get(s.id))?.statut).toBe("EN_ATTENTE");
    expect(await decisions.page({ skip: 0, take: 10 })).toMatchObject({ total: 0 });
  });
});

describe("suspendreCompte", () => {
  it("suspend le compte et journalise, sans signalement rattaché", async () => {
    const res = await suspendreCompte({ signalements, decisions }, gateway, {
      compteCibleId: "user-9",
      moderateurId: "mod-1",
    });
    expect(gateway.comptesSuspendus).toEqual(["user-9"]);
    expect(res.decision).toMatchObject({ action: "SUSPENSION_COMPTE", compteCibleId: "user-9" });
    expect(res.signalement).toBeNull();
  });

  it("passe aussi le signalement rattaché à RETENU s'il est EN_ATTENTE", async () => {
    const s = await seed({ auteurId: "user-9" });
    const res = await suspendreCompte({ signalements, decisions }, gateway, {
      compteCibleId: "user-9",
      signalementId: s.id,
      moderateurId: "m",
    });
    expect(res.signalement?.statut).toBe("RETENU");
  });

  it("lève CompteModereIntrouvableError si le compte n'existe pas", async () => {
    gateway.compteExiste = false;
    await expect(
      suspendreCompte({ signalements, decisions }, gateway, {
        compteCibleId: "ghost",
        moderateurId: "m",
      })
    ).rejects.toBeInstanceOf(CompteModereIntrouvableError);
  });
});

describe("chargerJournalModeration", () => {
  it("renvoie les décisions les plus récentes d'abord, paginées", async () => {
    const s1 = await seed({ contenuId: "a" });
    const s2 = await seed({ contenuId: "b" });
    await rejeterSignalement({ signalements, decisions }, { signalementId: s1.id, moderateurId: "m" });
    await rejeterSignalement({ signalements, decisions }, { signalementId: s2.id, moderateurId: "m" });

    const journal = await chargerJournalModeration(decisions, { page: 1, pageSize: 1 });
    expect(journal.pagination).toMatchObject({ total: 2, totalPages: 2, page: 1 });
    expect(journal.items).toHaveLength(1);
    expect(journal.items[0].signalementId).toBe(s2.id);
  });
});
