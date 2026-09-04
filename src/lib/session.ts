/**
 * Session applicative — émission et **vérification** du jeton de session.
 *
 * - ST 4.1 « Inscription » : émission du jeton + pose du cookie à la création
 *   du compte (`createSessionToken`, `buildSessionCookie`).
 * - ST 4.2 « Connexion / déconnexion » : vérification du jeton
 *   (`verifySessionToken`, `readSessionFromCookieStore`) pour le middleware de
 *   protection des routes et l'endpoint de session ; fermeture du cookie à la
 *   déconnexion (`buildClearedSessionCookie`).
 *
 * Choix technique (ST 4.2, « Choix techniques ») : jeton signé (HMAC-SHA256)
 * déposé dans un cookie `httpOnly` + `SameSite=Lax`, plutôt qu'un token en
 * `localStorage` (exposé au XSS). Jeton **sans état** (pas de table de
 * sessions) : la déconnexion se limite à effacer le cookie ; une liste de
 * révocation serveur est signalée en notes de dev comme évolution possible.
 *
 * Serveur uniquement (`node:crypto`). Les constantes et helpers de cookie
 * **sans** dépendance crypto vivent dans `lib/session.shared.ts` (importable
 * depuis le middleware Edge) et sont ré-exportés ici pour compatibilité.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SESSION_TTL_SHORT_SECONDS,
  buildSessionCookie,
  buildClearedSessionCookie,
  resolveSessionTtlSeconds,
  type SessionCookie,
} from "@/lib/session.shared";

import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/session.shared";

/** Charge utile du jeton — volontairement minimale (pas de PII autre que l'id). */
export interface SessionPayload {
  /** Id de l'utilisateur (`Utilisateur.id`). */
  sub: string;
  /** Émission (timestamp Unix, secondes). */
  iat: number;
  /** Expiration (timestamp Unix, secondes). */
  exp: number;
}

/**
 * Secret de signature. En production, `AUTH_SESSION_SECRET` **doit** être
 * défini (au moins 32 caractères) — sinon on lève, plutôt que de signer avec
 * une valeur connue. Hors production, un secret de repli permet de faire
 * tourner `next dev` / la CI sans configuration, avec un avertissement.
 */
export function getSessionSecret(): string {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SESSION_SECRET manquant ou trop court (>= 32 caractères requis) en production."
    );
  }
  if (configured) {
    console.warn(
      "[session] AUTH_SESSION_SECRET trop court, repli sur un secret de développement."
    );
  }
  return "dev-only-insecure-session-secret-change-me";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(data: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(data).digest());
}

export interface CreateSessionTokenOptions {
  /** Secret de signature (défaut : `getSessionSecret()`). */
  secret?: string;
  /** Instant d'émission (défaut : maintenant). Injectable pour les tests. */
  now?: () => Date;
  /** Durée de vie en secondes (défaut : `SESSION_TTL_SECONDS`). */
  ttlSeconds?: number;
}

/**
 * Construit un jeton de session signé pour un utilisateur donné.
 * Format : `base64url(payloadJson).base64url(hmac)` — proche d'un JWT sans
 * l'en-tête (algorithme figé, pas de négociation).
 */
export function createSessionToken(
  userId: string,
  options: CreateSessionTokenOptions = {}
): string {
  const id = (userId ?? "").trim();
  if (!id) throw new Error("createSessionToken: identifiant utilisateur manquant.");

  const secret = options.secret ?? getSessionSecret();
  const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;

  const payload: SessionPayload = { sub: id, iat: nowSeconds, exp: nowSeconds + ttl };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export interface VerifySessionTokenOptions {
  secret?: string;
  now?: () => Date;
}

/**
 * Vérifie signature + expiration d'un jeton. Retourne la charge utile si le
 * jeton est valide, `null` sinon (signature invalide, format cassé, expiré).
 * Comparaison de signature en temps constant.
 *
 * Fourni pour ST 4.2 (middleware d'authentification) — non appelé par ST 4.1.
 */
export function verifySessionToken(
  token: string | undefined | null,
  options: VerifySessionTokenOptions = {}
): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const encodedPayload = token.slice(0, dot);
  const providedSignature = token.slice(dot + 1);
  const secret = options.secret ?? getSessionSecret();
  const expectedSignature = sign(encodedPayload, secret);

  const provided = fromBase64url(providedSignature);
  const expected = fromBase64url(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;

  const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  if (nowSeconds >= payload.exp) return null;

  return payload;
}

/**
 * Store de cookies minimal — sous-ensemble commun à `cookies()` de
 * `next/headers` (Server Components, Route Handlers) et à `request.cookies`
 * d'un `NextRequest`. Permet d'injecter un faux store en test.
 */
export interface ReadonlyCookieStore {
  get(name: string): { value: string } | undefined;
}

/**
 * Lit et vérifie le jeton de session présent dans un store de cookies.
 * Retourne la charge utile si la session est valide, `null` sinon (cookie
 * absent, jeton falsifié, expiré).
 *
 * Point d'entrée de la protection des routes côté serveur (ST 4.2, découpage
 * en tâches point 3) : appelé par l'endpoint `GET /api/auth/session` et par
 * tout Route Handler / Server Component réservé aux comptes. Le middleware
 * Edge, lui, ne fait qu'un contrôle de présence (il ne peut pas exécuter
 * `node:crypto`) — cf. `src/middleware.ts`.
 */
export function readSessionFromCookieStore(
  store: ReadonlyCookieStore,
  options: VerifySessionTokenOptions = {}
): SessionPayload | null {
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value, options);
}
