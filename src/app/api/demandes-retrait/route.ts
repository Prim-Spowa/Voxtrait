import { NextRequest, NextResponse } from "next/server";
import { creerDemandeRetrait, toDemandeRetraitRecuView } from "@/lib/demandeRetrait";
import {
  parseDemandeRetraitPayload,
  DemandeRetraitPayloadError,
} from "@/lib/demandeRetraitClient";
import { getDemandeRetraitStore } from "@/lib/mocks/demandeRetrait.mock";
import { getFixedWindowRateLimiter } from "@/lib/rateLimiterFactory";
import { clientIp } from "@/lib/requestIp";

/**
 * POST /api/demandes-retrait — ST 7.3 « Procédure notice-and-takedown »,
 * découpage en tâches point 2 : point de contact « demande de retrait ».
 *
 * Corps attendu (`application/json`) :
 * `{ contenuType, contenuId, oeuvre, demandeurNom, demandeurEmail,
 *    demandeurOrganisation?, motif, declarationBonneFoi: true }`.
 *
 * **Ouvert sans compte** (un ayant droit n'est pas un utilisateur de la
 * plateforme). Rate limiting par IP comme garde-fou anti-abus (même posture que
 * `POST /api/signalements`, ST 7.1), plus permissif : une réclamation légitime
 * est rare et coûteuse à rédiger.
 *
 * Réponses :
 *  - `201 { demande }` : demande enregistrée (statut `EN_ATTENTE`) ;
 *  - `400 { error, field? }` : corps illisible ou invalide (dont déclaration de
 *    bonne foi manquante) ;
 *  - `429 { error }` + `Retry-After` : trop de demandes depuis la même IP ;
 *  - `500` : échec inattendu à l'écriture.
 *
 * ⚠️ Périmètre : rate limiting persisté dans Redis (`getFixedWindowRateLimiter`,
 * ST 9.4), en mémoire par process seulement en mode `DATA_SOURCE=mock` (qui
 * régit aussi le store des demandes). Aucune notification n'est envoyée au
 * demandeur (l'accusé de réception est la réponse HTTP) ni à l'équipe — le
 * branchement email est un point d'extension (cf. dev-notes).
 */

/** Fenêtre : 5 demandes par IP par heure. */
const DEMANDE_RETRAIT_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

function getRateLimiter() {
  return getFixedWindowRateLimiter("demande-retrait", DEMANDE_RETRAIT_RATE_LIMIT);
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const decision = await getRateLimiter().check(clientIp(request));
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error:
          "Trop de demandes envoyées. Réessayez plus tard ou contactez l'équipe par un autre canal.",
      },
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
    payload = parseDemandeRetraitPayload(body);
  } catch (err) {
    if (err instanceof DemandeRetraitPayloadError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400, headers: noStore }
      );
    }
    throw err;
  }

  try {
    const demande = await creerDemandeRetrait(getDemandeRetraitStore(), payload);
    return NextResponse.json(
      { demande: toDemandeRetraitRecuView(demande) },
      { status: 201, headers: noStore }
    );
  } catch {
    return NextResponse.json(
      { error: "L'envoi de la demande a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
