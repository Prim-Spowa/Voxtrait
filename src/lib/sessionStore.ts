/**
 * Store de révocation des sessions — ST 9.4 « Persistance des sessions et du
 * rate limiting », découpage en tâches point 1 : « Migrer le store de session
 * vers Redis ».
 *
 * Contexte : le jeton de session (`lib/session.ts`, ST 4.1/4.2) est un jeton
 * **signé sans état** — sa seule vérification (signature + expiration) ne
 * dépend d'aucun stockage serveur, et survit donc déjà, à elle seule, à un
 * redémarrage de process ou à plusieurs instances. La limite documentée dès
 * ST 4.2 (`POST /api/auth/logout`) est ailleurs : « un jeton qui aurait été
 * exfiltré resterait cryptographiquement valide jusqu'à sa date d'expiration
 * […] Une vraie invalidation serveur demanderait une liste de révocation
 * (jti + store partagé) — signalé en notes de dev ST 4.2 pour arbitrage ».
 * C'est cet arbitrage que tranche ST 9.4 : chaque jeton émis (`createSessionToken`)
 * porte désormais un identifiant de session (`jti`) enregistré ici ; la
 * déconnexion (`POST /api/auth/logout`) le révoque réellement, au lieu de se
 * limiter à effacer le cookie côté navigateur.
 *
 * Même bascule mémoire (`DATA_SOURCE=mock`) / Redis (sinon) que les stores de
 * jobs (ST 9.3, `getDoublageJobStore`) : Redis (déjà introduit en ST 9.3, cf.
 * texte de la story) est réutilisé plutôt qu'une dépendance supplémentaire.
 */

import type Redis from "ioredis";
import { isMockDataSource } from "@/lib/config";
import { getRedisClient } from "@/lib/media/redisConnection";

export interface SessionStore {
  /** Enregistre une session active `jti` pour `userId`, expirant dans `ttlSeconds`. */
  register(jti: string, userId: string, ttlSeconds: number): Promise<void>;
  /** `true` si `jti` correspond à une session enregistrée et non expirée/révoquée. */
  isActive(jti: string): Promise<boolean>;
  /** Révoque `jti` (déconnexion) — idempotent, ne lève pas si déjà absent. */
  revoke(jti: string): Promise<void>;
}

/**
 * Implémentation en mémoire (mode `DATA_SOURCE=mock`, développement/tests
 * sans Redis) — une `Map` `jti → expiration`, même principe que
 * `createFixedWindowRateLimiter` (`lib/rateLimit.ts`).
 */
export function createInMemorySessionStore(now: () => number = () => Date.now()): SessionStore {
  const sessions = new Map<string, number>();

  return {
    async register(jti, _userId, ttlSeconds) {
      sessions.set(jti, now() + ttlSeconds * 1000);
    },
    async isActive(jti) {
      const expiresAt = sessions.get(jti);
      if (expiresAt === undefined) return false;
      if (expiresAt <= now()) {
        sessions.delete(jti);
        return false;
      }
      return true;
    },
    async revoke(jti) {
      sessions.delete(jti);
    },
  };
}

const SESSION_KEY_PREFIX = "session:";

/**
 * Implémentation Redis (mode par défaut, hors `DATA_SOURCE=mock`) : chaque
 * session vivante est une clé `session:<jti>` valant `userId`, avec une
 * expiration Redis (`EX`) — le TTL Redis fait à la fois office de nettoyage
 * automatique (pas de purge applicative à écrire, contrairement aux jobs de
 * ST 9.3 qui exposent un `list()`) et de garantie que la déconnexion
 * (`DEL`) retire immédiatement la session pour **tous** les process qui
 * partagent ce Redis.
 */
export function createRedisSessionStore(redis: Redis): SessionStore {
  const key = (jti: string) => `${SESSION_KEY_PREFIX}${jti}`;

  return {
    async register(jti, userId, ttlSeconds) {
      await redis.set(key(jti), userId, "EX", ttlSeconds);
    },
    async isActive(jti) {
      const exists = await redis.exists(key(jti));
      return exists === 1;
    },
    async revoke(jti) {
      await redis.del(key(jti));
    },
  };
}

const globalForSessionStore = globalThis as unknown as {
  sessionStore?: SessionStore;
};

/**
 * Store singleton (pattern `globalThis`, cf. `lib/prisma.ts`) : en mémoire si
 * `DATA_SOURCE=mock`, adossé à Redis sinon.
 */
export function getSessionStore(): SessionStore {
  if (!globalForSessionStore.sessionStore) {
    globalForSessionStore.sessionStore = isMockDataSource()
      ? createInMemorySessionStore()
      : createRedisSessionStore(getRedisClient());
  }
  return globalForSessionStore.sessionStore;
}
