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
import { buildSessionCookie, issueSession } from "@/lib/session";
import { getFixedWindowRateLimiter } from "@/lib/rateLimiterFactory";
import { clientIp } from "@/lib/requestIp";

/**
 * POST /api/auth/register — ST 4.1 « Inscription », découpage en tâches
 * point 2 : « Endpoint d'inscription avec validation (format email,
 * robustesse mot de passe, unicité email) ».
 *
 * Corps attendu (`application/json`) : `{ "email": string, "password": string,
 * "nom": string, "prenom": string, "age": number, "accepteCgu": boolean }`
 * (`nom`/`prenom`/`age` ajoutés à la mise à jour de ST 4.1).
 *
 * Réponses :
 *  - `201` `{ utilisateur }` + cookie de session `httpOnly` posé (l'utilisateur
 *    est connecté dans la foulée — « création de la session ») ;
 *  - `400` `{ error, fieldErrors? }` : corps illisible ou entrée invalide ;
 *  - `409` `{ error }` : e-mail déjà utilisé ;
 *  - `429` `{ error }` + en-tête `Retry-After` : trop de tentatives depuis
 *    la même IP (anti-bot, cf. ST 4.1 points d'attention).
 *
 * ⚠️ Périmètre, cf. têtes de `lib/auth.ts`, `lib/session.ts` :
 *  - hachage **scrypt** (`node:crypto`) et non argon2 (dépendance native
 *    absente) — contrat `PasswordHasher` prêt pour la bascule ;
 *  - jeton de session émis ici et enregistré dans le store de révocation
 *    (`issueSession`, ST 9.4) : la vérification (middleware) relève de ST 4.2,
 *    la déconnexion révoque réellement la session depuis ST 9.4 ;
 *  - rate limiting persisté dans Redis (`getFixedWindowRateLimiter`, ST 9.4),
 *    en mémoire par process seulement en mode `DATA_SOURCE=mock`.
 *  - `DATA_SOURCE=mock` : store `Utilisateur` en mémoire (pas de Postgres).
 */

/** Fenêtre : 5 inscriptions par IP toutes les 10 minutes. */
const REGISTER_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;

const globalForRegister = globalThis as unknown as {
  registerPasswordHasher?: PasswordHasher;
};

function getRateLimiter() {
  return getFixedWindowRateLimiter("register", REGISTER_RATE_LIMIT);
}

function getPasswordHasher(): PasswordHasher {
  if (!globalForRegister.registerPasswordHasher) {
    globalForRegister.registerPasswordHasher = createScryptPasswordHasher();
  }
  return globalForRegister.registerPasswordHasher;
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const decision = await getRateLimiter().check(clientIp(request));
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

  const { email, password, accepteCgu, nom, prenom, age } = (body ?? {}) as Record<string, unknown>;
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
      // Mise à jour ST 4.1 — champs profil nom/prénom/âge. Coercition
      // défensive (pas de garde 400 générique ici, contrairement à
      // email/password) : une valeur absente/mal typée devient une chaîne
      // vide / NaN, et `registerUtilisateur` (→ `collectRegistrationErrors`)
      // produit alors un message d'erreur par champ plutôt qu'un 400 générique.
      nom: typeof nom === "string" ? nom : "",
      prenom: typeof prenom === "string" ? prenom : "",
      age: typeof age === "number" ? age : Number(age),
      // ST 4.3 — acceptation des CGU (case obligatoire du formulaire). Validée
      // par `registerUtilisateur` : `accepteCgu !== true` → 400 `fieldErrors.cgu`.
      accepteCgu: accepteCgu === true,
    });

    const { token } = await issueSession(utilisateur.id);
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
