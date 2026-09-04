/**
 * Limiteur de débit — ST 4.1 « Inscription », points d'attention : « rate
 * limiting sur l'endpoint pour éviter les abus/bots ».
 *
 * Interface asynchrone (`RateLimiter`) commune aux deux implémentations du
 * projet, sélectionnées comme le reste de l'Epic 9 (cf. `getDoublageJobStore`,
 * `lib/mocks/doublage.mock.ts`) :
 *  - **ici**, `createFixedWindowRateLimiter` : implémentation **en mémoire**
 *    (une `Map` `clé → compteur + début de fenêtre`), utilisée en mode
 *    `DATA_SOURCE=mock` (développement/tests sans Redis) ;
 *  - `createRedisFixedWindowRateLimiter` (`lib/redisRateLimit.ts`) :
 *    implémentation **Redis**, utilisée sinon (ST 9.4 « Persistance des
 *    sessions et du rate limiting ») — seule variante correcte en déploiement
 *    multi-instances/serverless ou après un redémarrage de process.
 *
 * `getFixedWindowRateLimiter` (`lib/rateLimiterFactory.ts`) fait cette
 * bascule pour les endpoints ; ce module reste **pur** (aucune dépendance,
 * aucun accès réseau/base) : `now` est injectable pour des tests
 * déterministes, comme `createInMemoryDoublageJobStore` (ST 3.1).
 *
 * ⚠️ Périmètre de cette implémentation en mémoire (mode mock uniquement,
 * depuis ST 9.4) : en déploiement multi-instances / serverless, chaque
 * instance aurait sa propre `Map` : la limite serait donc `limit × nombre
 * d'instances`. Sans objet en production, qui utilise désormais toujours
 * `createRedisFixedWindowRateLimiter`.
 */

export interface RateLimitDecision {
  /** `true` si la requête est autorisée (quota non dépassé). */
  allowed: boolean;
  /** Nombre de requêtes encore autorisées dans la fenêtre courante. */
  remaining: number;
  /**
   * Millisecondes avant la réouverture du quota (fin de la fenêtre courante).
   * `0` tant que le quota n'est pas épuisé.
   */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Enregistre une tentative pour `key` et indique si elle est autorisée. */
  check(key: string): Promise<RateLimitDecision>;
  /** Réinitialise le compteur d'une clé, ou de toutes si `key` est omis (tests). */
  reset(key?: string): Promise<void>;
}

export interface FixedWindowRateLimiterOptions {
  /** Nombre maximal de requêtes autorisées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number;
  /** Horloge injectable (défaut : `Date.now`). */
  now?: () => number;
}

interface WindowState {
  count: number;
  /** Timestamp (ms) de fin de la fenêtre courante. */
  resetAt: number;
}

/**
 * Crée un limiteur à fenêtre fixe, **en mémoire** (mode `DATA_SOURCE=mock`
 * uniquement depuis ST 9.4 — cf. tête de fichier).
 *
 * Choix « fenêtre fixe » plutôt que « fenêtre glissante » / « token bucket » :
 * le plus simple à raisonner et à tester, suffisant pour freiner un script
 * d'inscription en masse. L'effet de bord connu (jusqu'à `2 × limit`
 * requêtes à cheval sur deux fenêtres) est sans conséquence à cette échelle.
 *
 * Signature asynchrone (`Promise`) alignée sur `RateLimiter` bien que
 * l'implémentation reste synchrone en interne : permet d'utiliser exactement
 * le même contrat que `createRedisFixedWindowRateLimiter` côté appelant (les
 * routes ne testent pas quelle implémentation est active).
 */
export function createFixedWindowRateLimiter(
  options: FixedWindowRateLimiterOptions
): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, WindowState>();

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`rateLimit: "limit" doit être un entier >= 1 (reçu : ${limit}).`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`rateLimit: "windowMs" doit être un nombre > 0 (reçu : ${windowMs}).`);
  }

  return {
    async check(key: string): Promise<RateLimitDecision> {
      const current = now();
      const existing = windows.get(key);

      // Pas de fenêtre en cours, ou fenêtre expirée : on (ré)ouvre.
      if (!existing || current >= existing.resetAt) {
        windows.set(key, { count: 1, resetAt: current + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }

      if (existing.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, existing.resetAt - current),
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        remaining: limit - existing.count,
        retryAfterMs: 0,
      };
    },

    async reset(key?: string): Promise<void> {
      if (key === undefined) {
        windows.clear();
      } else {
        windows.delete(key);
      }
    },
  };
}
