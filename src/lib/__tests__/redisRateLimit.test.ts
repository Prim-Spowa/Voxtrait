import { describe, expect, it } from "vitest";
import { createRedisFixedWindowRateLimiter } from "../redisRateLimit";

/**
 * ST 9.4 « Persistance des sessions et du rate limiting ».
 *
 * Faux client Redis, hors ligne — implémente le sous-ensemble de l'API
 * `ioredis` utilisé par `createRedisFixedWindowRateLimiter` (`incr`, `pexpire`,
 * `pttl`, `del`, `scan`). Horloge injectable pour simuler l'écoulement du
 * TTL, comme `fixedClock` de `rateLimit.test.ts`. Même principe hors ligne que
 * `redisJobStore.test.ts` (ST 9.3) / `sessionStore.test.ts` (ST 9.4).
 */
function createFakeRedis(now: () => number) {
  const counters = new Map<string, { count: number; expiresAt: number | null }>();

  function prune(key: string): { count: number; expiresAt: number | null } | undefined {
    const entry = counters.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      counters.delete(key);
      return undefined;
    }
    return entry;
  }

  const api = {
    async incr(key: string): Promise<number> {
      const existing = prune(key);
      if (!existing) {
        counters.set(key, { count: 1, expiresAt: null });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
    async pexpire(key: string, ms: number): Promise<number> {
      const entry = counters.get(key);
      if (!entry) return 0;
      entry.expiresAt = now() + ms;
      return 1;
    },
    async pttl(key: string): Promise<number> {
      const entry = prune(key);
      if (!entry || entry.expiresAt === null) return -1;
      return Math.max(0, entry.expiresAt - now());
    },
    async del(...keys: string[]): Promise<number> {
      let removed = 0;
      for (const k of keys) if (counters.delete(k)) removed += 1;
      return removed;
    },
    async scan(
      _cursor: string,
      _match: "MATCH",
      pattern: string,
      _count: "COUNT",
      _n: number
    ): Promise<[string, string[]]> {
      const prefix = pattern.replace(/\*$/, "");
      const keys = Array.from(counters.keys()).filter((k) => k.startsWith(prefix));
      return ["0", keys];
    },
  };

  return api as unknown as import("ioredis").default;
}

function fixedClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createRedisFixedWindowRateLimiter", () => {
  it("autorise jusqu'à `limit` requêtes puis refuse", async () => {
    const clock = fixedClock();
    const redis = createFakeRedis(clock.now);
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 3,
      windowMs: 1000,
      keyPrefix: "ratelimit:test:",
      redis,
    });

    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(true);
    const third = await limiter.check("ip");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await limiter.check("ip");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBe(1000);
  });

  it("réouvre le quota à la fin de la fenêtre", async () => {
    const clock = fixedClock();
    const redis = createFakeRedis(clock.now);
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:test:",
      redis,
    });

    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);

    clock.advance(999);
    expect((await limiter.check("ip")).allowed).toBe(false);

    clock.advance(1);
    expect((await limiter.check("ip")).allowed).toBe(true);
  });

  it("compte chaque clé indépendamment", async () => {
    const redis = createFakeRedis(() => 0);
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:test:",
      redis,
    });
    expect((await limiter.check("ip-a")).allowed).toBe(true);
    expect((await limiter.check("ip-b")).allowed).toBe(true);
    expect((await limiter.check("ip-a")).allowed).toBe(false);
  });

  it("deux limiteurs de préfixes différents ne partagent pas leur quota", async () => {
    const redis = createFakeRedis(() => 0);
    const a = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:a:",
      redis,
    });
    const b = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:b:",
      redis,
    });
    expect((await a.check("ip")).allowed).toBe(true);
    expect((await b.check("ip")).allowed).toBe(true);
  });

  it("reset(key) rouvre le quota d'une seule clé", async () => {
    const redis = createFakeRedis(() => 0);
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:test:",
      redis,
    });
    await limiter.check("ip-a");
    await limiter.check("ip-b");
    await limiter.reset("ip-a");
    expect((await limiter.check("ip-a")).allowed).toBe(true);
    expect((await limiter.check("ip-b")).allowed).toBe(false);
  });

  it("reset() sans clé vide tout le préfixe de ce limiteur", async () => {
    const redis = createFakeRedis(() => 0);
    const limiter = createRedisFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      keyPrefix: "ratelimit:test:",
      redis,
    });
    await limiter.check("ip-a");
    await limiter.check("ip-b");
    await limiter.reset();
    expect((await limiter.check("ip-a")).allowed).toBe(true);
    expect((await limiter.check("ip-b")).allowed).toBe(true);
  });

  it("rejette une configuration absurde", () => {
    const redis = createFakeRedis(() => 0);
    expect(() =>
      createRedisFixedWindowRateLimiter({ limit: 0, windowMs: 1000, keyPrefix: "x:", redis })
    ).toThrow();
    expect(() =>
      createRedisFixedWindowRateLimiter({ limit: 5, windowMs: 0, keyPrefix: "x:", redis })
    ).toThrow();
    expect(() =>
      createRedisFixedWindowRateLimiter({ limit: 5, windowMs: 1000, keyPrefix: "", redis })
    ).toThrow();
  });
});
