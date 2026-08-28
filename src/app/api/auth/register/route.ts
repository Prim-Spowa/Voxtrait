import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import {
  EmailDejaUtiliseError,
  RegistrationValidationError,
  registerUtilisateur,
  type UtilisateurDelegate,
} from "@/lib/auth";
import { createScryptPasswordHasher, type PasswordHasher } from "@/lib/password";
import { buildSessionCookie, createSessionToken } from "@/lib/session";
import {
  createFixedWindowRateLimiter,
  type RateLimiter,
} from "@/lib/rateLimit";
import { clientIp } from "@/lib/requestIp";

/**
 * POST /api/auth/register — ST 4.1 « Inscription », découpage en tâches
 * point 2 : « Endpoint d'inscription avec validation (format email,
 * robustesse mot de passe, unicité email) ».
 *
 * Corps attendu (`application/json`) : `{ "email": string, "password": string }`.
 *
 * Réponses :
 *  - `201` `{ utilisateur }` + cookie de session `httpOnly` posé (l'utilisateur
 *    est connecté dans la foulée — « création de la session ») ;
 *  - `400` `{ error, fieldErrors? }` : corps illisible ou entrée invalide ;
 *  - `409` `{ error }` : e-mail déjà utilisé ;
 *  - `429` `{ error }` + en-tête `Retry-After` : trop de tentatives depuis
 *    la même IP (anti-bot, cf. ST 4.1 points d'attention).
 *
 * ⚠️ Périmètre, cf. têtes de `lib/auth.ts`, `lib/session.ts`, `lib/rateLimit.ts` :
 *  - hachage **scrypt** (`node:crypto`) et non argon2 (dépendance native
 *    absente) — contrat `PasswordHasher` prêt pour la bascule ;
 *  - jeton de session **sans état**, seulement émis ici : la vérification
 *    (middleware) et la déconnexion relèvent de ST 4.2 ;
 *  - rate limiting **en mémoire, par process** : à remplacer par un store
 *    partagé (Redis) ou une brique d'infra en déploiement multi-instances.
 *  - `DATA_SOURCE=mock` : store `Utilisateur` en mémoire (pas de Postgres).
 */

/** Fenêtre : 5 inscriptions par IP toutes les 10 minutes. */
const REGISTER_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;

const globalForRegister = globalThis as unknown as {
  registerRateLimiter?: RateLimiter;
  registerPasswordHasher?: PasswordHasher;
};

/** Singletons `globalThis` : survivent au hot-reload des modules Next (cf. `lib/prisma.ts`). */
function getRateLimiter(): RateLimiter {
  if (!globalForRegister.registerRateLimiter) {
    globalForRegister.registerRateLimiter = createFixedWindowRateLimiter(REGISTER_RATE_LIMIT);
  }
  return globalForRegister.registerRateLimiter;
}

function getPasswordHasher(): PasswordHasher {
  if (!globalForRegister.registerPasswordHasher) {
    globalForRegister.registerPasswordHasher = createScryptPasswordHasher();
  }
  return globalForRegister.registerPasswordHasher;
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const decision = getRateLimiter().check(clientIp(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives d'inscription. Réessayez dans quelques minutes." },
      {
        status: 429,
        headers: {
          ...noStore,
          "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)),
        },
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

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Les champs « email » et « password » sont requis." },
      { status: 400, headers: noStore }
    );
  }

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : prisma.utilisateur;

  try {
    const utilisateur = await registerUtilisateur(delegate, getPasswordHasher(), {
      email,
      password,
    });

    const token = createSessionToken(utilisateur.id);
    const cookie = buildSessionCookie(token);
    cookies().set(cookie.name, cookie.value, cookie.options);

    return NextResponse.json({ utilisateur }, { status: 201, headers: noStore });
  } catch (err) {
    if (err instanceof RegistrationValidationError) {
      return NextResponse.json(
        { error: err.message, fieldErrors: err.fieldErrors },
        { status: 400, headers: noStore }
      );
    }
    if (err instanceof EmailDejaUtiliseError) {
      return NextResponse.json({ error: err.message }, { status: 409, headers: noStore });
    }
    // Détail technique non propagé au client (cf. `runDoublageJob`, ST 3.1).
    return NextResponse.json(
      { error: "La création du compte a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
