import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadIntrouvableError, type ImportJob } from "@/lib/import";

const { runFfmpegMock } = vi.hoisted(() => ({ runFfmpegMock: vi.fn() }));
const { readMediaObjectMock, adoptLocalFileMock, generateMediaRefMock } = vi.hoisted(() => ({
  readMediaObjectMock: vi.fn(),
  adoptLocalFileMock: vi.fn(),
  generateMediaRefMock: vi.fn(),
}));

vi.mock("@/lib/media/ffmpegProcess", () => ({ runFfmpeg: runFfmpegMock }));
vi.mock("@/lib/media/localMediaStore", () => ({
  readMediaObject: readMediaObjectMock,
  adoptLocalFileAsMediaObject: adoptLocalFileMock,
  generateMediaRef: generateMediaRefMock,
}));

import { createFfmpegVideoCompressor } from "@/lib/videoCompressor";

function buildJob(overrides: Partial<ImportJob["input"]> = {}): ImportJob {
  return {
    id: "import-1",
    status: "en_traitement",
    progress: 0.05,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    input: {
      objectRef: "imports/user-1/src.mp4",
      utilisateurId: "user-1",
      titre: "Mon extrait",
      origine: "FR",
      type: "FILM",
      dureeSecondes: 60,
      mimeType: "video/mp4",
      sizeBytes: 1000,
      certificationDroitsLe: "2026-01-01T00:00:00.000Z",
      certificationDroitsVersion: "v1",
      ...overrides,
    },
  };
}

describe("createFfmpegVideoCompressor", () => {
  beforeEach(() => {
    runFfmpegMock.mockReset();
    readMediaObjectMock.mockReset();
    adoptLocalFileMock.mockReset();
    generateMediaRefMock.mockReset();
  });

  it("lève UploadIntrouvableError si le fichier source a disparu", async () => {
    readMediaObjectMock.mockResolvedValue(null);
    const compressor = createFfmpegVideoCompressor();
    await expect(compressor.compress(buildJob())).rejects.toThrow(UploadIntrouvableError);
    expect(runFfmpegMock).not.toHaveBeenCalled();
  });

  it("lance ffmpeg avec -progress pipe:1 et adopte la sortie sous une nouvelle ref", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/src.mp4", sizeBytes: 1000 });
    runFfmpegMock.mockResolvedValue({ stdout: "", stderr: "" });
    generateMediaRefMock.mockReturnValue("imports/compressed/user-1/out.mp4");
    adoptLocalFileMock.mockResolvedValue(undefined);

    const onProgress = vi.fn();
    const compressor = createFfmpegVideoCompressor();
    const result = await compressor.compress(buildJob(), onProgress);

    expect(result).toEqual({
      outputRef: "imports/compressed/user-1/out.mp4",
      playbackUrl: "/api/media/play/imports/compressed/user-1/out.mp4",
      mimeType: "video/mp4",
    });

    const [args] = runFfmpegMock.mock.calls[0];
    expect(args[0]).toBe("-progress");
    expect(args[1]).toBe("pipe:1");
    expect(args).toContain("-i");
    expect(generateMediaRefMock).toHaveBeenCalledWith("imports/compressed/user-1", "mp4");
    expect(adoptLocalFileMock).toHaveBeenCalledWith(
      expect.stringContaining("import-1.mp4"),
      "imports/compressed/user-1/out.mp4"
    );
  });

  it("propage l'échec ffmpeg sans adopter de fichier de sortie", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/src.mp4", sizeBytes: 1000 });
    runFfmpegMock.mockRejectedValue(new Error("ffmpeg a échoué (code 1)"));

    const compressor = createFfmpegVideoCompressor();
    await expect(compressor.compress(buildJob())).rejects.toThrow("ffmpeg a échoué");
    expect(adoptLocalFileMock).not.toHaveBeenCalled();
  });
});
