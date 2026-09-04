import { describe, expect, it, vi } from "vitest";
import { createFfmpegProgressTracker, parseFfmpegProgressLine } from "@/lib/media/ffmpegProgress";

describe("parseFfmpegProgressLine", () => {
  it("découpe une ligne clé=valeur", () => {
    expect(parseFfmpegProgressLine("out_time_ms=1500000")).toEqual({
      key: "out_time_ms",
      value: "1500000",
    });
  });

  it("gère les espaces superflus", () => {
    expect(parseFfmpegProgressLine("  progress = end  ")).toEqual({
      key: "progress",
      value: "end",
    });
  });

  it("renvoie null pour une ligne vide ou sans '='", () => {
    expect(parseFfmpegProgressLine("")).toBeNull();
    expect(parseFfmpegProgressLine("frame=120")).toEqual({ key: "frame", value: "120" });
    expect(parseFfmpegProgressLine("pas de signe egal")).toBeNull();
  });
});

describe("createFfmpegProgressTracker", () => {
  it("calcule la fraction out_time_ms / durée totale, bornée à [0.05, 0.95]", () => {
    const onProgress = vi.fn();
    const track = createFfmpegProgressTracker(100, onProgress);

    track("out_time_ms=10000000"); // 10s / 100s = 0.10
    expect(onProgress).toHaveBeenLastCalledWith(0.1);

    track("out_time_ms=200000000"); // 200s / 100s = 2.0 → borné à 0.95
    expect(onProgress).toHaveBeenLastCalledWith(0.95);

    track("out_time_ms=100"); // ~0.0001 → borné à 0.05
    expect(onProgress).toHaveBeenLastCalledWith(0.05);
  });

  it("ignore les lignes qui ne sont pas out_time_ms", () => {
    const onProgress = vi.fn();
    const track = createFfmpegProgressTracker(100, onProgress);
    track("frame=42");
    track("progress=continue");
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("n'appelle jamais onProgress si la durée totale est invalide/absente", () => {
    const onProgress = vi.fn();
    createFfmpegProgressTracker(0, onProgress)("out_time_ms=1000000");
    createFfmpegProgressTracker(NaN, onProgress)("out_time_ms=1000000");
    createFfmpegProgressTracker(-5, onProgress)("out_time_ms=1000000");
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("ne lève pas si onProgress est absent", () => {
    const track = createFfmpegProgressTracker(100, undefined);
    expect(() => track("out_time_ms=5000000")).not.toThrow();
  });
});
