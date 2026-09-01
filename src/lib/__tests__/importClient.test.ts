import { describe, expect, it } from "vitest";
import {
  collectImportFormErrors,
  computeNextImportPollDelayMs,
  fileExtension,
  IMPORT_POLL_MAX_DELAY_MS,
  IMPORT_TITRE_MAX_LENGTH,
  isImportFormValid,
  isTerminalImportStatus,
  MAX_IMPORT_DURATION_SECONDS,
  MAX_IMPORT_FILE_BYTES,
  normalizeVideoMimeType,
  suggestTitreFromFilename,
  validateImportUploadRequest,
  validateProbedVideo,
} from "../importClient";

describe("validateImportUploadRequest", () => {
  const ok = {
    filename: "ma-scene.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10 * 1024 * 1024,
  };

  it("accepte un mp4 de taille raisonnable", () => {
    expect(validateImportUploadRequest(ok)).toBeNull();
  });

  it("rejette un nom de fichier vide", () => {
    expect(validateImportUploadRequest({ ...ok, filename: "   " })).toMatch(/nom du fichier/i);
  });

  it("rejette un format non pris en charge (mime + extension)", () => {
    expect(
      validateImportUploadRequest({ ...ok, filename: "clip.avi", mimeType: "video/x-msvideo" })
    ).toMatch(/format/i);
  });

  it("tolère un mime générique si l'extension est reconnue (.mkv)", () => {
    expect(
      validateImportUploadRequest({
        ...ok,
        filename: "clip.mkv",
        mimeType: "application/octet-stream",
      })
    ).toBeNull();
  });

  it("rejette une taille nulle ou négative", () => {
    expect(validateImportUploadRequest({ ...ok, sizeBytes: 0 })).toMatch(/vide/i);
  });

  it("rejette un fichier au-dessus de la taille maximale", () => {
    expect(
      validateImportUploadRequest({ ...ok, sizeBytes: MAX_IMPORT_FILE_BYTES + 1 })
    ).toMatch(/taille maximale/i);
  });
});

describe("validateProbedVideo — durée (DoD : 4:59 vs 5:01)", () => {
  const base = { mimeType: "video/mp4", sizeBytes: 5 * 1024 * 1024 };

  it("accepte exactement la limite (5:00)", () => {
    expect(
      validateProbedVideo({ ...base, durationSeconds: MAX_IMPORT_DURATION_SECONDS })
    ).toEqual({ ok: true });
  });

  it("accepte 4:59 (299 s)", () => {
    expect(validateProbedVideo({ ...base, durationSeconds: 299 })).toEqual({ ok: true });
  });

  it("rejette 5:01 (301 s), sans tolérance", () => {
    const verdict = validateProbedVideo({ ...base, durationSeconds: 301 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/durée maximale/i);
  });

  it("rejette une durée nulle ou non finie", () => {
    expect(validateProbedVideo({ ...base, durationSeconds: 0 }).ok).toBe(false);
    expect(validateProbedVideo({ ...base, durationSeconds: NaN }).ok).toBe(false);
  });
});

describe("validateProbedVideo — format et taille réels", () => {
  it("rejette un conteneur non vidéo", () => {
    const verdict = validateProbedVideo({
      durationSeconds: 60,
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/format réel/i);
  });

  it("rejette une taille réelle au-dessus de la limite", () => {
    const verdict = validateProbedVideo({
      durationSeconds: 60,
      mimeType: "video/mp4",
      sizeBytes: MAX_IMPORT_FILE_BYTES + 1,
    });
    expect(verdict.ok).toBe(false);
  });

  it("normalise le paramètre ;codecs=... du mime", () => {
    expect(
      validateProbedVideo({
        durationSeconds: 60,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        sizeBytes: 1024,
      })
    ).toEqual({ ok: true });
  });
});

describe("collectImportFormErrors", () => {
  const ok = { titre: "Ma scène préférée", origine: "FR", type: "FILM" };

  it("ne remonte rien pour une entrée valide", () => {
    expect(collectImportFormErrors(ok)).toEqual({});
    expect(isImportFormValid(ok)).toBe(true);
  });

  it("exige un titre non vide", () => {
    expect(collectImportFormErrors({ ...ok, titre: " " }).titre).toBeTruthy();
  });

  it("rejette un titre trop long", () => {
    expect(
      collectImportFormErrors({ ...ok, titre: "x".repeat(IMPORT_TITRE_MAX_LENGTH + 1) }).titre
    ).toMatch(/dépasser/i);
  });

  it("rejette une origine ou un type inconnus", () => {
    const errs = collectImportFormErrors({ ...ok, origine: "DE", type: "CLIP" });
    expect(errs.origine).toBeTruthy();
    expect(errs.type).toBeTruthy();
  });
});

describe("helpers", () => {
  it("normalizeVideoMimeType retire le paramètre codecs et met en minuscules", () => {
    expect(normalizeVideoMimeType("VIDEO/MP4; codecs=avc1")).toBe("video/mp4");
  });

  it("fileExtension renvoie l'extension en minuscule avec le point", () => {
    expect(fileExtension("Film.FINAL.MOV")).toBe(".mov");
    expect(fileExtension("sans-extension")).toBe("");
  });

  it("suggestTitreFromFilename nettoie séparateurs et extension", () => {
    expect(suggestTitreFromFilename("ma_scene-finale.v2.mp4")).toBe("ma scene finale v2");
  });

  it("isTerminalImportStatus : pret et echec sont terminaux", () => {
    expect(isTerminalImportStatus("pret")).toBe(true);
    expect(isTerminalImportStatus("echec")).toBe(true);
    expect(isTerminalImportStatus("en_traitement")).toBe(false);
  });

  it("computeNextImportPollDelayMs : back-off borné", () => {
    expect(computeNextImportPollDelayMs(0)).toBe(1500);
    expect(computeNextImportPollDelayMs(1)).toBe(3000);
    expect(computeNextImportPollDelayMs(50)).toBe(IMPORT_POLL_MAX_DELAY_MS);
    expect(computeNextImportPollDelayMs(-3)).toBe(1500);
  });
});
