import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFallbackClock, resolvePlayerMode, validatePlayerUrl } from "../videoPlayer";

// Tests unitaires de la logique du lecteur (ST 1.2, Definition of Done
// "Tests sur les deux modes de lecture").

describe("resolvePlayerMode", () => {
  it("retourne 'native' pour une source UPLOAD", () => {
    expect(resolvePlayerMode("UPLOAD")).toBe("native");
  });

  it("retourne 'embed' pour une source EMBED", () => {
    expect(resolvePlayerMode("EMBED")).toBe("embed");
  });
});

describe("validatePlayerUrl", () => {
  it("rejette une URL absente", () => {
    expect(validatePlayerUrl(undefined)).toMatch(/aucune source/i);
    expect(validatePlayerUrl(null)).toMatch(/aucune source/i);
  });

  it("rejette une chaîne vide ou composée uniquement d'espaces", () => {
    expect(validatePlayerUrl("")).toMatch(/aucune source/i);
    expect(validatePlayerUrl("   ")).toMatch(/aucune source/i);
  });

  it("rejette une URL syntaxiquement invalide", () => {
    expect(validatePlayerUrl("pas-une-url")).toMatch(/invalide/i);
  });

  it("accepte une URL absolue valide", () => {
    expect(validatePlayerUrl("https://example.com/video.mp4")).toBeNull();
  });
});

describe("createFallbackClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'émet aucun tick tant que start() n'a pas été appelé", () => {
    const onTick = vi.fn();
    createFallbackClock({ onTick });
    vi.advanceTimersByTime(1000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("émet des ticks à la cadence configurée une fois démarrée", () => {
    const onTick = vi.fn();
    const clock = createFallbackClock({ onTick, intervalMs: 250 });
    clock.start();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(4);
    expect(onTick).toHaveBeenLastCalledWith(1);
  });

  it("cumule le temps écoulé même après un cycle pause/start", () => {
    const onTick = vi.fn();
    const clock = createFallbackClock({ onTick, intervalMs: 250 });
    clock.start();
    vi.advanceTimersByTime(500); // 0.5 s écoulées
    clock.pause();
    vi.advanceTimersByTime(2000); // ne doit rien accumuler pendant la pause
    clock.start();
    vi.advanceTimersByTime(500); // + 0.5 s
    expect(onTick).toHaveBeenLastCalledWith(1); // 0.5 + 0.5, pas 2.5
  });

  it("reset() ramène le temps écoulé à zéro et notifie immédiatement", () => {
    const onTick = vi.fn();
    const clock = createFallbackClock({ onTick, intervalMs: 250 });
    clock.start();
    vi.advanceTimersByTime(500);
    clock.reset();
    expect(onTick).toHaveBeenLastCalledWith(0);
  });

  it("isRunning() reflète l'état démarré/en pause", () => {
    const clock = createFallbackClock({ onTick: vi.fn() });
    expect(clock.isRunning()).toBe(false);
    clock.start();
    expect(clock.isRunning()).toBe(true);
    clock.pause();
    expect(clock.isRunning()).toBe(false);
  });

  it("start() est idempotent (un second appel n'ouvre pas un second timer)", () => {
    const onTick = vi.fn();
    const clock = createFallbackClock({ onTick, intervalMs: 250 });
    clock.start();
    clock.start();
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("pause() sans start() préalable ne fait rien", () => {
    const onTick = vi.fn();
    const clock = createFallbackClock({ onTick });
    expect(() => clock.pause()).not.toThrow();
    expect(clock.isRunning()).toBe(false);
  });
});
