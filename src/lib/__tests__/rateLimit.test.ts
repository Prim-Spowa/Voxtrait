import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "../rateLimit";

// ST 4.1 — rate limiting de l'endpoint d'inscription (points d'attention :
// « éviter les abus/bots »). Horloge injectée pour un test déterministe.

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
  it("autorise jusqu'à `limit` requêtes puis refuse", () => {
    const clock = fixedClock();
    const limiter = createFixedWindowRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });

    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    const third = limiter.check("ip");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = limiter.check("ip");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBe(1000);
  });

  it("réouvre le quota à la fin de la fenêtre", () => {
    const clock = fixedClock();
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });

    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(999);
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(1);
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("compte chaque clé indépendamment", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-b").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(false);
  });

  it("reset() rouvre le quota d'une clé, reset() global vide tout", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    limiter.check("ip-a");
    limiter.check("ip-b");
    limiter.reset("ip-a");
    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-b").allowed).toBe(false);
    limiter.reset();
    expect(limiter.check("ip-b").allowed).toBe(true);
  });

  it("rejette une configuration absurde", () => {
    expect(() => createFixedWindowRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createFixedWindowRateLimiter({ limit: 5, windowMs: 0 })).toThrow();
  });
});
