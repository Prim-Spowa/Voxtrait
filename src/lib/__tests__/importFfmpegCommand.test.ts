import { describe, expect, it } from "vitest";
import {
  buildImportCompressionFfmpegArgs,
  DEFAULT_IMPORT_COMPRESSION_PROFILE,
  InvalidImportFfmpegCommandError,
  IMPORT_OUTPUT_EXTENSION,
} from "../importFfmpegCommand";

describe("buildImportCompressionFfmpegArgs", () => {
  const ok = { inputPath: "imports/u1/src-abc", outputPath: "out/clip.mp4" };

  it("produit une commande H.264/AAC avec downscale, faststart et sans upscale", () => {
    const args = buildImportCompressionFfmpegArgs(ok);
    expect(args[0]).toBe("-y");
    expect(args).toContain("-i");
    expect(args).toContain("imports/u1/src-abc");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toBe(`scale=-2:'min(${DEFAULT_IMPORT_COMPRESSION_PROFILE.maxHeight},ih)'`);
    expect(args[args.length - 1]).toBe("out/clip.mp4");
  });

  it("insère -t quand une durée maximale de sortie est fournie", () => {
    const args = buildImportCompressionFfmpegArgs({ ...ok, maxDurationSeconds: 300 });
    const i = args.indexOf("-t");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("300");
  });

  it("applique un profil personnalisé (crf, preset, hauteur)", () => {
    const args = buildImportCompressionFfmpegArgs({
      ...ok,
      profile: { crf: 30, preset: "slow", maxHeight: 480 },
    });
    expect(args[args.indexOf("-crf") + 1]).toBe("30");
    expect(args[args.indexOf("-preset") + 1]).toBe("slow");
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=-2:'min(480,ih)'");
  });

  it("rejette un chemin source vide", () => {
    expect(() =>
      buildImportCompressionFfmpegArgs({ ...ok, inputPath: "  " })
    ).toThrow(InvalidImportFfmpegCommandError);
  });

  it(`exige une extension .${IMPORT_OUTPUT_EXTENSION} en sortie`, () => {
    expect(() =>
      buildImportCompressionFfmpegArgs({ ...ok, outputPath: "out/clip.webm" })
    ).toThrow(InvalidImportFfmpegCommandError);
  });

  it("rejette un paramètre de profil non positif", () => {
    expect(() =>
      buildImportCompressionFfmpegArgs({ ...ok, profile: { crf: 0 } })
    ).toThrow(InvalidImportFfmpegCommandError);
  });

  it("rejette une durée maximale de sortie négative", () => {
    expect(() =>
      buildImportCompressionFfmpegArgs({ ...ok, maxDurationSeconds: -1 })
    ).toThrow(InvalidImportFfmpegCommandError);
  });
});
