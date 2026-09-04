import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exigerModerateur, NonAuthentifieError } from "@/lib/moderationAuth";
import { RoleInsuffisantError } from "@/lib/authz";
import {
  appliquerActionDemandeRetrait,
  ContenuDemandeIntrouvableError,
  DemandeRetraitDejaTraiteeError,
  DemandeRetraitIntrouvableError,
  listerDemandesRetrait,
} from "@/lib/demandeRetrait";
import {
  ActionDemandeRetraitError,
  FileDemandesRetraitQueryError,
  parseActionDemandeRetraitPayload,
  parseFileDemandesRetraitQuery,
} from "@/lib/demandeRetraitClient";
import { getDemandeRetraitStore } from "@/lib/mocks/demandeRetrait.mock";
import {
  getContenuModerationGateway,
  getModerationStores,
} from "@/lib/mocks/moderation.mock";

/**
 * `GET  /api/admin/demandes-retrait` — file des demandes de retrait (ST 7.3).
 * `POST /api/admin/demandes-retrait` — action `TRAITER` / `REJETER`.
 *
 * **Réservé aux modérateurs** (`exigerModerateur`, même garde que
 * `/api/admin/moderation`). `401` sans session valide, `403` avec un rôle
 * insuffisant.
 *
 * GET — query : `statut` (défaut `EN_ATTENTE`), `tri` (`ANCIENNETE` / `RECENCE`),
 * `page`, `pageSize` (défaut 20, max 100). `200 { items, pagination }` ; `400`.
 *
 * POST — corps JSON `{ action, demandeId, commentaire? }` :
 *  - `TRAITER` → contenu visé `RETRAIT_AYANT_DROIT`, demande `TRAITEE`, décision
 *    `RETRAIT_AYANT_DROIT` journalisée ;
 *  - `REJETER` → demande `REJETEE`, aucun impact contenu.
 * `200 { demande, decisionId }` ; `400` (corps invalide), `404` (demande /
 * contenu introuvable), `409` (demande déjà traitée).
 */

const noStore = { "Cache-Control": "no-store" } as const;

function reponseAcces(err: unknown): NextResponse | null {
  if (err instanceof NonAuthentifieError) {
    return NextResponse.json({ error: err.message }, { status: 401, headers: noStore });
  }
  if (err instanceof RoleInsuffisantError) {
    return NextResponse.json({ error: err.message }, { status: 403, headers: noStore });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    await exigerModerateur(cookies());
  } catch (err) {
    const reponse = reponseAcces(err);
    if (reponse) return reponse;
    throw err;
  }

  let query;
  try {
    query = parseFileDemandesRetraitQuery(request.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof FileDemandesRetraitQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    throw err;
  }

  const file = await listerDemandesRetrait(getDemandeRetraitStore(), query);
  return NextResponse.json(file, { status: 200, headers: noStore });
}

export async function POST(request: NextRequest) {
  let moderateur;
  try {
    moderateur = await exigerModerateur(cookies());
  } catch (err) {
    const reponse = reponseAcces(err);
    if (reponse) return reponse;
    throw err;
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
    payload = parseActionDemandeRetraitPayload(body);
  } catch (err) {
    if (err instanceof ActionDemandeRetraitError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400, headers: noStore }
      );
    }
    throw err;
  }

  const stores = {
    demandes: getDemandeRetraitStore(),
    decisions: getModerationStores().decisions,
  };
  const gateway = getContenuModerationGateway();

  try {
    const resultat = await appliquerActionDemandeRetrait(stores, gateway, {
      action: payload.action,
      demandeId: payload.demandeId,
      moderateurId: moderateur.utilisateurId,
      commentaire: payload.commentaire ?? null,
    });
    return NextResponse.json(
      { demande: resultat.demande, decisionId: resultat.decision?.id ?? null },
      { status: 200, headers: noStore }
    );
  } catch (err) {
    if (
      err instanceof DemandeRetraitIntrouvableError ||
      err instanceof ContenuDemandeIntrouvableError
    ) {
      return NextResponse.json({ error: err.message }, { status: 404, headers: noStore });
    }
    if (err instanceof DemandeRetraitDejaTraiteeError) {
      return NextResponse.json(
        { error: err.message, statut: err.statut },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { error: "L'action a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
