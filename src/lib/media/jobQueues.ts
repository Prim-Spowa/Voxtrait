/**
 * Files d'attente BullMQ — ST 9.3, découpage en tâches point 4 : « Mettre en
 * place BullMQ + Redis pour exécuter ces jobs de façon asynchrone, en
 * conservant le contrat de polling déjà exposé (`GET /api/doublages/:id`,
 * `GET /api/import/:id`) ».
 *
 * Deux files, une par nature de traitement :
 *  - `import-compression` : compression FFmpeg d'un import (`runImportJob`) ;
 *  - `doublage-mix` : mixage FFmpeg d'un export de doublage (`runDoublageJob`).
 *
 * Le **payload** de chaque job BullMQ est volontairement minimal
 * (`{ jobId }`) : l'état métier complet (statut, progression, résultat) reste
 * dans le store applicatif (`ImportJobStore`/`DoublageJobStore`, adossé à
 * Redis via `redisJobStore.ts` en production) — c'est lui que
 * `GET /api/import/:id`/`GET /api/doublages/:id` interrogent, pas l'état
 * interne du job BullMQ. BullMQ n'est donc utilisé ici que comme
 * ordonnanceur/file d'attente fiable (retries, concurrence, persistance de la
 * file elle-même), pas comme source de vérité du contrat de polling —
 * contrat qui reste inchangé, comme l'exige la story.
 *
 * Le worker qui consomme ces files (`scripts/worker.ts`) tourne dans un
 * process **séparé** de l'API Next.js (`npm run worker`) — modèle standard
 * pour BullMQ, qui permet de scaler le traitement vidéo indépendamment des
 * requêtes HTTP (cf. « dimensionnement CPU/mémoire du worker », points
 * d'attention de la story).
 */

import { Queue } from "bullmq";
import { getRedisClient } from "@/lib/media/redisConnection";

export const IMPORT_COMPRESSION_QUEUE_NAME = "import-compression";
export const DOUBLAGE_MIX_QUEUE_NAME = "doublage-mix";

/** Payload minimal des jobs des deux files — l'id du job métier (`ImportJob`/`DoublageJob`). */
export interface MediaQueueJobData {
  jobId: string;
}

/**
 * Nombre de tentatives et backoff : un échec transitoire (FFmpeg tué par
 * manque de mémoire sous charge, coupure réseau vers Redis) mérite une
 * nouvelle tentative avant d'afficher un échec définitif à l'utilisateur·rice.
 * `runImportJob`/`runDoublageJob` sont idempotents pour un job déjà terminé
 * (ils renvoient l'état courant sans rejouer un job qui n'est plus
 * `en_attente`) mais **pas** ré-entrants pour un job resté bloqué en
 * `en_traitement` après un crash worker — limite assumée, signalée en notes
 * de dev (une reprise propre supposerait un statut intermédiaire distinguant
 * « en cours côté ce worker » de « à reprendre »).
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

const globalForQueues = globalThis as unknown as {
  importCompressionQueue?: Queue<MediaQueueJobData>;
  doublageMixQueue?: Queue<MediaQueueJobData>;
};

/** File BullMQ de compression d'import — singleton `globalThis` (même raison que `getRedisClient`). */
export function getImportCompressionQueue(): Queue<MediaQueueJobData> {
  if (!globalForQueues.importCompressionQueue) {
    globalForQueues.importCompressionQueue = new Queue<MediaQueueJobData>(
      IMPORT_COMPRESSION_QUEUE_NAME,
      { connection: getRedisClient(), defaultJobOptions: DEFAULT_JOB_OPTIONS }
    );
  }
  return globalForQueues.importCompressionQueue;
}

/** File BullMQ de mixage de doublage — singleton `globalThis`. */
export function getDoublageMixQueue(): Queue<MediaQueueJobData> {
  if (!globalForQueues.doublageMixQueue) {
    globalForQueues.doublageMixQueue = new Queue<MediaQueueJobData>(DOUBLAGE_MIX_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return globalForQueues.doublageMixQueue;
}

/** Ajoute un job de compression d'import à la file — appelé par `POST /api/import`. */
export async function enqueueImportCompressionJob(jobId: string): Promise<void> {
  await getImportCompressionQueue().add("compress", { jobId });
}

/** Ajoute un job de mixage de doublage à la file — appelé par `POST /api/doublages`. */
export async function enqueueDoublageMixJob(jobId: string): Promise<void> {
  await getDoublageMixQueue().add("mix", { jobId });
}
