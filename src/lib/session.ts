/**
 * Session applicative — ST 4.1 « Inscription », découpage en tâches :
 * « création de la session » (une fois le compte créé, l'utilisateur est
 * connecté sans avoir à ressaisir ses identifiants).
 *
 * ⚠️ Périmètre ST 4.1. Cette story ne couvre que **l'émission** du jeton de
 * session et la pose du cookie à l'inscription. La **vérification** du jeton
 * (middleware de protection des routes), la déconnexion et la gestion des
 * tentatives de connexion relèvent de ST 4.2 (« Connexion / déconnexion »).
 * `verifySessionToken` est néanmoins fourni ici, testé, pour que ST 4.2
 * n'ait qu'à le brancher.
 *
 * Choix technique (aligné sur ST 4.2, « Choix techniques ») : jeton signé
 * (HMAC-SHA256) déposé dans un cookie `httpOnly` + `SameSite=Lax`, plutôt
 * qu'un token en `localStorage` (exposé au XSS). Jeton **sans état** (pas de
 * table de sessions) : suffisant pour ST 4.1 ; une liste de révocation
 * (logout côté serveur) pourra être ajoutée en ST 4.2.
 *
 * Serveur uniquement (`node:crypto`).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "voxtrait_session";

/** Durée de validité d'une session : 30 jours (cohérent avec un cookie « rester connecté »). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

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

/** Attributs du cookie de session — passés tels quels à `cookies().set(...)` de Next. */
export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: "/";
    maxAge: number;
  };
}

/**
 * Décrit le cookie à poser après une inscription réussie.
 *
 * `secure` est activé hors développement (le cookie n'est alors transmis
 * qu'en HTTPS). `sameSite: "lax"` : protège contre l'essentiel des CSRF tout
 * en laissant la navigation normale (clic sur un lien externe vers le site)
 * conserver la session — la protection CSRF fine des mutations est un point
 * ST 4.2.
 */
export function buildSessionCookie(
  token: string,
  options: { secure?: boolean; maxAge?: number } = {}
): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: options.secure ?? process.env.NODE_ENV !== "development",
      path: "/",
      maxAge: options.maxAge ?? SESSION_TTL_SECONDS,
    },
  };
}
