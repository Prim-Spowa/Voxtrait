import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "../rateLimit";

// ST 4.1 — rate limiting de l'endpoint d'inscription (points d'attention :
// « éviter les abus/bots »). Horloge injectée pour un test déterministe.
//
// Interface asynchrone depuis ST 9.4 (alignée sur `createRedisFixedWindowRateLimiter`,
// cf. `redisRateLimit.test.ts`) : cette implémentation reste synchrone en
// interne, `await` ne fait que dérouler la promesse résolue immédiatement.

function fixedClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createFixedWindowRateLimiter", () => {
  it("autorise jusqu'à `limit` requêtes puis refuse", async () => {
    const clock = fixedClock();
    const limiter = createFixedWindowRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });

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
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });

    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);

    clock.advance(999);
    expect((await limiter.check("ip")).allowed).toBe(false);

    clock.advance(1);
    expect((await limiter.check("ip")).allowed).toBe(true);
  });

  it("compte chaque clé indépendamment", async () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect((await limiter.check("ip-a")).allowed).toBe(true);
    expect((await limiter.check("ip-b")).allowed).toBe(true);
    expect((await limiter.check("ip-a")).allowed).toBe(false);
  });

  it("reset() rouvre le quota d'une clé, reset() global vide tout", async () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    await limiter.check("ip-a");
    await limiter.check("ip-b");
    await limiter.reset("ip-a");
    expect((await limiter.check("ip-a")).allowed).toBe(true);
    expect((await limiter.check("ip-b")).allowed).toBe(false);
    await limiter.reset();
    expect((await limiter.check("ip-b")).allowed).toBe(true);
  });

  it("rejette une configuration absurde", () => {
    expect(() => createFixedWindowRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createFixedWindowRateLimiter({ limit: 5, windowMs: 0 })).toThrow();
  });
});
