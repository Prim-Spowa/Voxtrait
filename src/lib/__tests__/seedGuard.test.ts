import { describe, expect, it } from "vitest";
import { SeedProductionGuardError, assertSeedAllowed } from "@/lib/seedGuard";

describe("assertSeedAllowed", () => {
  it("ne lève rien hors production (développement)", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });

  it("ne lève rien hors production (test, environnement CI par défaut)", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
  });

  it("ne lève rien quand NODE_ENV est absent", () => {
    expect(() => assertSeedAllowed({})).not.toThrow();
  });

  it("lève SeedProductionGuardError en production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      SeedProductionGuardError
    );
  });

  it("laisse passer en production avec l'échappatoire explicite ALLOW_PRODUCTION_SEED=true", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PRODUCTION_SEED: "true" })
    ).not.toThrow();
  });

  it("reste bloqué en production si l'échappatoire est mal orthographiée/vide", () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PRODUCTION_SEED: "" })
    ).toThrow(SeedProductionGuardError);
    expect(() =>
      assertSeedAllowed({ NODE_ENV: "production", ALLOW_PRODUCTION_SEED: "yes" })
    ).toThrow(SeedProductionGuardError);
  });
});
