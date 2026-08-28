import { describe, expect, it } from "vitest";
import {
  buildDoublageDownloadFilename,
  computeNextPollDelayMs,
  DOUBLAGE_POLL_MAX_DELAY_MS,
  DOUBLAGE_POLL_MIN_DELAY_MS,
  isTerminalDoublageStatus,
  MAX_DOUBLAGE_AUDIO_BYTES,
  MAX_DOUBLAGE_DURATION_SECONDS,
  normalizeAudioMimeType,
  shouldTriggerDownload,
  validateDoublageRequest,
  type DoublageJobView,
} from "../doublageClient";

// ST 3.1 — logique client-safe : validation de la requête d'export, stratégie
// de polling, déclenchement du téléchargement, nom de fichier.

const validMeta = {
  extraitId: "mock-002",
  audioMimeType: "audio/webm;codecs=opus",
  audioSizeBytes: 500_000,
  audioDurationSeconds: 12,
};

describe("validateDoublageRequest", () => {
  it("accepte une requête valide", () => {
    expect(validateDoublageRequest(validMeta)).toBeNull();
  });

  it("rejette un extraitId manquant", () => {
    expect(validateDoublageRequest({ ...validMeta, extraitId: "  " })).toMatch(/extrait/i);
  });

  it("rejette un type MIME audio non supporté", () => {
    expect(validateDoublageRequest({ ...validMeta, audioMimeType: "video/mp4" })).toMatch(
      /format/i
    );
  });

  it("accepte les types MIME avec paramètre codecs", () => {
    expect(
      validateDoublageRequest({ ...validMeta, audioMimeType: "audio/mp4;codecs=mp4a.40.2" })
    ).toBeNull();
  });

  it("rejette un blob vide", () => {
    expect(validateDoublageRequest({ ...validMeta, audioSizeBytes: 0 })).toMatch(/vide|illisible/i);
  });

  it("rejette un blob au-dessus de la taille maximale", () => {
    expect(
      validateDoublageRequest({ ...validMeta, audioSizeBytes: MAX_DOUBLAGE_AUDIO_BYTES + 1 })
    ).toMatch(/taille/i);
  });

  it("rejette une durée nulle ou négative", () => {
    expect(validateDoublageRequest({ ...validMeta, audioDurationSeconds: 0 })).toMatch(/durée/i);
  });

  it("rejette une durée au-delà des 5 minutes (hors tolérance)", () => {
    expect(
      validateDoublageRequest({
        ...validMeta,
        audioDurationSeconds: MAX_DOUBLAGE_DURATION_SECONDS + 5,
      })
    ).toMatch(/5 minutes/);
  });

  it("tolère un léger dépassement de durée (imprécision de mesure navigateur)", () => {
    expect(
      validateDoublageRequest({
        ...validMeta,
        audioDurationSeconds: MAX_DOUBLAGE_DURATION_SECONDS + 0.5,
      })
    ).toBeNull();
  });
});

describe("normalizeAudioMimeType", () => {
  it("retire le paramètre codecs et met en minuscules", () => {
    expect(normalizeAudioMimeType("AUDIO/WEBM;codecs=opus")).toBe("audio/webm");
  });
  it("gère une valeur vide", () => {
    expect(normalizeAudioMimeType("")).toBe("");
  });
});

describe("computeNextPollDelayMs", () => {
  it("commence au délai minimal", () => {
    expect(computeNextPollDelayMs(0)).toBe(DOUBLAGE_POLL_MIN_DELAY_MS);
  });

  it("double à chaque tentative", () => {
    expect(computeNextPollDelayMs(1)).toBe(DOUBLAGE_POLL_MIN_DELAY_MS * 2);
    expect(computeNextPollDelayMs(2)).toBe(DOUBLAGE_POLL_MIN_DELAY_MS * 4);
  });

  it("est borné au délai maximal", () => {
    expect(computeNextPollDelayMs(100)).toBe(DOUBLAGE_POLL_MAX_DELAY_MS);
  });

  it("traite une tentative négative/invalide comme 0", () => {
    expect(computeNextPollDelayMs(-3)).toBe(DOUBLAGE_POLL_MIN_DELAY_MS);
    expect(computeNextPollDelayMs(NaN)).toBe(DOUBLAGE_POLL_MIN_DELAY_MS);
  });
});

describe("isTerminalDoublageStatus", () => {
  it("pret et echec sont terminaux", () => {
    expect(isTerminalDoublageStatus("pret")).toBe(true);
    expect(isTerminalDoublageStatus("echec")).toBe(true);
  });
  it("en_attente et en_traitement ne le sont pas", () => {
    expect(isTerminalDoublageStatus("en_attente")).toBe(false);
    expect(isTerminalDoublageStatus("en_traitement")).toBe(false);
  });
});

describe("shouldTriggerDownload", () => {
  const ready: DoublageJobView = {
    id: "j1",
    status: "pret",
    progress: 1,
    downloadUrl: "/dl/j1",
  };

  it("déclenche au passage à pret avec une URL", () => {
    expect(shouldTriggerDownload({ ...ready, status: "en_traitement", downloadUrl: undefined }, ready)).toBe(
      true
    );
    expect(shouldTriggerDownload(null, ready)).toBe(true);
  });

  it("ne re-déclenche pas si l'état précédent était déjà pret", () => {
    expect(shouldTriggerDownload(ready, ready)).toBe(false);
  });

  it("ne déclenche pas sans URL de téléchargement", () => {
    expect(shouldTriggerDownload(null, { ...ready, downloadUrl: undefined })).toBe(false);
  });

  it("ne déclenche pas pour un échec", () => {
    expect(
      shouldTriggerDownload(null, { id: "j1", status: "echec", progress: 1, error: "boom" })
    ).toBe(false);
  });
});

describe("buildDoublageDownloadFilename", () => {
  it("slugifie le titre de l'extrait et suffixe -doublage.mp4", () => {
    expect(buildDoublageDownloadFilename("L'Odyssée Stellaire — Pilote", "job-123")).toBe(
      "l-odyssee-stellaire-pilote-doublage.mp4"
    );
  });

  it("retombe sur l'id du job si le titre est vide", () => {
    expect(buildDoublageDownloadFilename("", "job-123")).toBe("doublage-job-123.mp4");
    expect(buildDoublageDownloadFilename("   ", "abc")).toBe("doublage-abc.mp4");
  });

  it("produit toujours un .mp4", () => {
    expect(buildDoublageDownloadFilename("!!!", "###")).toMatch(/\.mp4$/);
  });
});
