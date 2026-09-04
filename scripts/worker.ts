/**
 * Worker BullMQ — ST 9.3 « Traitement vidéo réel (ffprobe/FFmpeg) et file de
 * jobs réelle », découpage en tâches point 4 : « Mettre en place BullMQ +
 * Redis pour exécuter ces jobs de façon asynchrone [...] ».
 *
 * Process **séparé** de l'API Next.js (`npm run worker`, à côté de
 * `npm run dev`/`npm start`) : consomme les deux files définies dans
 * `src/lib/media/jobQueues.ts` et exécute réellement `ffmpeg`/`ffprobe` (via
 * `createFfmpegVideoCompressor`/`createFfmpegDoublageProcessor`), en dehors du
 * cycle requête/réponse HTTP — cf. « dimensionnement CPU/mémoire du worker à
 * prévoir », points d'attention de la story.
 *
 * N'est utile que hors `DATA_SOURCE=mock` : en mode mock, les jobs sont
 * toujours exécutés inline par les endpoints eux-mêmes (`POST /api/import`,
 * `POST /api/doublages`), ce worker n'a alors rien à consommer.
 *
 * Concurrence (`concurrency`) volontairement basse par défaut : chaque job
 * FFmpeg est déjà multi-thread en interne (encodage x264) et coûteux en
 * CPU — une forte concurrence de *jobs* n'accélérerait pas le débit sur une
 * machine à cœurs limités, seulement la latence de la file. Ajustable via
 * `IMPORT_WORKER_CONCURRENCY`/`DOUBLAGE_WORKER_CONCURRENCY` si le worker
 * tourne sur une machine dédiée avec plus de ressources.
 */

import { Worker } from "bullmq";
import {
  IMPORT_COMPRESSION_QUEUE_NAME,
  DOUBLAGE_MIX_QUEUE_NAME,
  type MediaQueueJobData,
} from "@/lib/media/jobQueues";
import { createDedicatedRedisConnection } from "@/lib/media/redisConnection";
import { getImportJobStore } from "@/lib/mocks/import.mock";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";
import { runImportJob } from "@/lib/import";
import { runDoublageJob } from "@/lib/doublage";
import { createFfmpegVideoCompressor } from "@/lib/videoCompressor";
import { createFfmpegDoublageProcessor } from "@/lib/doublageProcessor";
import { createLocalObjectStorageCleaner, createLocalSignedUrlIssuer } from "@/lib/media/localObjectStorageAdapters";
import { prismaExtraitLibraryWriter } from "@/lib/importLibraryWriter";
import { DOUBLAGE_URL_TTL_SECONDS } from "@/lib/doublage";

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

const importWorker = new Worker<MediaQueueJobData>(
  IMPORT_COMPRESSION_QUEUE_NAME,
  async (job) => {
    await runImportJob(getImportJobStore(), job.data.jobId, {
      compressor: createFfmpegVideoCompressor(),
      library: prismaExtraitLibraryWriter(),
      cleaner: createLocalObjectStorageCleaner(),
    });
  },
  {
    connection: createDedicatedRedisConnection(),
    concurrency: envInt("IMPORT_WORKER_CONCURRENCY", 1),
  }
);

const doublageWorker = new Worker<MediaQueueJobData>(
  DOUBLAGE_MIX_QUEUE_NAME,
  async (job) => {
    await runDoublageJob(getDoublageJobStore(), job.data.jobId, {
      processor: createFfmpegDoublageProcessor(),
      issuer: createLocalSignedUrlIssuer(),
      ttlSeconds: DOUBLAGE_URL_TTL_SECONDS,
    });
  },
  {
    connection: createDedicatedRedisConnection(),
    concurrency: envInt("DOUBLAGE_WORKER_CONCURRENCY", 1),
  }
);

const namedWorkers: Array<{ name: string; worker: Worker<MediaQueueJobData> }> = [
  { name: IMPORT_COMPRESSION_QUEUE_NAME, worker: importWorker },
  { name: DOUBLAGE_MIX_QUEUE_NAME, worker: doublageWorker },
];

for (const { name, worker } of namedWorkers) {
  worker.on("failed", (job, err) => {
    // `runImportJob`/`runDoublageJob` convertissent déjà l'échec en
    // `status: "echec"` côté job métier — ce log ne sert qu'à l'observabilité
    // opérationnelle du worker (pas au client, jamais notifié directement).
    // eslint-disable-next-line no-console
    console.error(`[worker:${name}] job ${job?.id} échoué :`, err);
  });
}

// eslint-disable-next-line no-console
console.log(
  `[worker] démarré — files "${IMPORT_COMPRESSION_QUEUE_NAME}" et "${DOUBLAGE_MIX_QUEUE_NAME}"`
);

async function shutdown(): Promise<void> {
  await Promise.all([importWorker.close(), doublageWorker.close()]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
