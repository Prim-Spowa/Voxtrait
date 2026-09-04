/**
 * Exécution réelle des binaires `ffmpeg`/`ffprobe` — ST 9.3 « Traitement vidéo
 * réel (ffprobe/FFmpeg) et file de jobs réelle », découpage en tâches, points 1
 * (installation/documentation du binaire) et 2-3 (sonde/compression réelles).
 *
 * Seul module du projet qui `spawn` réellement ces binaires. Tout le reste
 * (construction des arguments : `lib/ffmpegCommand.ts`, `lib/importFfmpegCommand.ts` ;
 * lecture des métadonnées : `lib/videoProbe.ts` ; pilotage des jobs :
 * `lib/videoCompressor.ts`, `lib/doublageProcessor.ts`) reste séparé de
 * l'exécution — même principe que le reste du code serveur (cf. tête de
 * `src/lib/import.ts`).
 *
 * Chemins des binaires configurables (`FFMPEG_PATH`/`FFPROBE_PATH`) pour les
 * environnements où ils ne sont pas sur le `PATH` (image Docker dédiée,
 * installation locale à un chemin non standard) — repli sur `"ffmpeg"`/
 * `"ffprobe"` (résolution via le `PATH`), documenté dans `.env.example` et le
 * README (installation du binaire, point 1 du découpage en tâches).
 */

import { spawn } from "node:child_process";

/** Chemin du binaire `ffmpeg` — `FFMPEG_PATH`, ou `"ffmpeg"` (résolu via le `PATH`). */
export function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/** Chemin du binaire `ffprobe` — `FFPROBE_PATH`, ou `"ffprobe"` (résolu via le `PATH`). */
export function resolveFfprobePath(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

/**
 * Levée quand le binaire est introuvable (`ENOENT`) ou termine en échec
 * (code de sortie non nul). Le message technique (chemin, code, `stderr`)
 * reste côté serveur — les appelants (`videoProbe.ts`, `videoCompressor.ts`,
 * `doublageProcessor.ts`) le convertissent en erreur générique utilisateur,
 * comme le reste du projet (cf. `runImportJob`/`runDoublageJob`).
 */
export class FfmpegProcessError extends Error {
  readonly binary: string;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(binary: string, exitCode: number | null, stderr: string) {
    super(
      `${binary} a échoué (code ${exitCode ?? "inconnu"}) : ${stderr.slice(-2000) || "(pas de sortie d'erreur)"}`
    );
    this.name = "FfmpegProcessError";
    this.binary = binary;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface RunProcessOptions {
  /** Délai maximal d'exécution en ms avant `SIGKILL` (défaut : 10 min). */
  timeoutMs?: number;
  /** Reçoit chaque ligne de `stdout` au fil de l'eau (ex. `-progress pipe:1`). */
  onStdoutLine?: (line: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Lance un binaire et attend sa fin. Rejette avec `FfmpegProcessError` sur
 * code de sortie non nul, timeout (le process est alors tué), ou binaire
 * introuvable. Utilisé aussi bien pour `ffprobe` (sortie JSON complète,
 * `onStdoutLine` non utilisé) que pour `ffmpeg` (`-progress pipe:1`,
 * `onStdoutLine` alimente `parseFfmpegProgressLine`, cf. `ffmpegProgress.ts`).
 */
export function runProcess(
  binary: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, onStdoutLine } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, { windowsHide: true });
    } catch (err) {
      reject(
        new FfmpegProcessError(binary, null, err instanceof Error ? err.message : String(err))
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutTail = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      settled = true;
      reject(
        new FfmpegProcessError(binary, null, `délai dépassé (${timeoutMs}ms) — process tué`)
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (!onStdoutLine) return;
      stdoutTail += text;
      const lines = stdoutTail.split("\n");
      stdoutTail = lines.pop() ?? "";
      for (const line of lines) onStdoutLine(line);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // `ENOENT` : binaire absent du PATH — message explicite plutôt que la
      // trace Node brute, pour guider vers l'installation (README).
      const notFound = (err as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new FfmpegProcessError(
          binary,
          null,
          notFound
            ? `binaire introuvable ("${binary}") — vérifier l'installation de FFmpeg/ffprobe et FFMPEG_PATH/FFPROBE_PATH`
            : err.message
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onStdoutLine && stdoutTail) onStdoutLine(stdoutTail);
      if (code !== 0) {
        reject(new FfmpegProcessError(binary, code, stderr));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Lance `ffprobe` avec les arguments donnés. */
export function runFfprobe(args: string[], options?: RunProcessOptions) {
  return runProcess(resolveFfmpegBinaryOrThrow(resolveFfprobePath()), args, options);
}

/** Lance `ffmpeg` avec les arguments donnés. */
export function runFfmpeg(args: string[], options?: RunProcessOptions) {
  return runProcess(resolveFfmpegBinaryOrThrow(resolveFfmpegPath()), args, options);
}

function resolveFfmpegBinaryOrThrow(path: string): string {
  if (!path.trim()) {
    throw new FfmpegProcessError(path, null, "chemin de binaire vide");
  }
  return path;
}
