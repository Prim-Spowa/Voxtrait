/**
 * Limiteur de débit à fenêtre fixe adossé à Redis — ST 9.4 « Persistance des
 * sessions et du rate limiting », découpage en tâches point 2 : « Migrer les
 * compteurs de rate limiting (ST 4.1 inscription, ST 7.1 signalement, ST 7.3
 * demandes de retrait) vers Redis ».
 *
 * Remplace, hors `DATA_SOURCE=mock`, `createFixedWindowRateLimiter`
 * (`lib/rateLimit.ts`) — même interface (`RateLimiter`), donc branchable sans
 * modifier les endpoints au-delà de la bascule déjà en place ailleurs dans le
 * projet (`getFixedWindowRateLimiter`, `lib/rateLimiterFactory.ts`). Un
 * compteur partagé par tous les process (API et, le cas échéant, replicas)
 * survit à un redémarrage — condition nécessaire au delà d'un seul process
 * (texte de la story).
 *
 * Implémentation : `INCR` sur une clé `${keyPrefix}${key}`, avec `PEXPIRE`
 * posé uniquement au premier incrément de la fenêtre (`count === 1`) — la
 * fenêtre démarre donc à la première requête de la clé, comme
 * `createFixedWindowRateLimiter`. Deux commandes non atomiques entre elles,
 * mais sans conséquence pratique ici : dans la pire hypothèse (crash du
 * process entre les deux), la clé resterait sans expiration explicite —
 * risque écarté par un filet de sécurité (`PEXPIRE` inconditionnel avec
 * `NX`-like reposé à chaque lecture serait plus complexe pour un gain nul à
 * cette échelle ; cf. `RedisJobStore`, ST 9.3, qui accepte la même
 * simplification pour `persist`).
 */

import type Redis from "ioredis";
import { getRedisClient } from "@/lib/media/redisConnection";
import type { RateLimitDecision, RateLimiter } from "@/lib/rateLimit";

export interface RedisFixedWindowRateLimiterOptions {
  /** Nombre maximal de requêtes autorisées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number;
  /**
   * Préfixe des clés Redis (ex. `"ratelimit:register:"`). **Doit être unique
   * par limiteur** — deux endpoints qui partageraient un préfixe partageraient
   * aussi leur quota.
   */
  keyPrefix: string;
  /** Client Redis (défaut : `getRedisClient()`, singleton partagé du projet). */
  redis?: Redis;
}

/**
 * Crée un limiteur à fenêtre fixe adossé à Redis. Interchangeable avec
 * `createFixedWindowRateLimiter` (`lib/rateLimit.ts`) : même `RateLimiter`.
 */
export function createRedisFixedWindowRateLimiter(
  options: RedisFixedWindowRateLimiterOptions
): RateLimiter {
  const { limit, windowMs, keyPrefix } = options;
  const redis = options.redis ?? getRedisClient();

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`redisRateLimit: "limit" doit être un entier >= 1 (reçu : ${limit}).`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`redisRateLimit: "windowMs" doit être un nombre > 0 (reçu : ${windowMs}).`);
  }
  if (!keyPrefix) {
    throw new Error('redisRateLimit: "keyPrefix" est requis (doit être unique par limiteur).');
  }

  const fullKey = (key: string) => `${keyPrefix}${key}`;

  return {
    async check(key: string): Promise<RateLimitDecision> {
      const redisKey = fullKey(key);
      const count = await redis.incr(redisKey);
      if (count === 1) {
        // Premier hit de la fenêtre : on pose l'expiration une seule fois —
        // les incréments suivants ne doivent pas la repousser (fenêtre
        // *fixe*, pas glissante).
        await redis.pexpire(redisKey, windowMs);
      }

      if (count > limit) {
        const retryAfterMs = await redis.pttl(redisKey);
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
      }

      return { allowed: true, remaining: Math.max(0, limit - count), retryAfterMs: 0 };
    },

    async reset(key?: string): Promise<void> {
      if (key !== undefined) {
        await redis.del(fullKey(key));
        return;
      }
      // Reset global (tests/outillage uniquement — jamais appelé sur le
      // chemin d'une requête en production, cf. `POST /api/auth/login`) :
      // `SCAN` plutôt que `KEYS` pour ne pas bloquer Redis, borné au préfixe
      // de ce limiteur.
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          `${keyPrefix}*`,
          "COUNT",
          100
        );
        cursor = nextCursor;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    },
  };
}
