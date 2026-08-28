import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryDoublageJobStore,
  DoublageJobNotFoundError,
  DOUBLAGE_URL_TTL_SECONDS,
  pruneExpiredDoublageJobs,
  runDoublageJob,
  toDoublageJobView,
  type DoublageJobInput,
  type DoublageProcessor,
  type SignedUrlIssuer,
} from "../doublage";
import {
  createMockDoublageProcessor,
  createMockSignedUrlIssuer,
} from "../mocks/doublage.mock";

// ST 3.1, Definition of Done : « test d'intégration bout-en-bout sur un extrait
// court » — ici avec processeur et émetteur d'URL mockés (FFmpeg/S3 absents).

const input: DoublageJobInput = {
  extraitId: "mock-002",
  extraitTitre: "Réverbérations",
  videoSourceUrl: "https://example.test/video.mp4",
  audioRef: "pending-audio/mock-002-1",
  audioMimeType: "audio/webm",
  audioSizeBytes: 400_000,
  audioDurationSeconds: 30,
  audioOffsetSeconds: 4,
  mode: "remplacer",
};

describe("createInMemoryDoublageJobStore", () => {
  it("crée un job en_attente avec progression nulle", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);
    expect(job.status).toBe("en_attente");
    expect(job.progress).toBe(0);
    expect(job.id).toBeTruthy();
    expect(await store.get(job.id)).toMatchObject({ id: job.id });
  });

  it("update lève si le job n'existe pas", async () => {
    const store = createInMemoryDoublageJobStore();
    await expect(store.update("inconnu", { progress: 1 })).rejects.toBeInstanceOf(
      DoublageJobNotFoundError
    );
  });

  it("retourne des copies (pas de mutation externe du store)", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);
    job.status = "pret";
    expect((await store.get(job.id))!.status).toBe("en_attente");
  });
});

describe("runDoublageJob (bout-en-bout, mocks)", () => {
  it("mène un job de en_attente à pret avec URL de téléchargement et nom de fichier", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);

    const result = await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(),
    });

    expect(result.status).toBe("pret");
    expect(result.progress).toBe(1);
    expect(result.downloadUrl).toContain("mock-download");
    expect(result.downloadFilename).toBe("reverberations-doublage.mp4");
    expect(result.expiresAt).toBeTruthy();
  });

  it("remonte la progression via onProgress pendant le traitement", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);
    const processor = createMockDoublageProcessor({ progressSteps: [0.5] });

    await runDoublageJob(store, job.id, {
      processor,
      issuer: createMockSignedUrlIssuer(),
    });
    // La progression finale est 1 (pret) ; l'étape intermédiaire a été
    // appliquée au job (bornée dans [0.05, 0.95]).
    expect((await store.get(job.id))!.status).toBe("pret");
  });

  it("passe le job à echec si le processeur lève, sans propager le détail technique", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);

    const result = await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor({ fail: true }),
      issuer: createMockSignedUrlIssuer(),
    });

    expect(result.status).toBe("echec");
    expect(result.error).toMatch(/échoué/i);
    expect(result.error).not.toMatch(/FFmpeg/); // message générique côté client
  });

  it("est idempotent : un second appel ne relance pas un job déjà traité", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);

    const issuer: SignedUrlIssuer = {
      issue: vi.fn(createMockSignedUrlIssuer().issue),
    };
    const processor: DoublageProcessor = {
      mix: vi.fn(createMockDoublageProcessor().mix),
    };

    await runDoublageJob(store, job.id, { processor, issuer });
    await runDoublageJob(store, job.id, { processor, issuer });

    expect(processor.mix).toHaveBeenCalledTimes(1);
    expect(issuer.issue).toHaveBeenCalledTimes(1);
  });

  it("lève si le job est introuvable", async () => {
    const store = createInMemoryDoublageJobStore();
    await expect(
      runDoublageJob(store, "inconnu", {
        processor: createMockDoublageProcessor(),
        issuer: createMockSignedUrlIssuer(),
      })
    ).rejects.toBeInstanceOf(DoublageJobNotFoundError);
  });

  it("utilise le TTL par défaut pour l'expiration de l'URL", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const store = createInMemoryDoublageJobStore(() => fixedNow);
    const job = await store.create(input);

    const result = await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(() => fixedNow),
    });

    expect(result.expiresAt).toBe(
      new Date(fixedNow.getTime() + DOUBLAGE_URL_TTL_SECONDS * 1000).toISOString()
    );
  });
});

describe("toDoublageJobView", () => {
  it("n'expose pas les références internes (audio, vidéo source, sortie)", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);
    const done = await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(),
    });
    const view = toDoublageJobView(done);

    expect(view).not.toHaveProperty("input");
    expect(view).not.toHaveProperty("outputRef");
    expect(JSON.stringify(view)).not.toContain("pending-audio");
    expect(view.downloadUrl).toBeTruthy();
  });

  it("expose error uniquement pour un échec", async () => {
    const store = createInMemoryDoublageJobStore();
    const job = await store.create(input);
    const failed = await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor({ fail: true }),
      issuer: createMockSignedUrlIssuer(),
    });
    const view = toDoublageJobView(failed);
    expect(view.error).toBeTruthy();
    expect(view.downloadUrl).toBeUndefined();
  });
});

describe("pruneExpiredDoublageJobs", () => {
  it("supprime les jobs dont l'URL a expiré et appelle onDeleteOutput", async () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const store = createInMemoryDoublageJobStore(() => t0);
    const job = await store.create(input);
    await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(() => t0),
    });

    const onDelete = vi.fn();
    const later = new Date(t0.getTime() + (DOUBLAGE_URL_TTL_SECONDS + 60) * 1000);
    const purged = await pruneExpiredDoublageJobs(store, later, onDelete);

    expect(purged).toBe(1);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(await store.get(job.id)).toBeNull();
  });

  it("conserve les jobs encore valides", async () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const store = createInMemoryDoublageJobStore(() => t0);
    const job = await store.create(input);
    await runDoublageJob(store, job.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(() => t0),
    });

    const purged = await pruneExpiredDoublageJobs(
      store,
      new Date(t0.getTime() + 60 * 1000)
    );
    expect(purged).toBe(0);
    expect(await store.get(job.id)).not.toBeNull();
  });

  it("ignore les jobs sans expiration (jamais passés à pret)", async () => {
    const store = createInMemoryDoublageJobStore();
    await store.create(input);
    expect(await pruneExpiredDoublageJobs(store, new Date("2099-01-01"))).toBe(0);
  });
});
