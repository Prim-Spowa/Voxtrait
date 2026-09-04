import { afterEach, describe, expect, it, vi } from "vitest";
import { getMediaUrlSecret, signMediaRef, verifyMediaToken } from "@/lib/media/mediaUrlSigning";

describe("mediaUrlSigning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signe puis vérifie un jeton valide pour la même ref", () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const token = signMediaRef("imports/user-1/abc.mp4", 900, now);
    expect(
      verifyMediaToken("imports/user-1/abc.mp4", String(token.exp), token.sig, now)
    ).toBe(true);
  });

  it("rejette une ref différente de celle signée", () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const token = signMediaRef("imports/user-1/abc.mp4", 900, now);
    expect(verifyMediaToken("imports/user-1/autre.mp4", String(token.exp), token.sig, now)).toBe(
      false
    );
  });

  it("rejette un jeton expiré", () => {
    const issuedAt = () => new Date("2026-01-01T00:00:00.000Z");
    const token = signMediaRef("doublages/output/x.mp4", 60, issuedAt);
    const later = () => new Date("2026-01-01T00:02:00.000Z"); // +120s > TTL 60s
    expect(verifyMediaToken("doublages/output/x.mp4", String(token.exp), token.sig, later)).toBe(
      false
    );
  });

  it("rejette une signature falsifiée ou absente", () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const token = signMediaRef("ref", 900, now);
    expect(verifyMediaToken("ref", String(token.exp), "signature-invalide", now)).toBe(false);
    expect(verifyMediaToken("ref", String(token.exp), null, now)).toBe(false);
    expect(verifyMediaToken("ref", "not-a-number", token.sig, now)).toBe(false);
  });

  it("lève en production si MEDIA_URL_SECRET est absent/trop court", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEDIA_URL_SECRET", "");
    expect(() => getMediaUrlSecret()).toThrow();
  });
});
