import { beforeEach, describe, expect, it } from "vitest";
import {
  chargerHistoriqueDoublages,
  createInMemoryDoublageSauvegardeStore,
  DoublageJobPasPretError,
  DoublageSauvegardeAccesRefuseError,
  DoublageSauvegardeIntrouvableError,
  lireDoublageSauvegarde,
  listerDoublagesSauvegardes,
  sauvegarderDoublage,
  toDoublageSauvegardeView,
  type DoublageSauvegardeStore,
  type ResolveExtraitResume,
} from "../doublageSauvegarde";
import {
  createInMemoryDoublageJobStore,
  runDoublageJob,
  type DoublageJob,
  type DoublageJobInput,
} from "../doublage";
import {
  createMockDoublageProcessor,
  createMockSignedUrlIssuer,
} from "../mocks/doublage.mock";

// ST 6.1, Definition of Done technique : « Tests unitaires sur les règles
// d'accès (propriétaire vs tiers) ».

const OWNER = "mock-user-001";
const TIERS = "mock-user-002";

const jobInput: DoublageJobInput = {
  extraitId: "mock-002",
  extraitTitre: "Réverbérations",
  videoSourceUrl: "https://example.test/source.mp4",
  audioRef: "pending-audio/mock-002-1",
  audioMimeType: "audio/webm",
  audioSizeBytes: 400_000,
  audioDurationSeconds: 30,
  audioOffsetSeconds: 0,
};

/** Crée un job de doublage mené jusqu'au statut `pret` (mocks ST 3.1). */
async function jobPret(overrides: Partial<DoublageJobInput> = {}): Promise<DoublageJob> {
  const store = createInMemoryDoublageJobStore();
  const created = await store.create({ ...jobInput, ...overrides });
  return runDoublageJob(store, created.id, {
    processor: createMockDoublageProcessor(),
    issuer: createMockSignedUrlIssuer(),
  });
}

describe("sauvegarderDoublage", () => {
  let store: DoublageSauvegardeStore;

  beforeEach(() => {
    store = createInMemoryDoublageSauvegardeStore();
  });

  it("crée une entrée privée par défaut, liée au fichier généré (pas de re-génération)", async () => {
    const job = await jobPret();

    const sauvegarde = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    expect(sauvegarde.visibilite).toBe("PRIVEE");
    expect(sauvegarde.utilisateurId).toBe(OWNER);
    expect(sauvegarde.extraitId).toBe("mock-002");
    expect(sauvegarde.jobId).toBe(job.id);
    // « Réutilisation du fichier déjà généré en ST 3.1 » : l'URL est recopiée du job.
    expect(sauvegarde.fichierUrl).toBe(job.downloadUrl);
  });

  it("est idempotente : deux sauvegardes du même doublage par le même compte ne créent qu'une entrée", async () => {
    const job = await jobPret();

    const first = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });
    const second = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    expect(second.id).toBe(first.id);
    expect(await listerDoublagesSauvegardes(store, OWNER)).toHaveLength(1);
  });

  it("permet à deux comptes différents de sauvegarder le même doublage", async () => {
    const job = await jobPret();

    const forOwner = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });
    const forTiers = await sauvegarderDoublage(store, { job, utilisateurId: TIERS });

    expect(forOwner.id).not.toBe(forTiers.id);
    expect(await listerDoublagesSauvegardes(store, OWNER)).toHaveLength(1);
    expect(await listerDoublagesSauvegardes(store, TIERS)).toHaveLength(1);
  });

  it("refuse un job qui n'est pas encore prêt", async () => {
    const jobStore = createInMemoryDoublageJobStore();
    const enAttente = await jobStore.create(jobInput);

    await expect(
      sauvegarderDoublage(store, { job: enAttente, utilisateurId: OWNER })
    ).rejects.toBeInstanceOf(DoublageJobPasPretError);
  });

  it("refuse un identifiant utilisateur vide", async () => {
    const job = await jobPret();
    await expect(
      sauvegarderDoublage(store, { job, utilisateurId: "   " })
    ).rejects.toThrow(/identifiant utilisateur/i);
  });
});

describe("lireDoublageSauvegarde — règles d'accès (propriétaire vs tiers)", () => {
  let store: DoublageSauvegardeStore;

  beforeEach(() => {
    store = createInMemoryDoublageSauvegardeStore();
  });

  it("le propriétaire lit sa sauvegarde privée", async () => {
    const job = await jobPret();
    const saved = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    const lu = await lireDoublageSauvegarde(store, saved.id, OWNER);
    expect(lu.id).toBe(saved.id);
  });

  it("un tiers ne peut pas lire une sauvegarde privée (accès refusé)", async () => {
    const job = await jobPret();
    const saved = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    await expect(
      lireDoublageSauvegarde(store, saved.id, TIERS)
    ).rejects.toBeInstanceOf(DoublageSauvegardeAccesRefuseError);
  });

  it("un visiteur non authentifié ne peut pas lire une sauvegarde privée", async () => {
    const job = await jobPret();
    const saved = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    await expect(lireDoublageSauvegarde(store, saved.id, null)).rejects.toBeInstanceOf(
      DoublageSauvegardeAccesRefuseError
    );
    await expect(lireDoublageSauvegarde(store, saved.id, "")).rejects.toBeInstanceOf(
      DoublageSauvegardeAccesRefuseError
    );
  });

  it("une sauvegarde PUBLIC est lisible par un tiers et un visiteur", async () => {
    const job = await jobPret();
    // Création directe en visibilité PUBLIC (le geste de publication est hors
    // périmètre ST 6.1 ; on vérifie seulement que la règle d'accès la laisse passer).
    const publique = await store.create({
      utilisateurId: OWNER,
      extraitId: job.input.extraitId,
      jobId: job.id,
      fichierUrl: job.downloadUrl!,
      visibilite: "PUBLIC",
    });

    expect((await lireDoublageSauvegarde(store, publique.id, TIERS)).id).toBe(publique.id);
    expect((await lireDoublageSauvegarde(store, publique.id, null)).id).toBe(publique.id);
  });

  it("lève DoublageSauvegardeIntrouvableError pour un id inconnu", async () => {
    await expect(
      lireDoublageSauvegarde(store, "inexistant", OWNER)
    ).rejects.toBeInstanceOf(DoublageSauvegardeIntrouvableError);
  });
});

describe("listerDoublagesSauvegardes", () => {
  it("ne renvoie que les sauvegardes du demandeur, les plus récentes d'abord", async () => {
    let tick = 0;
    const store = createInMemoryDoublageSauvegardeStore(
      () => new Date(2026, 0, 1, 0, 0, tick++)
    );

    const j1 = await jobPret({ extraitId: "mock-001" });
    const j2 = await jobPret({ extraitId: "mock-002" });
    await sauvegarderDoublage(store, { job: j1, utilisateurId: OWNER });
    await sauvegarderDoublage(store, { job: j2, utilisateurId: OWNER });
    await sauvegarderDoublage(store, { job: j1, utilisateurId: TIERS });

    const liste = await listerDoublagesSauvegardes(store, OWNER);
    expect(liste.map((s) => s.extraitId)).toEqual(["mock-002", "mock-001"]);
    expect(await listerDoublagesSauvegardes(store, "   ")).toEqual([]);
  });
});

describe("chargerHistoriqueDoublages — endpoint de listing paginé (ST 6.2)", () => {
  const OTHER = "mock-user-003";

  /** Résout un extrait mocké : le titre reprend l'id, sauf `mock-404` (retiré). */
  const resolveExtrait: ResolveExtraitResume = async (extraitId) => {
    if (extraitId === "mock-404") return null;
    return {
      titre: `Titre ${extraitId}`,
      thumbnail: `https://img.test/${extraitId}.jpg`,
      origine: "FR",
      type: "FILM",
    };
  };

  /** Store rempli de `count` sauvegardes pour OWNER (dates croissantes). */
  async function storeAvec(count: number, extraitIds?: string[]) {
    let tick = 0;
    const store = createInMemoryDoublageSauvegardeStore(
      () => new Date(2026, 0, 1, 0, 0, tick++)
    );
    for (let i = 0; i < count; i++) {
      await store.create({
        utilisateurId: OWNER,
        extraitId: extraitIds?.[i] ?? `mock-${String(i).padStart(3, "0")}`,
        jobId: `job-${i}`,
        fichierUrl: `https://files.test/${i}.mp4`,
      });
    }
    return store;
  }

  it("renvoie la première page, les plus récents d'abord, enrichis de l'extrait", async () => {
    const store = await storeAvec(3, ["mock-a", "mock-b", "mock-c"]);

    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 2,
      resolveExtrait,
    });

    expect(res.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.items.map((i) => i.extraitId)).toEqual(["mock-c", "mock-b"]);
    expect(res.items[0]).toMatchObject({
      extraitTitre: "Titre mock-c",
      extraitThumbnail: "https://img.test/mock-c.jpg",
      extraitOrigine: "FR",
      extraitType: "FILM",
    });
    // La vue n'expose pas les champs internes (ST 6.1).
    expect(res.items[0]).not.toHaveProperty("utilisateurId");
    expect(res.items[0]).not.toHaveProperty("jobId");
  });

  it("pagine correctement la dernière page", async () => {
    const store = await storeAvec(3);
    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 2,
      pageSize: 2,
      resolveExtrait,
    });
    expect(res.items).toHaveLength(1);
    expect(res.pagination.page).toBe(2);
  });

  it("borne une page hors limite à la dernière page plutôt que d'échouer", async () => {
    const store = await storeAvec(2);
    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 99,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.pagination.page).toBe(1);
    expect(res.items).toHaveLength(2);
  });

  it("ne renvoie jamais les doublages d'un autre compte", async () => {
    const store = await storeAvec(2);
    await store.create({
      utilisateurId: OTHER,
      extraitId: "mock-x",
      jobId: "job-other",
      fichierUrl: "https://files.test/x.mp4",
    });

    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 50,
      resolveExtrait,
    });
    expect(res.pagination.total).toBe(2);
    expect(res.items.every((i) => i.extraitId !== "mock-x")).toBe(true);
  });

  it("tolère un extrait retiré (champs extrait à null)", async () => {
    const store = await storeAvec(1, ["mock-404"]);
    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.items[0]).toMatchObject({
      extraitTitre: null,
      extraitThumbnail: null,
      extraitOrigine: null,
      extraitType: null,
    });
  });

  it("ne résout chaque extrait distinct qu'une fois", async () => {
    const store = await storeAvec(3, ["mock-same", "mock-same", "mock-same"]);
    let calls = 0;
    await chargerHistoriqueDoublages(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 10,
      resolveExtrait: async (id) => {
        calls++;
        return { titre: id, thumbnail: null, origine: null, type: null };
      },
    });
    expect(calls).toBe(1);
  });

  it("renvoie une page vide pour un identifiant utilisateur vide", async () => {
    const store = await storeAvec(2);
    const res = await chargerHistoriqueDoublages(store, {
      utilisateurId: "   ",
      page: 1,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.items).toEqual([]);
    expect(res.pagination.total).toBe(0);
  });
});

describe("toDoublageSauvegardeView", () => {
  it("n'expose ni utilisateurId ni jobId", async () => {
    const store = createInMemoryDoublageSauvegardeStore();
    const job = await jobPret();
    const saved = await sauvegarderDoublage(store, { job, utilisateurId: OWNER });

    const view = toDoublageSauvegardeView(saved);
    expect(view).toEqual({
      id: saved.id,
      extraitId: "mock-002",
      fichierUrl: saved.fichierUrl,
      visibilite: "PRIVEE",
      dateCreation: saved.dateCreation,
    });
    expect(view).not.toHaveProperty("utilisateurId");
    expect(view).not.toHaveProperty("jobId");
  });
});
