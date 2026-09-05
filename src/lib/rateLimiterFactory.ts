/**
 * Fabrique de limiteurs de débit — ST 9.4 « Persistance des sessions et du
 * rate limiting ».
 *
 * Centralise la bascule mémoire (`DATA_SOURCE=mock`) / Redis (sinon) déjà
 * appliquée ailleurs dans le projet pour les stores de jobs (ST 9.3,
 * `getDoublageJobStore`/`getImportJobStore`, `lib/mocks/*.mock.ts`) : chaque
 * route de l'Epic 4/7 (inscription, connexion, signalement, demande de
 * retrait, import) appelait auparavant directement
 * `createFixedWindowRateLimiter` avec son propre singleton `globalThis` — la
 * bascule Redis aurait dû être dupliquée cinq fois. `getFixedWindowRateLimiter`
 * fait ce travail une seule fois, gardant un singleton **par `name`** (survit
 * au hot-reload Next comme les autres singletons `globalThis` du projet, cf.
 * `lib/prisma.ts`).
 */

import { isMockDataSource } from "@/lib/config";
import { createFixedWindowRateLimiter, type RateLimiter } from "@/lib/rateLimit";
import { createRedisFixedWindowRateLimiter } from "@/lib/redisRateLimit";

export interface RateLimiterConfig {
  /** Nombre maximal de requêtes autorisées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number;
}

const globalForRateLimiters = globalThis as unknown as {
  rateLimiters?: Map<string, RateLimiter>;
};

/**
 * Renvoie le `RateLimiter` singleton associé à `name` — **doit être unique
 * par endpoint** (sert de préfixe de clé Redis et de clé de registre en
 * mémoire). Créé au premier appel : en mémoire si `DATA_SOURCE=mock`, adossé
 * à Redis sinon (`createRedisFixedWindowRateLimiter`).
 */
export function getFixedWindowRateLimiter(name: string, config: RateLimiterConfig): RateLimiter {
  const registry = (globalForRateLimiters.rateLimiters ??= new Map<string, RateLimiter>());

  const existing = registry.get(name);
  if (existing) return existing;

  const limiter = isMockDataSource()
    ? createFixedWindowRateLimiter(config)
    : createRedisFixedWindowRateLimiter({ ...config, keyPrefix: `ratelimit:${name}:` });

  registry.set(name, limiter);
  return limiter;
}

/** Outillage de test : vide le registre (chaque test repart d'un limiteur neuf). */
export function resetRateLimiterRegistryForTests(): void {
  globalForRateLimiters.rateLimiters?.clear();
}
