/**
 * Connexion Redis partagée — ST 9.3, découpage en tâches point 4 : « Mettre en
 * place BullMQ + Redis pour exécuter ces jobs de façon asynchrone [...] ».
 *
 * Redis sert ici à deux choses :
 *  1. la file de jobs BullMQ (`jobQueues.ts`) ;
 *  2. le store des jobs d'import/doublage (`redisJobStore.ts`), qui remplace
 *     `createInMemoryImportJobStore`/`createInMemoryDoublageJobStore` en
 *     production — nécessaire dès qu'un worker tourne dans un **process
 *     séparé** de l'API (`scripts/worker.ts`) : un store en mémoire du
 *     process API ne serait pas visible du worker, et réciproquement (déjà
 *     signalé comme limite multi-instances dans les commentaires de tête de
 *     `lib/import.ts`/`lib/doublage.ts`).
 *
 * Même posture que `getSessionSecret` (`lib/session.ts`) / `getObjectStorageConfig`
 * (notes de dev ST 9.2) pour la configuration : `REDIS_URL` obligatoire en
 * production, repli sur un Redis local par défaut sinon (`next dev`/tests).
 */

import Redis, { type RedisOptions } from "ioredis";

const DEV_FALLBACK_REDIS_URL = "redis://127.0.0.1:6379";

export function getRedisUrl(): string {
  const configured = process.env.REDIS_URL?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("REDIS_URL manquant en production (requis pour BullMQ, cf. ST 9.3).");
  }
  return DEV_FALLBACK_REDIS_URL;
}

/**
 * `maxRetriesPerRequest: null` est **exigé par BullMQ** pour les connexions
 * qu'il pilote (cf. documentation BullMQ) — sans cette option, une commande
 * bloquante (`BRPOPLPUSH` interne) peut être abandonnée prématurément en cas
 * de coupure réseau transitoire. On l'applique uniformément (store de jobs
 * inclus) : une seule politique de reconnexion pour tout le module.
 */
function buildRedisOptions(): RedisOptions {
  return { maxRetriesPerRequest: null };
}

const globalForRedis = globalThis as unknown as {
  redisClient?: Redis;
};

/**
 * Client Redis singleton (pattern `globalThis`, cf. `src/lib/prisma.ts`) :
 * évite qu'un hot-reload Next.js (`next dev`) n'ouvre une nouvelle connexion à
 * chaque rechargement de module.
 */
export function getRedisClient(): Redis {
  if (!globalForRedis.redisClient) {
    globalForRedis.redisClient = new Redis(getRedisUrl(), buildRedisOptions());
  }
  return globalForRedis.redisClient;
}

/** Nouvelle connexion dédiée (BullMQ `Worker`/`QueueEvents` veulent chacun la leur, cf. doc BullMQ). */
export function createDedicatedRedisConnection(): Redis {
  return new Redis(getRedisUrl(), buildRedisOptions());
}
