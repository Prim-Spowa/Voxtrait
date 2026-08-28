import { describe, expect, it } from "vitest";
import {
  buildDoublageFfmpegArgs,
  InvalidFfmpegCommandError,
} from "../ffmpegCommand";

// ST 3.1, Definition of Done : « Tests unitaires sur la construction de la
// commande FFmpeg (mockée) ». La fonction ne lance pas FFmpeg — on vérifie
// uniquement la liste d'arguments produite.

const base = {
  videoInputPath: "/tmp/video.mp4",
  audioInputPath: "/tmp/voix.webm",
  outputPath: "/tmp/out.mp4",
};

describe("buildDoublageFfmpegArgs", () => {
  it("mode « remplacer » (défaut) : mappe la vidéo d'origine et la voix, ignore l'audio d'origine", () => {
    const args = buildDoublageFfmpegArgs(base);
    expect(args).toEqual([
      "-y",
      "-i",
      "/tmp/video.mp4",
      "-i",
      "/tmp/voix.webm",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      "/tmp/out.mp4",
    ]);
  });

  it("copie la piste vidéo sans ré-encodage (-c:v copy) pour limiter le coût CPU", () => {
    const args = buildDoublageFfmpegArgs(base);
    const i = args.indexOf("-c:v");
    expect(args[i + 1]).toBe("copy");
  });

  it("mode « remplacer » avec offset : décale l'entrée voix via -itsoffset avant son -i", () => {
    const args = buildDoublageFfmpegArgs({ ...base, audioOffsetSeconds: 2.5 });
    expect(args.join(" ")).toContain("-i /tmp/video.mp4 -itsoffset 2.5 -i /tmp/voix.webm");
  });

  it("mode « superposer » : construit un filter_complex amix des deux pistes", () => {
    const args = buildDoublageFfmpegArgs({ ...base, mode: "superposer" });
    const i = args.indexOf("-filter_complex");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toContain("amix=inputs=2");
    expect(args).toContain("[aout]");
  });

  it("mode « superposer » avec offset : insère un adelay sur la voix", () => {
    const args = buildDoublageFfmpegArgs({
      ...base,
      mode: "superposer",
      audioOffsetSeconds: 1.2,
    });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("adelay=1200|1200");
  });

  it("rejette une vidéo source vide", () => {
    expect(() => buildDoublageFfmpegArgs({ ...base, videoInputPath: "  " })).toThrow(
      InvalidFfmpegCommandError
    );
  });

  it("rejette un audio source vide", () => {
    expect(() => buildDoublageFfmpegArgs({ ...base, audioInputPath: "" })).toThrow(
      InvalidFfmpegCommandError
    );
  });

  it("rejette une sortie qui n'est pas un .mp4", () => {
    expect(() => buildDoublageFfmpegArgs({ ...base, outputPath: "/tmp/out.mkv" })).toThrow(
      /\.mp4/
    );
  });

  it("rejette un offset négatif ou non fini", () => {
    expect(() => buildDoublageFfmpegArgs({ ...base, audioOffsetSeconds: -1 })).toThrow(
      InvalidFfmpegCommandError
    );
    expect(() => buildDoublageFfmpegArgs({ ...base, audioOffsetSeconds: NaN })).toThrow(
      InvalidFfmpegCommandError
    );
  });

  it("est pure : deux appels identiques produisent des tableaux égaux mais distincts", () => {
    const a = buildDoublageFfmpegArgs(base);
    const b = buildDoublageFfmpegArgs(base);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
