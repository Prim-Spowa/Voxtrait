/**
 * Session applicative — émission et **vérification** du jeton de session.
 *
 * - ST 4.1 « Inscription » : émission du jeton + pose du cookie à la création
 *   du compte (`createSessionToken`, `buildSessionCookie`).
 * - ST 4.2 « Connexion / déconnexion » : vérification du jeton
 *   (`verifySessionToken`, `readSessionFromCookieStore`) pour le middleware de
 *   protection des routes et l'endpoint de session ; fermeture du cookie à la
 *   déconnexion (`buildClearedSessionCookie`).
 * - ST 9.4 « Persistance des sessions et du rate limiting » : chaque jeton
 *   porte désormais un identifiant de session (`jti`), enregistré dans un
 *   store partagé (`lib/sessionStore.ts`) pour permettre une **vraie**
 *   révocation à la déconnexion (`readActiveSessionFromCookieStore`).
 *
 * Choix technique (ST 4.2, « Choix techniques ») : jeton signé (HMAC-SHA256)
 * déposé dans un cookie `httpOnly` + `SameSite=Lax`, plutôt qu'un token en
 * `localStorage` (exposé au XSS).
 *
 * ⚠️ `verifySessionToken`/`readSessionFromCookieStore` restent des vérifications
 * **sans état** (signature + expiration uniquement, pas d'accès réseau) — le
 * jeton d'un compte déconnecté ailleurs y reste valide jusqu'à son expiration.
 * `readActiveSessionFromCookieStore` (ci-dessous) ajoute le contrôle de
 * révocation (`lib/sessionStore.ts`, ST 9.4) et doit être préféré partout où
 * une déconnexion doit prendre effet immédiatement (tous les endpoints
 * protégés du projet, cf. `importAuth.ts`/`moderationAuth.ts`/les routes
 * `GET`/`POST` sous compte).
 *
 * Serveur uniquement (`node:crypto`). Les constantes et helpers de cookie
 * **sans** dépendance crypto vivent dans `lib/session.shared.ts` (importable
 * depuis le middleware Edge) et sont ré-exportés ici pour compatibilité.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getSessionStore } from "@/lib/sessionStore";

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
  /**
   * Identifiant de session (ST 9.4) — clé de `lib/sessionStore.ts` permettant
   * la révocation à la déconnexion. Présent sur tout jeton émis depuis
   * ST 9.4 ; absent sur un jeton émis par une version antérieure du code
   * (compte déjà connecté au moment du déploiement) — `readActiveSessionFromCookieStore`
   * traite alors ce jeton comme non révocable et le laisse expirer
   * naturellement plutôt que de déconnecter tout le monde au déploiement.
   */
  jti?: string;
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
  /**
   * Identifiant de session à inscrire dans le jeton (défaut : généré via
   * `crypto.randomUUID()`). Injectable pour des tests déterministes ; les
   * appelants réels (`POST /api/auth/register`/`login`) laissent la valeur
   * par défaut et récupèrent le `jti` généré via `verifySessionToken`/
   * `readSessionFromCookieStore` avant de l'enregistrer dans
   * `lib/sessionStore.ts` — cf. `issueSession` ci-dessous.
   */
  jti?: string;
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
  const jti = options.jti ?? randomUUID();

  const payload: SessionPayload = { sub: id, iat: nowSeconds, exp: nowSeconds + ttl, jti };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Émet un jeton de session **et** l'enregistre dans le store de révocation
 * (`lib/sessionStore.ts`, ST 9.4) — à utiliser à la place de
 * `createSessionToken` seul par tout endpoint qui authentifie un compte
 * (`POST /api/auth/register`, `POST /api/auth/login`).
 *
 * Regroupées ici pour que les deux endpoints d'émission restent synchronisés :
 * un jeton émis sans entrée dans le store serait rejeté par
 * `readActiveSessionFromCookieStore` dès la requête suivante.
 */
export async function issueSession(
  userId: string,
  options: CreateSessionTokenOptions = {}
): Promise<{ token: string; jti: string }> {
  const jti = options.jti ?? randomUUID();
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const token = createSessionToken(userId, { ...options, jti });
  await getSessionStore().register(jti, userId, ttlSeconds);
  return { token, jti };
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

/**
 * Comme `readSessionFromCookieStore`, mais vérifie **en plus** que la session
 * n'a pas été révoquée (déconnexion, `lib/sessionStore.ts`, ST 9.4) — c'est la
 * vérification à utiliser par tout endpoint protégé (`GET /api/auth/session`,
 * `importAuth.ts`, `moderationAuth.ts`, les routes sous compte de ST 6.x/8.1),
 * pour qu'une déconnexion prenne effet immédiatement même si le jeton signé
 * reste valide jusqu'à son expiration.
 *
 * Un jeton sans `jti` (émis par une version du code antérieure à ST 9.4,
 * cf. `SessionPayload.jti`) est traité comme actif — pas de révocation
 * possible pour cette session, laissée expirer naturellement.
 *
 * Accès Redis (via `getSessionStore()`) : à réserver au runtime Node — ne pas
 * appeler depuis `src/middleware.ts` (Edge, cf. tête de ce fichier).
 */
export async function readActiveSessionFromCookieStore(
  store: ReadonlyCookieStore,
  options: VerifySessionTokenOptions = {}
): Promise<SessionPayload | null> {
  const payload = readSessionFromCookieStore(store, options);
  if (!payload) return null;
  if (!payload.jti) return payload;

  const active = await getSessionStore().isActive(payload.jti);
  return active ? payload : null;
}

/**
 * Révoque la session portée par `token`, si elle en a une (`jti`) — appelée à
 * la déconnexion (`POST /api/auth/logout`, ST 9.4). Silencieuse si `token` est
 * absent/invalide/sans `jti` : la déconnexion reste idempotente (cf. tête de
 * `POST /api/auth/logout`).
 */
export async function revokeSession(
  token: string | undefined | null,
  options: VerifySessionTokenOptions = {}
): Promise<void> {
  const payload = verifySessionToken(token, options);
  if (!payload?.jti) return;
  await getSessionStore().revoke(payload.jti);
}
