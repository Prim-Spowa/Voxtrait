/**
 * Adaptateurs mock pour l'export du doublage (ST 3.1) — utilisés quand
 * `DATA_SOURCE=mock` (cf. `src/lib/config.ts`) et dans les tests, à la place
 * d'un vrai worker FFmpeg / client S3 (absents du projet, cf. avertissement en
 * tête de `src/lib/doublage.ts`).
 *
 * - `createMockDoublageProcessor` : ne lance pas FFmpeg ; simule un traitement
 *   (progression + délai optionnel) et renvoie une référence de sortie factice.
 *   Peut être configuré pour échouer, afin d'exercer le chemin `status: "echec"`.
 * - `createMockSignedUrlIssuer` : fabrique une URL de type `data:`/`blob:`-like
 *   factice avec une date d'expiration calculée — aucune signature réelle.
 * - `getDoublageJobStore` : singleton de `DoublageJobStore` en mémoire, partagé
 *   entre `POST /api/doublages` et `GET /api/doublages/:id` au sein d'un même
 *   process (`next dev`).
 */

import {
  buildDoublageFfmpegArgs,
  DEFAULT_MIX_MODE,
  DOUBLAGE_OUTPUT_MIME_TYPE,
} from "@/lib/ffmpegCommand";
import {
  createInMemoryDoublageJobStore,
  type DoublageJobStore,
  type DoublageProcessor,
  type SignedUrlIssuer,
} from "@/lib/doublage";

export interface MockProcessorOptions {
  /** Délai simulé du « mixage », en ms (défaut : 0 — résolution immédiate). */
  delayMs?: number;
  /** Force un échec du traitement, pour tester le chemin `status: "echec"`. */
  fail?: boolean;
  /** Étapes de progression remontées via `onProgress` (défaut : 0.3, 0.6, 0.9). */
  progressSteps?: number[];
}

export function createMockDoublageProcessor(
  options: MockProcessorOptions = {}
): DoublageProcessor {
  const { delayMs = 0, fail = false, progressSteps = [0.3, 0.6, 0.9] } = options;

  return {
    async mix(job, onProgress) {
      // On construit tout de même les arguments FFmpeg : cela vérifie au
      // passage que les entrées du job sont exploitables (chemins non vides,
      // extension de sortie), même si on ne lance pas le binaire.
      const outputRef = `mock-output/${job.id}.mp4`;
      buildDoublageFfmpegArgs({
        videoInputPath: job.input.videoSourceUrl,
        audioInputPath: job.input.audioRef,
        outputPath: outputRef,
        mode: job.input.mode ?? DEFAULT_MIX_MODE,
        audioOffsetSeconds: job.input.audioOffsetSeconds,
      });

      for (const step of progressSteps) {
        onProgress?.(step);
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (fail) {
        throw new Error("Échec simulé du mixage FFmpeg (mock).");
      }

      return { outputRef, outputMimeType: DOUBLAGE_OUTPUT_MIME_TYPE };
    },
  };
}

export function createMockSignedUrlIssuer(
  now: () => Date = () => new Date()
): SignedUrlIssuer {
  return {
    async issue(outputRef, ttlSeconds) {
      const expiresAt = new Date(now().getTime() + ttlSeconds * 1000).toISOString();
      // URL factice : en production ce serait une URL S3 pré-signée. Le
      // paramètre `sig` imite la signature, `exp` l'expiration.
      const url = `/api/doublages/mock-download/${encodeURIComponent(outputRef)}?sig=mock&exp=${encodeURIComponent(expiresAt)}`;
      return { url, expiresAt };
    },
  };
}

// --- Singleton store partagé entre les deux routes API -----------------

const globalForDoublage = globalThis as unknown as {
  doublageJobStore?: DoublageJobStore;
};

/**
 * Store de jobs partagé au sein d'un process. Le pattern `globalThis` évite
 * qu'un hot-reload de module Next.js n'en recrée un nouveau (même raison que
 * le singleton Prisma dans `src/lib/prisma.ts`).
 */
export function getDoublageJobStore(): DoublageJobStore {
  if (!globalForDoublage.doublageJobStore) {
    globalForDoublage.doublageJobStore = createInMemoryDoublageJobStore();
  }
  return globalForDoublage.doublageJobStore;
}
