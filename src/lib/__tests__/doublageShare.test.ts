import { describe, expect, it } from "vitest";
import {
  buildDoublageShareMetadata,
  buildUnavailableDoublageMetadata,
  DOUBLAGE_SITE_NAME,
  doublageShareMetadataFromJob,
  toNextMetadata,
} from "../doublageShare";
import {
  createInMemoryDoublageJobStore,
  publishDoublageJob,
  runDoublageJob,
  type DoublageJobInput,
} from "../doublage";
import {
  createMockDoublageProcessor,
  createMockSignedUrlIssuer,
} from "../mocks/doublage.mock";

// ST 3.2, Definition of Done : « Tests unitaires sur la génération des
// métadonnées Open Graph ».

const jobInput: DoublageJobInput = {
  extraitId: "mock-002",
  extraitTitre: "Réverbérations",
  extraitThumbnail: "https://cdn.test/reverberations.jpg",
  videoSourceUrl: "https://example.test/source.mp4",
  audioRef: "pending-audio/mock-002-1",
  audioMimeType: "audio/webm",
  audioSizeBytes: 400_000,
  audioDurationSeconds: 30,
  audioOffsetSeconds: 0,
};

describe("buildDoublageShareMetadata", () => {
  const base = {
    id: "j1",
    extraitTitre: "Réverbérations",
    shareUrl: "https://voxtrait.test/doublage/j1",
    videoUrl: "https://cdn.test/j1.mp4",
    imageUrl: "https://cdn.test/thumb.jpg",
  };

  it("compose un titre et une description citant l'extrait", () => {
    const meta = buildDoublageShareMetadata(base);
    expect(meta.title).toBe(`Réverbérations — doublage sur ${DOUBLAGE_SITE_NAME}`);
    expect(meta.description).toContain("Réverbérations");
    expect(meta.openGraph.title).toBe(meta.title);
    expect(meta.openGraph.url).toBe(base.shareUrl);
    expect(meta.canonicalUrl).toBe(base.shareUrl);
    expect(meta.openGraph.type).toBe("video.other");
    expect(meta.siteName).toBe(DOUBLAGE_SITE_NAME);
  });

  it("expose la vignette en og:image et la vidéo en og:video", () => {
    const meta = buildDoublageShareMetadata(base);
    expect(meta.openGraph.images).toEqual([
      { url: "https://cdn.test/thumb.jpg", alt: expect.stringContaining("Réverbérations") },
    ]);
    expect(meta.openGraph.videos).toEqual([
      { url: "https://cdn.test/j1.mp4", type: "video/mp4" },
    ]);
  });

  it("respecte un type MIME vidéo explicite", () => {
    const meta = buildDoublageShareMetadata({ ...base, videoMimeType: "video/webm" });
    expect(meta.openGraph.videos[0]!.type).toBe("video/webm");
  });

  it("carte Twitter = player si vidéo, sinon summary_large_image, sinon summary", () => {
    expect(buildDoublageShareMetadata(base).twitter.card).toBe("player");
    expect(
      buildDoublageShareMetadata({ ...base, videoUrl: null }).twitter.card
    ).toBe("summary_large_image");
    expect(
      buildDoublageShareMetadata({ ...base, videoUrl: null, imageUrl: null }).twitter.card
    ).toBe("summary");
  });

  it("omet image et vidéo quand elles sont absentes", () => {
    const meta = buildDoublageShareMetadata({
      id: "j2",
      extraitTitre: null,
      shareUrl: "https://voxtrait.test/doublage/j2",
    });
    expect(meta.openGraph.images).toEqual([]);
    expect(meta.openGraph.videos).toEqual([]);
    expect(meta.title).toBe(`Doublage sur ${DOUBLAGE_SITE_NAME}`);
  });

  it("marque toujours la page en noindex, follow", () => {
    expect(buildDoublageShareMetadata(base).robots).toEqual({ index: false, follow: true });
  });
});

describe("doublageShareMetadataFromJob", () => {
  it("dérive les métadonnées d'un job rendu public (bout-en-bout, mocks)", async () => {
    const store = createInMemoryDoublageJobStore();
    const created = await store.create(jobInput);
    await runDoublageJob(store, created.id, {
      processor: createMockDoublageProcessor(),
      issuer: createMockSignedUrlIssuer(),
    });
    const published = await publishDoublageJob(store, created.id, {
      baseUrl: "https://voxtrait.test",
    });

    const meta = doublageShareMetadataFromJob(published);
    expect(meta.openGraph.url).toBe(`https://voxtrait.test/doublage/${created.id}`);
    expect(meta.openGraph.images[0]!.url).toBe(jobInput.extraitThumbnail);
    expect(meta.openGraph.videos[0]!.url).toBe(published.downloadUrl);
  });

  it("utilise baseUrl en repli si le job n'a pas encore de shareUrl", () => {
    const meta = doublageShareMetadataFromJob(
      {
        id: "j3",
        status: "pret",
        progress: 1,
        createdAt: "",
        updatedAt: "",
        visibilite: "privee",
        input: { ...jobInput },
      },
      "https://voxtrait.test"
    );
    expect(meta.canonicalUrl).toBe("https://voxtrait.test/doublage/j3");
  });
});

describe("toNextMetadata", () => {
  it("projette vers l'objet Metadata de Next", () => {
    const next = toNextMetadata(
      buildDoublageShareMetadata({
        id: "j1",
        extraitTitre: "Réverbérations",
        shareUrl: "https://voxtrait.test/doublage/j1",
        videoUrl: "https://cdn.test/j1.mp4",
        imageUrl: "https://cdn.test/thumb.jpg",
      })
    );
    expect(next.alternates?.canonical).toBe("https://voxtrait.test/doublage/j1");
    expect(next.robots).toEqual({ index: false, follow: true });
    expect(next.openGraph?.title).toBe(`Réverbérations — doublage sur ${DOUBLAGE_SITE_NAME}`);
    expect(next.twitter).toMatchObject({ card: "player" });
  });
});

describe("buildUnavailableDoublageMetadata", () => {
  it("titre générique et noindex/nofollow", () => {
    const meta = buildUnavailableDoublageMetadata();
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(String(meta.title)).toMatch(/indisponible/i);
  });
});
