import { beforeEach, describe, expect, it, vi } from "vitest";

const { runFfprobeMock } = vi.hoisted(() => ({ runFfprobeMock: vi.fn() }));
const { readMediaObjectMock } = vi.hoisted(() => ({ readMediaObjectMock: vi.fn() }));

vi.mock("@/lib/media/ffmpegProcess", () => ({ runFfprobe: runFfprobeMock }));
vi.mock("@/lib/media/localMediaStore", () => ({ readMediaObject: readMediaObjectMock }));

import { createFfprobeVideoProbe, mapFfprobeFormatToMimeType } from "@/lib/videoProbe";

describe("mapFfprobeFormatToMimeType", () => {
  it("reconnaît les conteneurs MP4/QuickTime", () => {
    expect(mapFfprobeFormatToMimeType("mov,mp4,m4a,3gp,3g2,mj2")).toBe("video/mp4");
  });
  it("reconnaît WebM/Matroska", () => {
    expect(mapFfprobeFormatToMimeType("matroska,webm")).toBe("video/webm");
  });
  it("reconnaît AVI", () => {
    expect(mapFfprobeFormatToMimeType("avi")).toBe("video/x-msvideo");
  });
  it("retombe sur application/octet-stream pour un format inconnu", () => {
    expect(mapFfprobeFormatToMimeType("flv")).toBe("application/octet-stream");
    expect(mapFfprobeFormatToMimeType(undefined)).toBe("application/octet-stream");
  });
});

describe("createFfprobeVideoProbe", () => {
  beforeEach(() => {
    runFfprobeMock.mockReset();
    readMediaObjectMock.mockReset();
  });

  it("renvoie null si l'objet est absent du stockage", async () => {
    readMediaObjectMock.mockResolvedValue(null);
    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("introuvable.mp4")).resolves.toBeNull();
    expect(runFfprobeMock).not.toHaveBeenCalled();
  });

  it("sonde un fichier présent et renvoie durée/mimeType/taille", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/x.mp4", sizeBytes: 12345 });
    runFfprobeMock.mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: "142.5", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio" }],
      }),
      stderr: "",
    });

    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("imports/user-1/x.mp4")).resolves.toEqual({
      durationSeconds: 142.5,
      mimeType: "video/mp4",
      sizeBytes: 12345,
    });

    expect(runFfprobeMock).toHaveBeenCalledWith(
      expect.arrayContaining(["-show_format", "-show_streams", "/tmp/x.mp4"])
    );
  });

  it("renvoie null si le fichier n'a pas de flux vidéo (ex. fichier audio seul)", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/x.mp3", sizeBytes: 100 });
    runFfprobeMock.mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: "10", format_name: "mp3" },
        streams: [{ codec_type: "audio" }],
      }),
      stderr: "",
    });
    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("x.mp3")).resolves.toBeNull();
  });

  it("renvoie null si la durée est absente/invalide", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/x.mp4", sizeBytes: 100 });
    runFfprobeMock.mockResolvedValue({
      stdout: JSON.stringify({
        format: { format_name: "mp4" },
        streams: [{ codec_type: "video" }],
      }),
      stderr: "",
    });
    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("x.mp4")).resolves.toBeNull();
  });

  it("renvoie null si ffprobe échoue (fichier corrompu/illisible)", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/corrompu.mp4", sizeBytes: 100 });
    runFfprobeMock.mockRejectedValue(new Error("ffmpeg a échoué"));
    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("corrompu.mp4")).resolves.toBeNull();
  });

  it("renvoie null si la sortie ffprobe n'est pas un JSON exploitable", async () => {
    readMediaObjectMock.mockResolvedValue({ path: "/tmp/x.mp4", sizeBytes: 100 });
    runFfprobeMock.mockResolvedValue({ stdout: "pas du json", stderr: "" });
    const probe = createFfprobeVideoProbe();
    await expect(probe.probe("x.mp4")).resolves.toBeNull();
  });
});
