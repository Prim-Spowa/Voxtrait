/**
 * Adaptateurs mock pour l'import de vidéos personnelles (ST 5.1) — utilisés
 * quand `DATA_SOURCE=mock` (cf. `src/lib/config.ts`) et dans les tests, à la
 * place d'un vrai client S3 / `ffprobe` / worker FFmpeg (absents du projet, cf.
 * avertissement en tête de `src/lib/import.ts`).
 *
 * - `createMockSignedUploadUrlIssuer` : fabrique une URL d'upload factice
 *   (aucune signature réelle) avec expiration calculée.
 * - `createMockUploadedVideoProbe` : renvoie des métadonnées configurables
 *   (durée, type, taille) par référence d'objet — ou `null` pour simuler un
 *   fichier introuvable. Sert à exercer les chemins « 4:59 accepté » /
 *   « 5:01 rejeté » de la DoD.
 * - `createMockObjectStorageCleaner` : enregistre les références supprimées
 *   (les tests vérifient que le fichier rejeté est bien nettoyé).
 * - `createMockVideoCompressor` : ne lance pas FFmpeg ; construit tout de même
 *   les arguments (`buildImportJobFfmpegArgs`) pour valider les entrées du job,
 *   simule une progression, renvoie une URL de lecture factice. Peut échouer
 *   sur demande.
 * - `createInMemoryExtraitLibraryWriter` : `ExtraitLibraryWriter` en mémoire
 *   (les tests inspectent `created`). En mode mock d'exécution, le singleton
 *   `getMockImportLibraryWriter` conserve les extraits importés le temps du
 *   process.
 * - `getImportJobStore` : store partagé entre `POST /api/import` et
 *   `GET /api/import/:id` — en mémoire par process en mode mock/test, adossé à
 *   Redis sinon (`createRedisImportJobStore`, ST 9.3 : nécessaire dès que le
 *   worker de compression tourne dans un process séparé, cf.
 *   `redisConnection.ts`).
 */

import {
  buildImportJobFfmpegArgs,
  createInMemoryImportJobStore,
  type ExtraitLibraryWriter,
  type ImportJob,
  type ImportJobInput,
  type ImportJobStore,
  type ObjectStorageCleaner,
  type SignedUploadUrlIssuer,
  type UploadedVideoProbe,
  type VideoCompressor,
} from "@/lib/import";
import type { ProbedVideoMetadata } from "@/lib/importClient";
import { isMockDataSource } from "@/lib/config";
import { getRedisClient } from "@/lib/media/redisConnection";
import { createRedisJobStore } from "@/lib/media/redisJobStore";

/* -------------------------------------------------------------------------- */
/*  URL signée                                                                 */
/* -------------------------------------------------------------------------- */

export function createMockSignedUploadUrlIssuer(
  now: () => Date = () => new Date()
): SignedUploadUrlIssuer {
  return {
    async issue({ objectRef, contentType, ttlSeconds }) {
      const expiresAt = new Date(now().getTime() + ttlSeconds * 1000).toISOString();
      return {
        // URL factice : en production ce serait une URL S3 pré-signée (PUT).
        uploadUrl: `/api/import/mock-upload/${encodeURIComponent(objectRef)}?sig=mock&exp=${encodeURIComponent(expiresAt)}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Sonde vidéo                                                                */
/* -------------------------------------------------------------------------- */

export interface MockProbeOptions {
  /** Métadonnées par défaut renvoyées pour toute référence inconnue du `byRef`. */
  default?: Partial<ProbedVideoMetadata> | null;
  /** Métadonnées spécifiques par référence d'objet (priorité sur `default`). */
  byRef?: Record<string, Partial<ProbedVideoMetadata> | null>;
}

const PROBE_DEFAULTS: ProbedVideoMetadata = {
  durationSeconds: 120,
  mimeType: "video/mp4",
  sizeBytes: 8 * 1024 * 1024,
};

/**
 * `null` explicite (au niveau `default` ou d'une entrée `byRef`) simule un
 * objet introuvable dans le stockage → `UploadIntrouvableError` côté
 * `finalizeImport`.
 */
export function createMockUploadedVideoProbe(
  options: MockProbeOptions = {}
): UploadedVideoProbe {
  return {
    async probe(objectRef) {
      const hasRef =
        options.byRef !== undefined &&
        Object.prototype.hasOwnProperty.call(options.byRef, objectRef);
      const entry = hasRef ? options.byRef![objectRef] : options.default;

      if (entry === null) return null;
      if (entry === undefined) return { ...PROBE_DEFAULTS };
      return { ...PROBE_DEFAULTS, ...entry };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Nettoyage stockage                                                         */
/* -------------------------------------------------------------------------- */

export interface RecordingObjectStorageCleaner extends ObjectStorageCleaner {
  /** Références passées à `delete`, dans l'ordre d'appel. */
  readonly deleted: readonly string[];
}

export function createMockObjectStorageCleaner(
  options: { failOn?: readonly string[] } = {}
): RecordingObjectStorageCleaner {
  const deleted: string[] = [];
  const failOn = new Set(options.failOn ?? []);
  return {
    deleted,
    async delete(objectRef) {
      if (failOn.has(objectRef)) {
        throw new Error(`Échec simulé de suppression : ${objectRef}`);
      }
      deleted.push(objectRef);
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Compresseur vidéo                                                          */
/* -------------------------------------------------------------------------- */

export interface MockCompressorOptions {
  /** Délai simulé du transcodage, en ms (défaut : 0). */
  delayMs?: number;
  /** Force un échec, pour tester le chemin `status: "echec"`. */
  fail?: boolean;
  /** Étapes de progression remontées via `onProgress` (défaut : 0.3, 0.6, 0.9). */
  progressSteps?: number[];
}

export function createMockVideoCompressor(
  options: MockCompressorOptions = {}
): VideoCompressor {
  const { delayMs = 0, fail = false, progressSteps = [0.3, 0.6, 0.9] } = options;

  return {
    async compress(job, onProgress) {
      const outputRef = `mock-imports/${job.id}.mp4`;
      // Construit la commande FFmpeg : vérifie au passage que les entrées du
      // job sont exploitables (chemin source non vide, extension de sortie).
      buildImportJobFfmpegArgs(job, outputRef);

      for (const step of progressSteps) onProgress?.(step);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (fail) {
        throw new Error("Échec simulé de la compression FFmpeg (mock).");
      }

      return {
        outputRef,
        // URL de lecture factice — en production, URL CDN de la vidéo compressée.
        playbackUrl: `/api/import/mock-playback/${encodeURIComponent(outputRef)}`,
        mimeType: "video/mp4",
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Écriture bibliothèque                                                      */
/* -------------------------------------------------------------------------- */

export interface RecordingExtraitLibraryWriter extends ExtraitLibraryWriter {
  readonly created: readonly {
    id: string;
    titre: string;
    urlSource: string;
    dureeSecondes: number;
    importeParId: string;
    /** ST 5.2 — trace de certification recopiée sur l'extrait. */
    certificationDroitsLe: Date;
    certificationDroitsVersion: string;
  }[];
}

/**
 * `ExtraitLibraryWriter` en mémoire. Attribue un id `mock-import-XXX` et
 * enregistre chaque entrée créée. L'extrait est réputé au statut EN_ATTENTE
 * (« en attente de modération ») — non stocké ici car le mock n'a pas de
 * table `Extrait` inscriptible (le jeu de données `extraits.mock.ts` est
 * figé) ; signalé en notes de dev.
 */
export function createInMemoryExtraitLibraryWriter(): RecordingExtraitLibraryWriter {
  const created: RecordingExtraitLibraryWriter["created"][number][] = [];
  let seq = 0;
  return {
    created,
    async create(input) {
      seq += 1;
      const id = `mock-import-${String(seq).padStart(3, "0")}`;
      created.push({
        id,
        titre: input.titre,
        urlSource: input.urlSource,
        dureeSecondes: input.dureeSecondes,
        importeParId: input.importeParId,
        certificationDroitsLe: input.certificationDroitsLe,
        certificationDroitsVersion: input.certificationDroitsVersion,
      });
      return { id };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Singletons partagés (mode mock d'exécution)                                */
/* -------------------------------------------------------------------------- */

const globalForImport = globalThis as unknown as {
  importJobStore?: ImportJobStore;
  importLibraryWriter?: RecordingExtraitLibraryWriter;
};

/**
 * Store Redis (ST 9.3) — mêmes champs/statut initial que
 * `createInMemoryImportJobStore` (`lib/import.ts`), pour un comportement
 * identique aux tests existants qui exercent l'implémentation en mémoire.
 */
function createRedisImportJobStore(): ImportJobStore {
  return createRedisJobStore<ImportJobInput, ImportJob>("import", {
    redis: getRedisClient(),
    keyPrefix: "import-job:",
    buildInitial: (id, ts, input) => ({
      id,
      status: "en_attente",
      progress: 0,
      createdAt: ts,
      updatedAt: ts,
      input,
    }),
  });
}

export function getImportJobStore(): ImportJobStore {
  if (isMockDataSource()) {
    if (!globalForImport.importJobStore) {
      globalForImport.importJobStore = createInMemoryImportJobStore();
    }
    return globalForImport.importJobStore;
  }
  if (!globalForImport.importJobStore) {
    globalForImport.importJobStore = createRedisImportJobStore();
  }
  return globalForImport.importJobStore;
}

export function getMockImportLibraryWriter(): RecordingExtraitLibraryWriter {
  if (!globalForImport.importLibraryWriter) {
    globalForImport.importLibraryWriter = createInMemoryExtraitLibraryWriter();
  }
  return globalForImport.importLibraryWriter;
}
