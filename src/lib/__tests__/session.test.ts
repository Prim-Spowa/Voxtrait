import { describe, expect, it } from "vitest";
import {
  buildSessionCookie,
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "../session";

// ST 4.1 — émission du jeton de session à l'inscription. `verifySessionToken`
// est fourni pour ST 4.2 mais testé ici.

const SECRET = "test-secret-de-32-caracteres-minimum-x";

describe("createSessionToken / verifySessionToken", () => {
  it("émet un jeton que verify accepte et dont il rend la charge utile", () => {
    const now = () => new Date("2026-08-28T10:00:00Z");
    const token = createSessionToken("user-1", { secret: SECRET, now });
    const payload = verifySessionToken(token, { secret: SECRET, now });
    expect(payload?.sub).toBe("user-1");
    expect(payload?.exp).toBe(payload!.iat + SESSION_TTL_SECONDS);
  });

  it("rejette un jeton signé avec un autre secret", () => {
    const token = createSessionToken("user-1", { secret: SECRET });
    expect(verifySessionToken(token, { secret: "un-autre-secret-de-32-caracteres-min" })).toBeNull();
  });

  it("rejette un jeton falsifié (charge utile modifiée)", () => {
    const token = createSessionToken("user-1", { secret: SECRET });
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ sub: "admin", iat: 0, exp: 9999999999 })).toString("base64url")}.${sig}`;
    expect(verifySessionToken(forged, { secret: SECRET })).toBeNull();
  });

  it("rejette un jeton expiré", () => {
    const token = createSessionToken("user-1", {
      secret: SECRET,
      now: () => new Date("2026-08-28T10:00:00Z"),
      ttlSeconds: 60,
    });
    const later = () => new Date("2026-08-28T10:02:00Z");
    expect(verifySessionToken(token, { secret: SECRET, now: later })).toBeNull();
  });

  it("rejette les entrées malformées", () => {
    expect(verifySessionToken(undefined, { secret: SECRET })).toBeNull();
    expect(verifySessionToken("", { secret: SECRET })).toBeNull();
    expect(verifySessionToken("sanspoint", { secret: SECRET })).toBeNull();
    expect(verifySessionToken(".", { secret: SECRET })).toBeNull();
  });

  it("refuse un identifiant utilisateur vide", () => {
    expect(() => createSessionToken("   ", { secret: SECRET })).toThrow();
  });
});

describe("buildSessionCookie", () => {
  it("produit un cookie httpOnly, SameSite=Lax, sur tout le site", () => {
    const cookie = buildSessionCookie("jeton", { secure: true });
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe("jeton");
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  });
});
