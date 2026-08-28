/**
 * Constantes et helpers de session **sans dépendance cryptographique** —
 * ST 4.2 « Connexion / déconnexion ».
 *
 * Extrait de `lib/session.ts` (qui, lui, importe `node:crypto` pour signer /
 * vérifier le jeton) pour pouvoir être importé depuis :
 *  - `src/middleware.ts`, qui s'exécute sur le runtime **Edge** de Next où
 *    `node:crypto` n'est pas disponible (cf. tête de `src/middleware.ts`) ;
 *  - `lib/authGuard.ts`, logique de routage pure.
 *
 * `lib/session.ts` ré-exporte tout ce module : les imports existants
 * (`import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/session"`)
 * restent valides.
 */

/** Nom du cookie de session (identique à ST 4.1). */
export const SESSION_COOKIE_NAME = "voxtrait_session";

/** Durée de validité d'une session : 30 jours (cookie « rester connecté »). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

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

/** `secure` activé hors développement (cookie transmis uniquement en HTTPS). */
function secureByDefault(explicit?: boolean): boolean {
  return explicit ?? process.env.NODE_ENV !== "development";
}

/**
 * Décrit le cookie à poser après une authentification réussie (inscription
 * ST 4.1 ou connexion ST 4.2).
 *
 * `sameSite: "lax"` : protège contre l'essentiel des CSRF tout en laissant la
 * navigation normale (clic sur un lien externe vers le site) conserver la
 * session. La protection CSRF fine des mutations authentifiées reste un point
 * ouvert (cf. notes de dev ST 4.2).
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
      secure: secureByDefault(options.secure),
      path: "/",
      maxAge: options.maxAge ?? SESSION_TTL_SECONDS,
    },
  };
}

/**
 * Décrit le cookie à poser pour **fermer** la session (déconnexion, ST 4.2,
 * découpage en tâches point 2 : « Endpoint logout »).
 *
 * `value: ""` + `maxAge: 0` : le navigateur supprime immédiatement le cookie.
 * Le jeton étant **sans état** (pas de table de sessions), c'est la seule
 * action nécessaire côté serveur — un jeton déjà copié ailleurs resterait
 * cryptographiquement valide jusqu'à son expiration. Une liste de révocation
 * serveur est signalée en notes de dev comme évolution possible.
 *
 * Les autres attributs sont identiques à `buildSessionCookie` : un cookie
 * n'est effacé par le navigateur que si `Path` (et `Secure`/`SameSite`)
 * correspondent à ceux de la pose.
 */
export function buildClearedSessionCookie(
  options: { secure?: boolean } = {}
): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureByDefault(options.secure),
      path: "/",
      maxAge: 0,
    },
  };
}
