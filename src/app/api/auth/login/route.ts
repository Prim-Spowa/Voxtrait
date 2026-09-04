import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import {
  authenticateUtilisateur,
  CompteSuspenduError,
  InvalidCredentialsError,
  type UtilisateurDelegate,
} from "@/lib/auth";
import { LOGIN_GENERIC_ERROR } from "@/lib/authClient";
import { createScryptPasswordHasher, type PasswordHasher } from "@/lib/password";
import { buildSessionCookie, issueSession, resolveSessionTtlSeconds } from "@/lib/session";
import { getFixedWindowRateLimiter } from "@/lib/rateLimiterFactory";
import { clientIp } from "@/lib/requestIp";

/**
 * POST /api/auth/login — ST 4.2 « Connexion / déconnexion », découpage en
 * tâches point 1 : « Endpoint login avec gestion des tentatives échouées ».
 *
 * Corps attendu (`application/json`) :
 * `{ "email": string, "password": string, "rememberMe"?: boolean }`.
 *
 * Mise à jour ST 4.2 (« Rester connecté ») : `rememberMe` ne change que la
 * durée de vie du jeton/cookie émis (`resolveSessionTtlSeconds`,
 * `lib/session.shared.ts`) — 8 h par défaut (case décochée / champ absent),
 * 30 j si `true`. N'influence ni la validation des identifiants ni le
 * rate limiting. Une valeur non booléenne est traitée comme `false` (repli
 * sûr : session courte).
 *
 * Réponses :
 *  - `200` `{ utilisateur }` + cookie de session `httpOnly` posé ;
 *  - `400` `{ error }` : corps illisible ou champs manquants ;
 *  - `401` `{ error }` : identifiants invalides (message générique, cf.
 *    `LOGIN_GENERIC_ERROR` — anti-énumération de comptes) ;
 *  - `403` `{ error }` : identifiants corrects mais compte suspendu ;
 *  - `429` `{ error }` + `Retry-After` : trop de tentatives **échouées**
 *    depuis la même IP.
 *
 * Gestion des tentatives échouées : le compteur de rate limiting est
 * incrémenté à chaque requête, mais **remis à zéro sur une connexion
 * réussie**. Concrètement, seules les tentatives infructueuses consomment le
 * quota — un utilisateur qui se trompe puis se corrige n'est pas pénalisé,
 * un script de bourrage d'identifiants est freiné.
 *
 * ⚠️ Périmètre / limites (mêmes réserves que ST 4.1) :
 *  - hachage **scrypt** (`node:crypto`), pas argon2 — contrat `PasswordHasher`
 *    prêt pour la bascule ;
 *  - rate limiting et session persistés dans Redis (`getFixedWindowRateLimiter`,
 *    `issueSession` — ST 9.4), en mémoire par process seulement en mode
 *    `DATA_SOURCE=mock`.
 */

/** Fenêtre : 10 tentatives échouées par IP toutes les 15 minutes. */
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

const globalForLogin = globalThis as unknown as {
  loginPasswordHasher?: PasswordHasher;
};

function getRateLimiter() {
  return getFixedWindowRateLimiter("login", LOGIN_RATE_LIMIT);
}

function getPasswordHasher(): PasswordHasher {
  if (!globalForLogin.loginPasswordHasher) {
    globalForLogin.loginPasswordHasher = createScryptPasswordHasher();
  }
  return globalForLogin.loginPasswordHasher;
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };
  const limiter = getRateLimiter();
  const ip = clientIp(request);

  const decision = await limiter.check(ip);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives de connexion. Réessayez dans quelques minutes." },
      {
        status: 429,
        headers: { ...noStore, "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requête JSON invalide." },
      { status: 400, headers: noStore }
    );
  }

  const { email, password, rememberMe } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Les champs « email » et « password » sont requis." },
      { status: 400, headers: noStore }
    );
  }
  // Repli sûr sur une valeur non booléenne (absente, chaîne, etc.) : session
  // courte, comme si la case n'était pas cochée.
  const ttlSeconds = resolveSessionTtlSeconds(rememberMe === true);

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : prisma.utilisateur;

  try {
    const utilisateur = await authenticateUtilisateur(delegate, getPasswordHasher(), {
      email,
      password,
    });

    // Connexion réussie : on libère le quota de cette IP (« gestion des
    // tentatives échouées » — seuls les échecs comptent).
    await limiter.reset(ip);

    const { token } = await issueSession(utilisateur.id, { ttlSeconds });
    const cookie = buildSessionCookie(token, { maxAge: ttlSeconds });
    cookies().set(cookie.name, cookie.value, cookie.options);

    return NextResponse.json({ utilisateur }, { status: 200, headers: noStore });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return NextResponse.json(
        { error: LOGIN_GENERIC_ERROR },
        { status: 401, headers: noStore }
      );
    }
    if (err instanceof CompteSuspenduError) {
      return NextResponse.json({ error: err.message }, { status: 403, headers: noStore });
    }
    // Détail technique non propagé au client (cf. `runDoublageJob`, ST 3.1).
    return NextResponse.json(
      { error: "La connexion a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
