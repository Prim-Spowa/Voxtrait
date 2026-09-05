import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readActiveSessionFromCookieStore } from "@/lib/session";
import { creerSignalement, toSignalementView } from "@/lib/signalement";
import {
  parseSignalementPayload,
  SignalementPayloadError,
} from "@/lib/signalementClient";
import { getSignalementStore } from "@/lib/mocks/signalement.mock";
import { getFixedWindowRateLimiter } from "@/lib/rateLimiterFactory";
import { clientIp } from "@/lib/requestIp";

/**
 * POST /api/signalements — ST 7.1 « Signalement de contenu », découpage en
 * tâches point 2 : « Endpoint de création de signalement avec motif
 * obligatoire ».
 *
 * Corps attendu (`application/json`) :
 * `{ "contenuType": "EXTRAIT" | "DOUBLAGE", "contenuId": string, "motif": string }`.
 *
 * **Ouvert aux visiteurs non connectés** (cf. cahier des charges §3-4) : aucune
 * session requise. Si une session valide est présente, le compte est enregistré
 * comme auteur du signalement (`auteurId`).
 *
 * Réponses :
 *  - `201` `{ signalement }` : signalement enregistré (statut `EN_ATTENTE`) ;
 *  - `400` `{ error, field? }` : corps illisible, type de contenu invalide, ou
 *    motif manquant / trop long ;
 *  - `429` `{ error }` + en-tête `Retry-After` : trop de signalements depuis la
 *    même IP (anti-spam, ST 7.1 points d'attention) ;
 *  - `500` : échec inattendu à l'écriture.
 *
 * ⚠️ Périmètre, cf. têtes de `src/lib/signalement.ts` et `src/lib/rateLimit.ts` :
 *  - rate limiting persisté dans Redis (`getFixedWindowRateLimiter`, ST 9.4),
 *    en mémoire par process seulement en mode `DATA_SOURCE=mock` ;
 *  - captcha non implémenté (ST 7.1 : « éventuellement captcha si abus
 *    constaté ») — point d'extension documenté.
 *  - `DATA_SOURCE=mock` : store `Signalement` en mémoire (pas de Postgres).
 */

/** Fenêtre : 10 signalements par IP toutes les 10 minutes. */
const SIGNALEMENT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

function getRateLimiter() {
  return getFixedWindowRateLimiter("signalement", SIGNALEMENT_RATE_LIMIT);
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const decision = await getRateLimiter().check(clientIp(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Trop de signalements envoyés. Réessayez dans quelques minutes." },
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

  let payload;
  try {
    payload = parseSignalementPayload(body);
  } catch (err) {
    if (err instanceof SignalementPayloadError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400, headers: noStore }
      );
    }
    throw err;
  }

  // Session facultative : renseigne l'auteur si le visiteur est connecté.
  const session = await readActiveSessionFromCookieStore(cookies());

  try {
    const signalement = await creerSignalement(getSignalementStore(), payload, {
      auteurId: session?.sub ?? null,
    });
    return NextResponse.json(
      { signalement: toSignalementView(signalement) },
      { status: 201, headers: noStore }
    );
  } catch {
    // Détail technique non propagé au client (cf. `registerUtilisateur`, ST 4.1).
    return NextResponse.json(
      { error: "L'envoi du signalement a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
