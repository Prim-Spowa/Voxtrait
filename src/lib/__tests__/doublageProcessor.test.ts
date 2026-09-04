import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoublageJob } from "@/lib/doublage";

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

import { createFfmpegDoublageProcessor, DoublageSourceIntrouvableError } from "@/lib/doublageProcessor";

function buildJob(overrides: Partial<DoublageJob["input"]> = {}): DoublageJob {
  return {
    id: "doublage-1",
    status: "en_traitement",
    progress: 0.05,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    visibilite: "privee",
    input: {
      extraitId: "extrait-1",
      videoSourceUrl: "/api/media/play/imports/compressed/user-1/out.mp4",
      audioRef: "doublages/audio/voix.webm",
      audioMimeType: "audio/webm",
      audioSizeBytes: 500,
      audioDurationSeconds: 30,
      audioOffsetSeconds: 0,
      ...overrides,
    },
  };
}

describe("createFfmpegDoublageProcessor", () => {
  beforeEach(() => {
    runFfmpegMock.mockReset();
    readMediaObjectMock.mockReset();
    adoptLocalFileMock.mockReset();
    generateMediaRefMock.mockReset();
  });

  it("lève DoublageSourceIntrouvableError si l'audio est absent du stockage", async () => {
    readMediaObjectMock.mockResolvedValue(null);
    const processor = createFfmpegDoublageProcessor();
    await expect(processor.mix(buildJob())).rejects.toThrow(DoublageSourceIntrouvableError);
    expect(runFfmpegMock).not.toHaveBeenCalled();
  });

  it("résout une videoSourceUrl locale (/api/media/play/...) en chemin disque", async () => {
    readMediaObjectMock.mockImplementation(async (ref: string) => {
      if (ref === "doublages/audio/voix.webm") return { path: "/tmp/voix.webm", sizeBytes: 500 };
      if (ref === "imports/compressed/user-1/out.mp4") {
        return { path: "/tmp/out.mp4", sizeBytes: 2000 };
      }
      return null;
    });
    runFfmpegMock.mockResolvedValue({ stdout: "", stderr: "" });
    generateMediaRefMock.mockReturnValue("doublages/output/mix.mp4");
    adoptLocalFileMock.mockResolvedValue(undefined);

    const processor = createFfmpegDoublageProcessor();
    const result = await processor.mix(buildJob());

    expect(result).toEqual({ outputRef: "doublages/output/mix.mp4", outputMimeType: "video/mp4" });
    const [args] = runFfmpegMock.mock.calls[0];
    expect(args).toContain("/tmp/out.mp4");
    expect(args).toContain("/tmp/voix.webm");
  });

  it("passe une videoSourceUrl http(s) directement à ffmpeg (pas de résolution locale)", async () => {
    readMediaObjectMock.mockImplementation(async (ref: string) =>
      ref === "doublages/audio/voix.webm" ? { path: "/tmp/voix.webm", sizeBytes: 500 } : null
    );
    runFfmpegMock.mockResolvedValue({ stdout: "", stderr: "" });
    generateMediaRefMock.mockReturnValue("doublages/output/mix.mp4");
    adoptLocalFileMock.mockResolvedValue(undefined);

    const processor = createFfmpegDoublageProcessor();
    await processor.mix(
      buildJob({ videoSourceUrl: "https://example.com/videos/sample.mp4" })
    );

    const [args] = runFfmpegMock.mock.calls[0];
    expect(args).toContain("https://example.com/videos/sample.mp4");
  });

  it("rejette une videoSourceUrl locale introuvable dans le stockage", async () => {
    readMediaObjectMock.mockImplementation(async (ref: string) =>
      ref === "doublages/audio/voix.webm" ? { path: "/tmp/voix.webm", sizeBytes: 500 } : null
    );
    const processor = createFfmpegDoublageProcessor();
    await expect(processor.mix(buildJob())).rejects.toThrow(DoublageSourceIntrouvableError);
  });

  it("rejette une videoSourceUrl ni locale ni http(s) (chemin relatif non exploitable)", async () => {
    readMediaObjectMock.mockImplementation(async (ref: string) =>
      ref === "doublages/audio/voix.webm" ? { path: "/tmp/voix.webm", sizeBytes: 500 } : null
    );
    const processor = createFfmpegDoublageProcessor();
    await expect(
      processor.mix(buildJob({ videoSourceUrl: "relative/not-a-url.mp4" }))
    ).rejects.toThrow(DoublageSourceIntrouvableError);
  });
});
