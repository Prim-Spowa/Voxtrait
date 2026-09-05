import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  issueSession,
  readActiveSessionFromCookieStore,
  readSessionFromCookieStore,
  resolveSessionTtlSeconds,
  revokeSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SESSION_TTL_SHORT_SECONDS,
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

describe("buildClearedSessionCookie", () => {
  it("produit un cookie vide qui expire immédiatement (déconnexion)", () => {
    const cookie = buildClearedSessionCookie({ secure: true });
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe("");
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  });
});

describe("resolveSessionTtlSeconds (ST 4.2 — « Rester connecté »)", () => {
  it("renvoie la durée courte par défaut (case décochée / champ absent)", () => {
    expect(resolveSessionTtlSeconds(false)).toBe(SESSION_TTL_SHORT_SECONDS);
    expect(resolveSessionTtlSeconds(undefined)).toBe(SESSION_TTL_SHORT_SECONDS);
  });

  it("renvoie la durée longue quand rememberMe est explicitement true", () => {
    expect(resolveSessionTtlSeconds(true)).toBe(SESSION_TTL_SECONDS);
  });

  it("la durée courte reste nettement plus courte que la longue", () => {
    expect(SESSION_TTL_SHORT_SECONDS).toBeLessThan(SESSION_TTL_SECONDS);
  });
});

/** Faux store de cookies (sous-ensemble de `cookies()`/`request.cookies`). */
function store(value?: string) {
  return {
    get: (name: string) =>
      name === SESSION_COOKIE_NAME && value !== undefined ? { value } : undefined,
  };
}

describe("readSessionFromCookieStore", () => {
  const now = () => new Date("2026-08-28T10:00:00Z");

  it("renvoie la charge utile quand le cookie porte un jeton valide", () => {
    const token = createSessionToken("user-42", { secret: SECRET, now });
    const payload = readSessionFromCookieStore(store(token), { secret: SECRET, now });
    expect(payload?.sub).toBe("user-42");
  });

  it("renvoie null quand le cookie est absent", () => {
    expect(readSessionFromCookieStore(store(), { secret: SECRET, now })).toBeNull();
  });

  it("renvoie null quand le jeton est falsifié", () => {
    expect(
      readSessionFromCookieStore(store("nimportequoi.signature"), { secret: SECRET, now })
    ).toBeNull();
  });
});

// ST 9.4 — révocation des sessions (`lib/sessionStore.ts`). `DATA_SOURCE=mock`
// force le store en mémoire (`createInMemorySessionStore`, cf.
// `sessionStore.test.ts` pour les deux implémentations) : ces tests
// n'exigent donc pas de Redis, comme le reste de la suite unitaire.
describe("jti et store de révocation (ST 9.4)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("createSessionToken génère un jti par défaut, stable pour un même jeton", () => {
    const token = createSessionToken("user-1", { secret: SECRET });
    const payload = verifySessionToken(token, { secret: SECRET });
    expect(typeof payload?.jti).toBe("string");
    expect(payload?.jti).not.toBe("");
  });

  it("deux jetons émis séparément ont des jti distincts", () => {
    const a = verifySessionToken(createSessionToken("user-1", { secret: SECRET }), {
      secret: SECRET,
    });
    const b = verifySessionToken(createSessionToken("user-1", { secret: SECRET }), {
      secret: SECRET,
    });
    expect(a?.jti).not.toBe(b?.jti);
  });

  it("issueSession enregistre la session : readActiveSessionFromCookieStore l'accepte", async () => {
    vi.stubEnv("DATA_SOURCE", "mock");
    const { token } = await issueSession("user-1", { secret: SECRET, ttlSeconds: 60 });

    const payload = await readActiveSessionFromCookieStore(store(token), { secret: SECRET });
    expect(payload?.sub).toBe("user-1");
  });

  it("revokeSession invalide immédiatement une session émise par issueSession", async () => {
    vi.stubEnv("DATA_SOURCE", "mock");
    const { token } = await issueSession("user-2", { secret: SECRET, ttlSeconds: 60 });

    await revokeSession(token, { secret: SECRET });

    expect(await readActiveSessionFromCookieStore(store(token), { secret: SECRET })).toBeNull();
    // Le jeton reste cryptographiquement valide (signature/expiration
    // inchangées) : seule la vérification *active* (Redis/mémoire) le rejette.
    expect(verifySessionToken(token, { secret: SECRET })?.sub).toBe("user-2");
  });

  it("readActiveSessionFromCookieStore accepte un jeton sans jti (compatibilité pré-ST 9.4)", async () => {
    vi.stubEnv("DATA_SOURCE", "mock");
    const now = () => new Date("2026-08-28T10:00:00Z");
    // `createSessionToken` génère toujours un jti désormais ; on simule un
    // jeton pré-ST 9.4 en le retirant du payload puis en resignant.
    const token = createSessionToken("user-3", { secret: SECRET, now });
    const [encodedPayload] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
    delete payload.jti;
    const reencodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = Buffer.from(
      createHmac("sha256", SECRET).update(reencodedPayload).digest()
    ).toString("base64url");
    const legacyToken = `${reencodedPayload}.${signature}`;

    const active = await readActiveSessionFromCookieStore(store(legacyToken), {
      secret: SECRET,
      now,
    });
    expect(active?.sub).toBe("user-3");
  });

  it("revokeSession est silencieuse pour un jeton absent/invalide (déconnexion idempotente)", async () => {
    vi.stubEnv("DATA_SOURCE", "mock");
    await expect(revokeSession(undefined)).resolves.toBeUndefined();
    await expect(revokeSession("nimportequoi")).resolves.toBeUndefined();
  });
});
