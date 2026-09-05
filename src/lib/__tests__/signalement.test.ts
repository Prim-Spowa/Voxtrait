import { beforeEach, describe, expect, it } from "vitest";
import {
  creerSignalement,
  createInMemorySignalementStore,
  toSignalementView,
  type SignalementStore,
} from "../signalement";
import { SignalementPayloadError } from "../signalementClient";
import { createFixedWindowRateLimiter } from "../rateLimit";

// ST 7.1, Definition of Done technique : « Tests unitaires sur la création de
// signalement ; test de rate limiting ».

const CONTENU = { contenuType: "EXTRAIT", contenuId: "mock-001", motif: "Spam" } as const;

let store: SignalementStore;

beforeEach(() => {
  // Horloge fixe → `dateCreation` déterministe.
  store = createInMemorySignalementStore(() => new Date("2026-09-04T10:00:00.000Z"));
});

describe("creerSignalement", () => {
  it("crée un signalement au statut EN_ATTENTE (visiteur non connecté)", async () => {
    const signalement = await creerSignalement(store, CONTENU);

    expect(signalement).toMatchObject({
      contenuType: "EXTRAIT",
      contenuId: "mock-001",
      motif: "Spam",
      auteurId: null,
      statut: "EN_ATTENTE",
      dateCreation: "2026-09-04T10:00:00.000Z",
    });
    expect(signalement.id).toMatch(/^signalement-/);
    expect(await store.count()).toBe(1);
  });

  it("enregistre l'auteur quand un compte est fourni", async () => {
    const signalement = await creerSignalement(store, CONTENU, { auteurId: " user-7 " });
    expect(signalement.auteurId).toBe("user-7");
  });

  it("traite un auteur vide comme absent", async () => {
    const signalement = await creerSignalement(store, CONTENU, { auteurId: "   " });
    expect(signalement.auteurId).toBeNull();
  });

  it("valide un corps brut : motif obligatoire", async () => {
    await expect(
      creerSignalement(store, { contenuType: "EXTRAIT", contenuId: "mock-001" })
    ).rejects.toBeInstanceOf(SignalementPayloadError);
    expect(await store.count()).toBe(0);
  });

  it("revalide même un payload déjà typé (trim + bornes)", async () => {
    const signalement = await creerSignalement(store, {
      contenuType: "DOUBLAGE",
      contenuId: "  job-3  ",
      motif: "  Droits d'auteur  ",
    });
    expect(signalement.contenuId).toBe("job-3");
    expect(signalement.motif).toBe("Droits d'auteur");
  });

  it("autorise plusieurs signalements sur le même contenu", async () => {
    await creerSignalement(store, CONTENU);
    await creerSignalement(store, { ...CONTENU, motif: "Autre motif" });
    expect(await store.count()).toBe(2);
  });
});

describe("toSignalementView", () => {
  it("n'expose ni le motif ni l'auteur", async () => {
    const signalement = await creerSignalement(store, CONTENU, { auteurId: "user-7" });
    const view = toSignalementView(signalement);

    expect(view).toEqual({
      id: signalement.id,
      contenuType: "EXTRAIT",
      contenuId: "mock-001",
      statut: "EN_ATTENTE",
      dateCreation: "2026-09-04T10:00:00.000Z",
    });
    expect(view).not.toHaveProperty("motif");
    expect(view).not.toHaveProperty("auteurId");
  });
});

describe("rate limiting du signalement (POST /api/signalements)", () => {
  // Reproduit la configuration de la route : 10 requêtes / IP / 10 min.
  const LIMIT = 10;
  const WINDOW_MS = 10 * 60 * 1000;

  function fixedClock(start = 0) {
    let current = start;
    return { now: () => current, advance: (ms: number) => (current += ms) };
  }

  it("autorise jusqu'à la limite puis renvoie un refus avec délai", async () => {
    const clock = fixedClock();
    const limiter = createFixedWindowRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      now: clock.now,
    });

    for (let i = 0; i < LIMIT; i += 1) {
      expect((await limiter.check("1.2.3.4")).allowed).toBe(true);
    }

    const refus = await limiter.check("1.2.3.4");
    expect(refus.allowed).toBe(false);
    expect(Math.ceil(refus.retryAfterMs / 1000)).toBe(WINDOW_MS / 1000);
  });

  it("compte les IP indépendamment", async () => {
    const limiter = createFixedWindowRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      now: () => 0,
    });
    expect((await limiter.check("10.0.0.1")).allowed).toBe(true);
    expect((await limiter.check("10.0.0.2")).allowed).toBe(true);
    expect((await limiter.check("10.0.0.1")).allowed).toBe(false);
  });

  it("rouvre le quota à la fin de la fenêtre", async () => {
    const clock = fixedClock();
    const limiter = createFixedWindowRateLimiter({
      limit: 1,
      windowMs: WINDOW_MS,
      now: clock.now,
    });
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);
    clock.advance(WINDOW_MS);
    expect((await limiter.check("ip")).allowed).toBe(true);
  });
});
