import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryImportJobStore,
  createSignedUpload,
  finalizeImport,
  ImportFormValidationError,
  ImportJobNotFoundError,
  ImportRejeteError,
  ImportUploadRequestError,
  IMPORT_JOB_RETENTION_SECONDS,
  pruneExpiredImportJobs,
  runImportJob,
  toImportJobView,
  UploadIntrouvableError,
  type FinalizeImportInput,
} from "../import";
import { CERTIFICATION_DROITS_VERSION } from "../certificationDroits";
import {
  createInMemoryExtraitLibraryWriter,
  createMockObjectStorageCleaner,
  createMockSignedUploadUrlIssuer,
  createMockUploadedVideoProbe,
  createMockVideoCompressor,
} from "../mocks/import.mock";

const UTILISATEUR = "mock-user-001";

function finalizeInput(overrides: Partial<FinalizeImportInput> = {}): FinalizeImportInput {
  return {
    objectRef: "imports/mock-user-001/src-1",
    utilisateurId: UTILISATEUR,
    titre: "Ma scène préférée",
    origine: "FR",
    type: "FILM",
    // ST 5.2 — case de certification des droits cochée par défaut.
    certifieDroits: true,
    ...overrides,
  };
}

describe("createSignedUpload (ST 5.1 — point 1)", () => {
  it("renvoie une cible d'upload avec objectRef rattaché à l'utilisateur", async () => {
    const target = await createSignedUpload(createMockSignedUploadUrlIssuer(), {
      filename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 5_000_000,
      utilisateurId: UTILISATEUR,
    });
    expect(target.method).toBe("PUT");
    expect(target.objectRef).toContain(UTILISATEUR);
    expect(target.uploadUrl).toBeTruthy();
    expect(target.expiresAt).toBeTruthy();
  });

  it("rejette des métadonnées invalides avant d'émettre une URL", async () => {
    const issuer = { issue: vi.fn() };
    await expect(
      createSignedUpload(issuer, {
        filename: "clip.avi",
        mimeType: "video/x-msvideo",
        sizeBytes: 5_000_000,
        utilisateurId: UTILISATEUR,
      })
    ).rejects.toBeInstanceOf(ImportUploadRequestError);
    expect(issuer.issue).not.toHaveBeenCalled();
  });
});

describe("finalizeImport (ST 5.1 — point 2 : validation post-upload)", () => {
  it("crée un job en_attente pour une vidéo conforme (4:59) sans toucher au stockage", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();

    const job = await finalizeImport(
      { store, probe: createMockUploadedVideoProbe({ default: { durationSeconds: 299 } }), cleaner },
      finalizeInput()
    );

    expect(job.status).toBe("en_attente");
    expect(job.input.dureeSecondes).toBe(299);
    expect(job.input.utilisateurId).toBe(UTILISATEUR);
    expect(cleaner.deleted).toHaveLength(0);
  });

  it("rejette une vidéo de 5:01 ET supprime immédiatement le fichier du stockage", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    const input = finalizeInput();

    await expect(
      finalizeImport(
        { store, probe: createMockUploadedVideoProbe({ default: { durationSeconds: 301 } }), cleaner },
        input
      )
    ).rejects.toBeInstanceOf(ImportRejeteError);

    expect(cleaner.deleted).toEqual([input.objectRef]);
    expect(await store.list()).toHaveLength(0);
  });

  it("lève UploadIntrouvableError si l'objet est absent du stockage", async () => {
    const store = createInMemoryImportJobStore();
    await expect(
      finalizeImport(
        {
          store,
          probe: createMockUploadedVideoProbe({ default: null }),
          cleaner: createMockObjectStorageCleaner(),
        },
        finalizeInput()
      )
    ).rejects.toBeInstanceOf(UploadIntrouvableError);
  });

  it("rejette une classification invalide (et nettoie le fichier)", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    await expect(
      finalizeImport(
        { store, probe: createMockUploadedVideoProbe(), cleaner },
        finalizeInput({ titre: " " })
      )
    ).rejects.toBeInstanceOf(ImportFormValidationError);
    expect(cleaner.deleted).toHaveLength(1);
  });

  it("bloque la finalisation si la certification des droits n'est pas cochée (ST 5.2)", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    await expect(
      finalizeImport(
        { store, probe: createMockUploadedVideoProbe(), cleaner },
        finalizeInput({ certifieDroits: false })
      )
    ).rejects.toBeInstanceOf(ImportFormValidationError);
    // Aucun job créé, fichier nettoyé.
    expect(await store.list()).toHaveLength(0);
    expect(cleaner.deleted).toHaveLength(1);
  });

  it("fige l'horodatage et la version de certification sur le job (ST 5.2)", async () => {
    const store = createInMemoryImportJobStore();
    const t0 = new Date("2026-09-01T08:30:00.000Z");
    const job = await finalizeImport(
      {
        store,
        probe: createMockUploadedVideoProbe(),
        cleaner: createMockObjectStorageCleaner(),
        now: () => t0,
      },
      finalizeInput()
    );
    expect(job.input.certificationDroitsLe).toBe(t0.toISOString());
    expect(job.input.certificationDroitsVersion).toBe(CERTIFICATION_DROITS_VERSION);
  });

  it("ne masque pas le motif de rejet si la suppression du fichier échoue", async () => {
    const store = createInMemoryImportJobStore();
    const input = finalizeInput();
    const cleaner = createMockObjectStorageCleaner({ failOn: [input.objectRef] });
    await expect(
      finalizeImport(
        { store, probe: createMockUploadedVideoProbe({ default: { durationSeconds: 999 } }), cleaner },
        input
      )
    ).rejects.toBeInstanceOf(ImportRejeteError);
  });
});

describe("runImportJob (ST 5.1 — points 3-4, bout-en-bout mocks)", () => {
  async function pendingJob(durationSeconds = 120) {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    const job = await finalizeImport(
      { store, probe: createMockUploadedVideoProbe({ default: { durationSeconds } }), cleaner },
      finalizeInput()
    );
    return { store, cleaner, id: job.id, sourceRef: job.input.objectRef };
  }

  it("mène un job de en_attente à pret, crée l'extrait EN_ATTENTE et purge la source", async () => {
    const { store, cleaner, id, sourceRef } = await pendingJob(240);
    const library = createInMemoryExtraitLibraryWriter();

    const result = await runImportJob(store, id, {
      compressor: createMockVideoCompressor(),
      library,
      cleaner,
    });

    expect(result.status).toBe("pret");
    expect(result.progress).toBe(1);
    expect(result.extraitId).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();

    expect(library.created).toHaveLength(1);
    expect(library.created[0]).toMatchObject({
      titre: "Ma scène préférée",
      dureeSecondes: 240,
      importeParId: UTILISATEUR,
      certificationDroitsVersion: CERTIFICATION_DROITS_VERSION,
    });
    expect(library.created[0].urlSource).toBeTruthy();
    // ST 5.2 — preuve de certification recopiée sur l'extrait (date exploitable).
    expect(library.created[0].certificationDroitsLe).toBeInstanceOf(Date);
    expect(Number.isNaN(library.created[0].certificationDroitsLe.getTime())).toBe(false);

    // Fichier source brut supprimé une fois la version compressée en place.
    expect(cleaner.deleted).toContain(sourceRef);
  });

  it("passe le job à echec si la compression lève, sans détail technique", async () => {
    const { store, id } = await pendingJob();
    const result = await runImportJob(store, id, {
      compressor: createMockVideoCompressor({ fail: true }),
      library: createInMemoryExtraitLibraryWriter(),
    });
    expect(result.status).toBe("echec");
    expect(result.error).toMatch(/échoué/i);
    expect(result.error).not.toMatch(/FFmpeg/i);
  });

  it("n'écrit pas d'extrait si la compression échoue", async () => {
    const { store, id } = await pendingJob();
    const library = createInMemoryExtraitLibraryWriter();
    await runImportJob(store, id, {
      compressor: createMockVideoCompressor({ fail: true }),
      library,
    });
    expect(library.created).toHaveLength(0);
  });

  it("est idempotent : un second appel ne relance ni compression ni écriture", async () => {
    const { store, id } = await pendingJob();
    const compressor = { compress: vi.fn(createMockVideoCompressor().compress) };
    const library = createInMemoryExtraitLibraryWriter();

    await runImportJob(store, id, { compressor, library });
    await runImportJob(store, id, { compressor, library });

    expect(compressor.compress).toHaveBeenCalledTimes(1);
    expect(library.created).toHaveLength(1);
  });

  it("lève si le job est introuvable", async () => {
    const store = createInMemoryImportJobStore();
    await expect(
      runImportJob(store, "inconnu", {
        compressor: createMockVideoCompressor(),
        library: createInMemoryExtraitLibraryWriter(),
      })
    ).rejects.toBeInstanceOf(ImportJobNotFoundError);
  });
});

describe("toImportJobView", () => {
  it("n'expose ni la clé de stockage ni l'identité de l'importateur", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    const job = await finalizeImport(
      { store, probe: createMockUploadedVideoProbe(), cleaner },
      finalizeInput()
    );
    const done = await runImportJob(store, job.id, {
      compressor: createMockVideoCompressor(),
      library: createInMemoryExtraitLibraryWriter(),
      cleaner,
    });
    const view = toImportJobView(done);

    expect(view).not.toHaveProperty("input");
    expect(view).not.toHaveProperty("outputRef");
    expect(JSON.stringify(view)).not.toContain(UTILISATEUR);
    expect(JSON.stringify(view)).not.toContain("imports/");
    expect(view.status).toBe("pret");
    expect(view.extraitId).toBeTruthy();
  });
});

describe("pruneExpiredImportJobs", () => {
  it("supprime les jobs dont la rétention a expiré, garde les autres", async () => {
    const t0 = new Date("2026-09-01T00:00:00.000Z");
    const store = createInMemoryImportJobStore(() => t0);
    const cleaner = createMockObjectStorageCleaner();
    const job = await finalizeImport(
      { store, probe: createMockUploadedVideoProbe(), cleaner },
      finalizeInput()
    );
    await runImportJob(store, job.id, {
      compressor: createMockVideoCompressor(),
      library: createInMemoryExtraitLibraryWriter(),
      now: () => t0,
    });

    const before = new Date(t0.getTime() + (IMPORT_JOB_RETENTION_SECONDS - 60) * 1000);
    expect(await pruneExpiredImportJobs(store, before)).toBe(0);

    const after = new Date(t0.getTime() + (IMPORT_JOB_RETENTION_SECONDS + 60) * 1000);
    expect(await pruneExpiredImportJobs(store, after)).toBe(1);
    expect(await store.get(job.id)).toBeNull();
  });

  it("ignore les jobs sans expiration (jamais terminés)", async () => {
    const store = createInMemoryImportJobStore();
    const cleaner = createMockObjectStorageCleaner();
    await finalizeImport(
      { store, probe: createMockUploadedVideoProbe(), cleaner },
      finalizeInput()
    );
    expect(await pruneExpiredImportJobs(store, new Date("2099-01-01"))).toBe(0);
  });
});
