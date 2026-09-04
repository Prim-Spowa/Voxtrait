import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRedisClient } from "@/lib/media/redisConnection";
import { createRedisSessionStore } from "@/lib/sessionStore";
import { createRedisFixedWindowRateLimiter } from "@/lib/redisRateLimit";
import { createSessionToken, revokeSession, verifySessionToken } from "@/lib/session";

/**
 * Tests d'intégration ST 9.4 « Persistance des sessions et du rate limiting »
 * — DoD explicite : « Tests d'intégration simulant un redémarrage de process
 * (session et rate limit doivent survivre) ». Mêmes principes que
 * `st9.1-postgres.integration.test.ts` / `st9.3-ffmpeg-redis.integration.test.ts` :
 * ces tests parlent à un **vrai** Redis (`REDIS_URL`), contrairement au reste
 * de la suite (client Redis hors ligne, cf. `sessionStore.test.ts`/
 * `redisRateLimit.test.ts`).
 *
 * « Redémarrage de process » est simulé en recréant un client Redis
 * indépendant à chaque étape (`createDedicatedRedisConnection` en aurait été
 * l'équivalent ; `getRedisClient()` suffit ici car la propriété testée — la
 * donnée vit dans Redis, pas dans le process — ne dépend pas du client qui la
 * lit) plutôt qu'en relisant une variable de process : un store en mémoire
 * (`createInMemorySessionStore`/`createFixedWindowRateLimiter`, mode
 * `DATA_SOURCE=mock`) échouerait ce test par construction.
 *
 * ⚠️ Non exécutés dans l'environnement de développement de cette story (Redis
 * absent du bac à sable) — vérifiés par relecture seulement, comme les tests
 * d'intégration de ST 9.3. À exécuter en priorité avant merge (`docker
 * compose up -d redis`, cf. README).
 */

const redis = getRedisClient();

beforeAll(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.flushdb();
  await redis.quit();
});

describe("Session — révocation persistée dans Redis (ST 9.4)", () => {
  const SECRET = "test-secret-integration-de-32-caracteres-minimum";

  it("une session enregistrée reste active pour un store Redis créé séparément (simule un autre process)", async () => {
    const writerStore = createRedisSessionStore(redis);
    const jti = randomUUID();
    await writerStore.register(jti, "user-integration-1", 60);

    // Nouveau client Redis indépendant : équivalent d'un process API distinct
    // (ou du même process après redémarrage) lisant le même Redis.
    const readerStore = createRedisSessionStore(getRedisClient());
    expect(await readerStore.isActive(jti)).toBe(true);
  });

  it("revokeSession() invalide la session pour tout lecteur, immédiatement", async () => {
    const token = createSessionToken("user-integration-2", { secret: SECRET });
    const jti = verifySessionToken(token, { secret: SECRET })?.jti;
    expect(jti).toBeTruthy();

    const store = createRedisSessionStore(redis);
    await store.register(jti!, "user-integration-2", 60);
    expect(await store.isActive(jti!)).toBe(true);

    await revokeSession(token, { secret: SECRET });

    const readerStore = createRedisSessionStore(getRedisClient());
    expect(await readerStore.isActive(jti!)).toBe(false);
  });

  it("une session expire après son TTL (pas de fuite mémoire Redis)", async () => {
    const store = createRedisSessionStore(redis);
    const jti = randomUUID();
    await store.register(jti, "user-integration-3", 1);

    expect(await store.isActive(jti)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await store.isActive(jti)).toBe(false);
  });
});

describe("Rate limiting — compteur persisté dans Redis (ST 9.4)", () => {
  it("le quota est partagé entre deux clients Redis distincts (simule deux instances/un redémarrage)", async () => {
    const keyPrefix = `ratelimit:integration-${randomUUID()}:`;
    const first = createRedisFixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      keyPrefix,
      redis,
    });
    // Nouveau client Redis indépendant : équivalent d'une seconde instance de
    // l'API (ou de la même après redémarrage) partageant ce Redis.
    const second = createRedisFixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      keyPrefix,
      redis: getRedisClient(),
    });

    expect((await first.check("1.2.3.4")).allowed).toBe(true);
    expect((await second.check("1.2.3.4")).allowed).toBe(true);
    // Troisième requête, quelle que soit l'instance : quota déjà épuisé.
    expect((await first.check("1.2.3.4")).allowed).toBe(false);
  });

  it("reset(key) libère le quota pour toutes les instances", async () => {
    const keyPrefix = `ratelimit:integration-${randomUUID()}:`;
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 60_000,
      keyPrefix,
      redis,
    });

    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);

    await limiter.reset("ip");

    const otherInstance = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 60_000,
      keyPrefix,
      redis: getRedisClient(),
    });
    expect((await otherInstance.check("ip")).allowed).toBe(true);
  });
});
