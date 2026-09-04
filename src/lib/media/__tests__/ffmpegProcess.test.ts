import { describe, expect, it } from "vitest";
import {
  FfmpegProcessError,
  resolveFfmpegPath,
  resolveFfprobePath,
  runProcess,
} from "@/lib/media/ffmpegProcess";

// Ces tests n'exécutent jamais réellement `ffmpeg`/`ffprobe` (absents de cet
// environnement de développement, cf. notes de dev) : `runProcess` est
// générique, on le vérifie avec `node` lui-même comme "binaire" (toujours
// disponible dans l'environnement de test) en lui passant des scripts `-e`
// triviaux. Le branchement sur les vrais binaires (résolution du chemin,
// arguments FFmpeg) est couvert séparément par `videoProbe`/`videoCompressor`/
// `doublageProcessor` (mockant `runFfmpeg`/`runFfprobe`) et par les tests
// d'intégration ST 9.3 (nécessitent un vrai FFmpeg).

const node = process.execPath;

describe("resolveFfmpegPath / resolveFfprobePath", () => {
  it("retombe sur les noms de binaire par défaut hors configuration", () => {
    expect(resolveFfmpegPath()).toBe("ffmpeg");
    expect(resolveFfprobePath()).toBe("ffprobe");
  });
});

describe("runProcess", () => {
  it("résout stdout/stderr sur un code de sortie 0", async () => {
    const { stdout } = await runProcess(node, [
      "-e",
      "process.stdout.write('bonjour'); process.exit(0);",
    ]);
    expect(stdout).toBe("bonjour");
  });

  it("rejette avec FfmpegProcessError sur un code de sortie non nul", async () => {
    await expect(
      runProcess(node, ["-e", "process.stderr.write('boom'); process.exit(2);"])
    ).rejects.toMatchObject({ name: "FfmpegProcessError", exitCode: 2 });
  });

  it("rejette avec un message explicite si le binaire est introuvable (ENOENT)", async () => {
    await expect(runProcess("binaire-qui-nexiste-pas-xyz", [])).rejects.toThrow(
      FfmpegProcessError
    );
    await expect(runProcess("binaire-qui-nexiste-pas-xyz", [])).rejects.toThrow(/introuvable/);
  });

  it("appelle onStdoutLine pour chaque ligne complète de stdout", async () => {
    const lines: string[] = [];
    await runProcess(
      node,
      ["-e", "process.stdout.write('a\\nb\\nc'); process.exit(0);"],
      { onStdoutLine: (line) => lines.push(line) }
    );
    // "c" n'est jamais suivi de "\n" mais doit tout de même être livré à la
    // clôture du process (dernier fragment, cf. `runProcess`).
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("tue le process et rejette après le délai imparti", async () => {
    await expect(
      runProcess(node, ["-e", "setTimeout(() => {}, 10000);"], { timeoutMs: 100 })
    ).rejects.toMatchObject({ name: "FfmpegProcessError" });
  }, 10000);
});
