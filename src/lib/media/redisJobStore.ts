/**
 * Store de jobs générique adossé à Redis — ST 9.3, cf. `redisConnection.ts`
 * pour la justification (store partagé entre le process API et le process
 * worker, cf. `scripts/worker.ts`).
 *
 * Remplace, en production, `createInMemoryImportJobStore`/
 * `createInMemoryDoublageJobStore` (`lib/import.ts`/`lib/doublage.ts`) — mêmes
 * interfaces (`ImportJobStore`/`DoublageJobStore`), donc branchable sans
 * modifier `runImportJob`/`runDoublageJob`/les endpoints (au-delà de la
 * bascule `isMockDataSource()` déjà en place ailleurs dans le projet).
 *
 * Implémentation : chaque job est une simple valeur JSON sous la clé
 * `${keyPrefix}${id}`, avec une expiration Redis (`PEXPIRE`) recalculée à
 * chaque `update` — TTL de sécurité (`FALLBACK_TTL_SECONDS`) tant que le job
 * n'a pas de `expiresAt` connu (job en cours), puis TTL exact une fois
 * `expiresAt` renseigné par `runImportJob`/`runDoublageJob`. Cela borne la
 * mémoire Redis même si `pruneExpiredImportJobs`/`pruneExpiredDoublageJobs`
 * (purge applicative, best-effort) n'est jamais exécutée — filet de sécurité,
 * la purge applicative reste la voie normale (elle supprime aussi le job de
 * l'index `list()`, cf. plus bas).
 *
 * Un `SET` Redis (`${keyPrefix}index`) tient la liste des ids vivants, pour
 * implémenter `list()` (nécessaire à `pruneExpiredImportJobs`/
 * `pruneExpiredDoublageJobs`) sans `SCAN` coûteux à chaque appel.
 */

import type Redis from "ioredis";

/** Filet de sécurité si un job ne quitte jamais l'état `en_attente`/`en_traitement` (incident worker). */
const FALLBACK_TTL_SECONDS = 6 * 60 * 60; // 6 h

export class RedisJobNotFoundError extends Error {
  constructor(id: string, keyPrefix: string) {
    super(`Job introuvable dans Redis (${keyPrefix}) : ${id}`);
    this.name = "RedisJobNotFoundError";
  }
}

export interface RedisJobStoreOptions<TJob extends { id: string; expiresAt?: string }> {
  redis: Redis;
  /** Préfixe des clés Redis (ex. `"import-job:"`). Doit être unique par type de job. */
  keyPrefix: string;
  /** Construit un job initial (id/statut/horodatages) à partir de l'input métier. */
  buildInitial: (id: string, ts: string) => TJob;
  now?: () => Date;
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Store CRUD générique branché sur Redis. `TInput` est le type d'entrée de
 * `create` (ex. `ImportJobInput`) ; `TJob` le type stocké (ex. `ImportJob`),
 * qui doit exposer `id`, `updatedAt` et un `expiresAt` optionnel.
 */
export function createRedisJobStore<
  TInput,
  TJob extends { id: string; updatedAt: string; expiresAt?: string },
>(
  idPrefix: string,
  options: Omit<RedisJobStoreOptions<TJob>, "buildInitial"> & {
    buildInitial: (id: string, ts: string, input: TInput) => TJob;
  }
) {
  const { redis, keyPrefix, buildInitial, now = () => new Date() } = options;
  const indexKey = `${keyPrefix}index`;
  const jobKey = (id: string) => `${keyPrefix}${id}`;

  async function ttlSecondsFor(job: TJob): Promise<number> {
    if (!job.expiresAt) return FALLBACK_TTL_SECONDS;
    const remainingMs = new Date(job.expiresAt).getTime() - now().getTime();
    // Toujours au moins 1 s : un TTL <= 0 supprimerait immédiatement la clé
    // avant que le client n'ait pu lire la réponse (`pruneExpiredImportJobs`
    // se chargera de la purge applicative de toute façon).
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  async function persist(job: TJob): Promise<void> {
    const ttl = await ttlSecondsFor(job);
    await redis
      .multi()
      .set(jobKey(job.id), JSON.stringify(job), "EX", ttl)
      .sadd(indexKey, job.id)
      .exec();
  }

  return {
    async create(input: TInput): Promise<TJob> {
      const id = generateId(idPrefix);
      const job = buildInitial(id, now().toISOString(), input);
      await persist(job);
      return { ...job };
    },

    async get(id: string): Promise<TJob | null> {
      const raw = await redis.get(jobKey(id));
      if (!raw) return null;
      return JSON.parse(raw) as TJob;
    },

    async update(id: string, patch: Partial<TJob>): Promise<TJob> {
      const raw = await redis.get(jobKey(id));
      if (!raw) throw new RedisJobNotFoundError(id, keyPrefix);
      const existing = JSON.parse(raw) as TJob;
      const updated: TJob = { ...existing, ...patch, id, updatedAt: now().toISOString() };
      await persist(updated);
      return { ...updated };
    },

    async list(): Promise<TJob[]> {
      const ids = await redis.smembers(indexKey);
      if (ids.length === 0) return [];
      const raws = await redis.mget(...ids.map(jobKey));
      const jobs: TJob[] = [];
      const staleIds: string[] = [];
      raws.forEach((raw, i) => {
        if (raw) {
          jobs.push(JSON.parse(raw) as TJob);
        } else {
          // Clé expirée par Redis (TTL) sans passer par `delete` : nettoie
          // l'index au passage plutôt que de le laisser grossir indéfiniment.
          staleIds.push(ids[i]);
        }
      });
      if (staleIds.length > 0) await redis.srem(indexKey, ...staleIds);
      return jobs;
    },

    async delete(id: string): Promise<void> {
      await redis.multi().del(jobKey(id)).srem(indexKey, id).exec();
    },
  };
}
