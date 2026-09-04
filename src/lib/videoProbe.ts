/**
 * Sonde vidéo réelle (`ffprobe`) — ST 9.3 « Traitement vidéo réel », découpage
 * en tâches point 2 : « Implémenter la sonde réelle de durée/format (`ffprobe`)
 * pour la validation post-upload (ST 5.1) ».
 *
 * Remplace `createMockUploadedVideoProbe` (`src/lib/mocks/import.mock.ts`) par
 * une implémentation de `UploadedVideoProbe` (`lib/import.ts`) qui interroge
 * réellement le fichier uploadé via `ffprobe -show_format -show_streams
 * -print_format json`. Le fichier est résolu via `localMediaStore.ts` (cf.
 * avertissement en tête de ce module sur le périmètre ST 9.2/ST 9.3).
 */

import { readMediaObject } from "@/lib/media/localMediaStore";
import { runFfprobe } from "@/lib/media/ffmpegProcess";
import type { UploadedVideoProbe } from "@/lib/import";
import type { ProbedVideoMetadata } from "@/lib/importClient";

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
}

interface FfprobeOutput {
  format?: FfprobeFormat;
  streams?: FfprobeStream[];
}

/**
 * Traduit le `format_name` `ffprobe` (souvent une liste de conteneurs
 * compatibles, ex. `"mov,mp4,m4a,3gp,3g2,mj2"`) en type MIME reconnu par
 * `ACCEPTED_IMPORT_MIME_TYPES`/`normalizeVideoMimeType`
 * (`src/lib/importClient.ts`). Repli sur `application/octet-stream` (rejeté
 * par la validation de format) si aucun conteneur connu n'est reconnu — mieux
 * vaut rejeter que deviner un format accepté à tort.
 */
export function mapFfprobeFormatToMimeType(formatName: string | undefined): string {
  const formats = (formatName ?? "").toLowerCase().split(",").map((f) => f.trim());
  if (formats.some((f) => f === "mp4" || f === "mov" || f === "m4a" || f === "3gp")) {
    return "video/mp4";
  }
  if (formats.includes("matroska") || formats.includes("webm")) return "video/webm";
  if (formats.includes("avi")) return "video/x-msvideo";
  if (formats.includes("mpegts")) return "video/mp2t";
  return "application/octet-stream";
}

/** Construit un `UploadedVideoProbe` (`lib/import.ts`) branché sur un vrai `ffprobe`. */
export function createFfprobeVideoProbe(): UploadedVideoProbe {
  return {
    async probe(objectRef): Promise<ProbedVideoMetadata | null> {
      const object = await readMediaObject(objectRef);
      if (!object) return null;

      let stdout: string;
      try {
        ({ stdout } = await runFfprobe([
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          object.path,
        ]));
      } catch {
        // Fichier présent mais illisible par ffprobe (corrompu, pas une
        // vidéo) : traité comme « introuvable/invalide », cohérent avec le
        // contrat `UploadedVideoProbe` (`null` → 404 côté `finalizeImport`,
        // au client on demande de reuploader).
        return null;
      }

      let parsed: FfprobeOutput;
      try {
        parsed = JSON.parse(stdout) as FfprobeOutput;
      } catch {
        return null;
      }

      const hasVideoStream = (parsed.streams ?? []).some((s) => s.codec_type === "video");
      if (!hasVideoStream) return null;

      const durationSeconds = Number(parsed.format?.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

      return {
        durationSeconds,
        mimeType: mapFfprobeFormatToMimeType(parsed.format?.format_name),
        sizeBytes: object.sizeBytes,
      };
    },
  };
}
