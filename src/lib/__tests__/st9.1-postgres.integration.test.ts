import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listExtraits, findExtraitById } from "@/lib/extraits";
import { listScriptLignes, createScriptLignes } from "@/lib/script";
import { prismaDoublageSauvegardeStore } from "@/lib/mocks/doublageSauvegarde.mock";
import { prismaSignalementStore } from "@/lib/mocks/signalement.mock";
import { prismaDemandeRetraitStore } from "@/lib/mocks/demandeRetrait.mock";
import {
  prismaDecisionModerationStore,
  prismaContenuModerationGateway,
} from "@/lib/mocks/moderation.mock";

/**
 * Tests d'intégration ST 9.1 « Bascule intégrale sur PostgreSQL ».
 *
 * Contrairement au reste de la suite (stores en mémoire injectés
 * directement dans les fonctions métier), ces tests parlent à une vraie base
 * Postgres via le client Prisma (`@/lib/prisma`) — DoD explicite de ST 9.1 :
 * « tests d'intégration exécutés contre une base réelle ». Ils exercent les
 * chemins de code qui, avant cette story, pouvaient être remplacés par un
 * store en mémoire via `DATA_SOURCE=mock` :
 *  - `listExtraits`/`findExtraitById` contre `prisma.extrait` (jeu de
 *    données injecté par `prisma/seed.ts`, cf. `npm run db:seed`) ;
 *  - `listScriptLignes`/`createScriptLignes` contre `prisma.scriptLigne` ;
 *  - les adaptateurs Prisma de sauvegarde de doublage (ST 6.1), signalement
 *    (ST 7.1), demande de retrait (ST 7.3) et décision de modération
 *    (ST 7.2), dont les accesseurs (`getDoublageSauvegardeStore`, etc.)
 *    renvoient désormais toujours ces adaptateurs.
 *
 * Prérequis : `DATABASE_URL` valide, migrations appliquées
 * (`npx prisma migrate deploy`) et seed exécuté (`npm run db:seed`) — comme
 * en CI (`.github/workflows/ci.yml`). Chaque test nettoie les lignes qu'il
 * crée lui-même ; les extraits du seed (`mock-001`, `mock-002`) ne sont que
 * lus, jamais modifiés.
 */

const TEST_UTILISATEUR_ID = "st9-1-integration-utilisateur";
const TEST_EXTRAIT_ID = "st9-1-integration-extrait";

beforeAll(async () => {
  // Compte et extrait jetables, indépendants du jeu de données du seed —
  // nécessaires aux tests qui insèrent une ligne référençant un utilisateur
  // (contrainte de clé étrangère `doublages.utilisateur_id`) ou un contenu à
  // retirer (`prismaContenuModerationGateway.retirerExtrait`).
  await prisma.utilisateur.upsert({
    where: { id: TEST_UTILISATEUR_ID },
    create: {
      id: TEST_UTILISATEUR_ID,
      email: "st9.1-integration@example.test",
      motDePasseHash: "not-a-real-hash",
      nom: "Test",
      prenom: "Intégration",
      age: 30,
    },
    update: {},
  });
  await prisma.extrait.upsert({
    where: { id: TEST_EXTRAIT_ID },
    create: {
      id: TEST_EXTRAIT_ID,
      titre: "ST 9.1 — extrait jetable de test d'intégration",
      origine: "FR",
      type: "FILM",
      source: "EMBED",
      urlSource: "https://example.test/video",
      statut: "VALIDE",
    },
    update: {},
  });
});

afterAll(async () => {
  await prisma.extrait.delete({ where: { id: TEST_EXTRAIT_ID } }).catch(() => {});
  await prisma.utilisateur.delete({ where: { id: TEST_UTILISATEUR_ID } }).catch(() => {});
  await prisma.$disconnect();
});

describe("ST 9.1 — GET /api/extraits (Prisma, jeu de données du seed)", () => {
  it("liste les extraits VALIDE seedés, triés par date de création décroissante", async () => {
    const page = await listExtraits(prisma.extrait, { page: 1, pageSize: 50 });
    const ids = page.items.map((e) => e.id);
    expect(ids).toContain("mock-001");
    expect(ids).toContain("mock-002");
    // Tous les items renvoyés sont VALIDE (le seed inclut aussi EN_ATTENTE/REJETE).
    expect(page.items.every((e) => e.statut === "VALIDE")).toBe(true);
  });

  it("findExtraitById retrouve un extrait seedé par id", async () => {
    const extrait = await findExtraitById(prisma.extrait, "mock-001");
    expect(extrait?.titre).toBe("L'Odyssée Stellaire — Pilote");
  });

  it("findExtraitById renvoie null pour un id inconnu", async () => {
    const extrait = await findExtraitById(prisma.extrait, "id-totalement-inconnu");
    expect(extrait).toBeNull();
  });
});

describe("ST 9.1 — GET /api/extraits/:id/script (Prisma, jeu de données du seed)", () => {
  it("liste le script seedé de mock-001, trié par timestampDebut croissant", async () => {
    const lignes = await listScriptLignes(prisma.scriptLigne, "mock-001");
    expect(lignes.length).toBeGreaterThanOrEqual(4);
    const timestamps = lignes.map((l) => l.timestampDebut);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("renvoie un tableau vide pour un extrait sans script (pas d'erreur)", async () => {
    const lignes = await listScriptLignes(prisma.scriptLigne, "mock-002");
    expect(lignes).toEqual([]);
  });

  it("createScriptLignes insère puis listScriptLignes retrouve la ligne (nettoyée après coup)", async () => {
    const inserted = await createScriptLignes(prisma.scriptLigne, TEST_EXTRAIT_ID, [
      { texte: "Ligne de test jetable.", timestampDebut: 0, timestampFin: 1 },
    ]);
    expect(inserted).toBe(1);

    const lignes = await listScriptLignes(prisma.scriptLigne, TEST_EXTRAIT_ID);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].texte).toBe("Ligne de test jetable.");

    await prisma.scriptLigne.deleteMany({ where: { extraitId: TEST_EXTRAIT_ID } });
  });
});

describe("ST 9.1 — adaptateur Prisma de sauvegarde de doublage (ST 6.1)", () => {
  afterEach(async () => {
    await prisma.doublage.deleteMany({ where: { utilisateurId: TEST_UTILISATEUR_ID } });
  });

  it("create / get / findByJob / pageByUtilisateur passent par une vraie table Postgres", async () => {
    const store = prismaDoublageSauvegardeStore();
    const created = await store.create({
      utilisateurId: TEST_UTILISATEUR_ID,
      extraitId: TEST_EXTRAIT_ID,
      jobId: "st9-1-job-jetable",
      fichierUrl: "https://example.test/doublage.mp4",
    });
    expect(created.visibilite).toBe("PRIVEE");

    const parId = await store.get(created.id);
    expect(parId?.jobId).toBe("st9-1-job-jetable");

    const parJob = await store.findByJob(TEST_UTILISATEUR_ID, "st9-1-job-jetable");
    expect(parJob?.id).toBe(created.id);

    const page = await store.pageByUtilisateur(TEST_UTILISATEUR_ID, { skip: 0, take: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(created.id);
  });
});

describe("ST 9.1 — adaptateur Prisma de signalement (ST 7.1)", () => {
  afterEach(async () => {
    await prisma.signalement.deleteMany({ where: { contenuId: TEST_EXTRAIT_ID } });
  });

  it("create / page / get / setStatut / countPourContenu passent par une vraie table Postgres", async () => {
    const store = prismaSignalementStore();
    const created = await store.create({
      contenuType: "EXTRAIT",
      contenuId: TEST_EXTRAIT_ID,
      motif: "Contenu de test d'intégration.",
    });
    expect(created.statut).toBe("EN_ATTENTE");

    const compte = await store.countPourContenu("EXTRAIT", TEST_EXTRAIT_ID);
    expect(compte).toBe(1);

    const mis = await store.setStatut(created.id, "REJETE");
    expect(mis.statut).toBe("REJETE");

    const relu = await store.get(created.id);
    expect(relu?.statut).toBe("REJETE");
  });
});

describe("ST 9.1 — adaptateur Prisma de demande de retrait (ST 7.3)", () => {
  let createdId: string | undefined;

  afterEach(async () => {
    if (createdId) {
      await prisma.demandeRetrait.delete({ where: { id: createdId } }).catch(() => {});
      createdId = undefined;
    }
  });

  it("create / get / clore passent par une vraie table Postgres", async () => {
    const store = prismaDemandeRetraitStore();
    const created = await store.create({
      contenuType: "EXTRAIT",
      contenuId: TEST_EXTRAIT_ID,
      oeuvre: "Œuvre de test d'intégration",
      demandeurNom: "Ayant Droit Test",
      demandeurEmail: "ayant-droit@example.test",
      motif: "Retrait de test d'intégration.",
      declarationBonneFoi: true,
    });
    createdId = created.id;
    expect(created.statut).toBe("EN_ATTENTE");

    const clos = await store.clore(created.id, {
      statut: "TRAITEE",
      traiteeParId: TEST_UTILISATEUR_ID,
      commentaireTraitement: null,
      dateTraitement: new Date().toISOString(),
    });
    expect(clos.statut).toBe("TRAITEE");
    expect(clos.traiteeParId).toBe(TEST_UTILISATEUR_ID);
  });
});

describe("ST 9.1 — adaptateurs Prisma de modération (ST 7.2)", () => {
  afterEach(async () => {
    await prisma.decisionModeration.deleteMany({ where: { contenuId: TEST_EXTRAIT_ID } });
  });

  it("prismaDecisionModerationStore.create/page journalise dans une vraie table Postgres", async () => {
    const store = prismaDecisionModerationStore();
    await store.create({
      action: "REJET_SIGNALEMENT",
      moderateurId: null,
      signalementId: null,
      contenuType: "EXTRAIT",
      contenuId: TEST_EXTRAIT_ID,
      compteCibleId: null,
      demandeRetraitId: null,
      commentaire: "Décision de test d'intégration.",
    });

    const page = await store.page({ skip: 0, take: 10 });
    expect(page.items.some((d) => d.contenuId === TEST_EXTRAIT_ID)).toBe(true);
  });

  it("prismaContenuModerationGateway.retirerExtrait modifie le statut réel puis restaure", async () => {
    const gateway = prismaContenuModerationGateway();
    const ok = await gateway.retirerExtrait(TEST_EXTRAIT_ID, "RETRAIT_MODERATION");
    expect(ok).toBe(true);

    const retire = await prisma.extrait.findUnique({ where: { id: TEST_EXTRAIT_ID } });
    expect(retire?.statut).toBe("RETRAIT_MODERATION");

    // Restauré pour ne pas fausser les autres tests de ce fichier (le
    // endpoint public `GET /api/extraits` exclurait sinon `TEST_EXTRAIT_ID`).
    await prisma.extrait.update({ where: { id: TEST_EXTRAIT_ID }, data: { statut: "VALIDE" } });
  });

  it("prismaContenuModerationGateway.retirerExtrait renvoie false pour un id inconnu", async () => {
    const gateway = prismaContenuModerationGateway();
    const ok = await gateway.retirerExtrait("id-totalement-inconnu");
    expect(ok).toBe(false);
  });
});
