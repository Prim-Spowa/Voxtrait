/**
 * Compression vidéo réelle (`ffmpeg`) — ST 9.3, découpage en tâches point 3 :
 * « Implémenter la compression réelle à l'import (transcodage MP4 H.264/AAC
 * ≤ 720p, ST 5.1) [...] ».
 *
 * Remplace `createMockVideoCompressor` (`src/lib/mocks/import.mock.ts`) par une
 * implémentation de `VideoCompressor` (`lib/import.ts`) qui lance réellement
 * `ffmpeg` avec les arguments de `buildImportJobFfmpegArgs`
 * (`lib/importFfmpegCommand.ts`, inchangé). Le fichier source est résolu via
 * `localMediaStore.ts` (cf. avertissement de périmètre en tête de ce module) ;
 * la sortie y est écrite sous une nouvelle ref et exposée via l'URL de lecture
 * permanente (`resolveLocalPersistentPlaybackUrl`).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildImportJobFfmpegArgs,
  UploadIntrouvableError,
  type ImportJob,
  type VideoCompressor,
} from "@/lib/import";
import { runFfmpeg } from "@/lib/media/ffmpegProcess";
import { createFfmpegProgressTracker } from "@/lib/media/ffmpegProgress";
import { adoptLocalFileAsMediaObject, generateMediaRef, readMediaObject } from "@/lib/media/localMediaStore";
import { resolveLocalPersistentPlaybackUrl } from "@/lib/media/localObjectStorageAdapters";
import { IMPORT_OUTPUT_MIME_TYPE } from "@/lib/importFfmpegCommand";

/** Construit un `VideoCompressor` (`lib/import.ts`) branché sur un vrai `ffmpeg`. */
export function createFfmpegVideoCompressor(): VideoCompressor {
  return {
    async compress(job: ImportJob, onProgress) {
      const source = await readMediaObject(job.input.objectRef);
      if (!source) {
        // Le fichier a disparu entre la validation (`finalizeImport`) et
        // l'exécution du job (purge concurrente, incident de stockage) : pas
        // de fichier à compresser. `runImportJob` capture et convertit en
        // `status: "echec"`.
        throw new UploadIntrouvableError();
      }

      const workDir = await mkdtemp(path.join(tmpdir(), "doublage-import-"));
      const tmpOutputPath = path.join(workDir, `${job.id}.mp4`);

      try {
        const args = buildImportJobFfmpegArgs(job, tmpOutputPath);
        const onStdoutLine = createFfmpegProgressTracker(job.input.dureeSecondes, onProgress);

        await runFfmpeg(["-progress", "pipe:1", "-nostats", ...args], { onStdoutLine });

        const outputRef = generateMediaRef(
          `imports/compressed/${job.input.utilisateurId}`,
          "mp4"
        );
        await adoptLocalFileAsMediaObject(tmpOutputPath, outputRef);

        return {
          outputRef,
          playbackUrl: resolveLocalPersistentPlaybackUrl(outputRef),
          mimeType: IMPORT_OUTPUT_MIME_TYPE,
        };
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {
          /* nettoyage best-effort du répertoire de travail temporaire */
        });
      }
    },
  };
}
