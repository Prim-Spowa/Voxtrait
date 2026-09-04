import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exigerModerateur,
  NonAuthentifieError,
} from "@/lib/moderationAuth";
import { RoleInsuffisantError } from "@/lib/authz";
import {
  CompteModereIntrouvableError,
  ContenuModereIntrouvableError,
  listerFileModeration,
  rejeterSignalement,
  retirerContenuSignale,
  SignalementDejaTraiteError,
  SignalementIntrouvableError,
  suspendreCompte,
  toDecisionModerationView,
  type ResultatAction,
} from "@/lib/moderation";
import {
  ActionModerationError,
  FileModerationQueryError,
  parseActionModerationPayload,
  parseFileModerationQuery,
} from "@/lib/moderationClient";
import {
  getContenuModerationGateway,
  getModerationStores,
} from "@/lib/mocks/moderation.mock";

/**
 * `GET  /api/admin/moderation` — file de modération (ST 7.2, tâche 2).
 * `POST /api/admin/moderation` — action de modération (ST 7.2, tâche 3).
 *
 * **Réservé aux modérateurs** (`exigerModerateur` : session vérifiée + rôle
 * `MODERATEUR`/`ADMIN` + compte non suspendu). `401` sans session valide,
 * `403` avec un rôle insuffisant.
 *
 * GET — query : `statut` (défaut `EN_ATTENTE`), `tri` (`ANCIENNETE` défaut /
 * `RECENCE`), `page`, `pageSize` (défaut 20, max 100). `200 { items,
 * pagination }` ; `400` sur query invalide.
 *
 * POST — corps JSON `{ action, signalementId?, compteCibleId?, commentaire? }` :
 *  - `REJETER` (signalementId) → signalement `REJETE` ;
 *  - `RETIRER_CONTENU` (signalementId) → contenu `RETRAIT_MODERATION`,
 *    signalement `RETENU` ;
 *  - `SUSPENDRE_COMPTE` (compteCibleId, signalementId?) → compte `SUSPENDU`.
 * Chaque action journalise une `DecisionModeration`. `200 { decision,
 * signalement }` ; `400` (corps invalide), `404` (signalement / contenu /
 * compte introuvable), `409` (signalement déjà traité).
 */

const noStore = { "Cache-Control": "no-store" } as const;

/** Traduit les erreurs de garde d'accès en réponse HTTP, ou `null` si OK. */
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
    query = parseFileModerationQuery(request.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof FileModerationQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    throw err;
  }

  const { signalements } = getModerationStores();
  const file = await listerFileModeration(signalements, query);
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
    payload = parseActionModerationPayload(body);
  } catch (err) {
    if (err instanceof ActionModerationError) {
      return NextResponse.json(
        { error: err.message, field: err.field },
        { status: 400, headers: noStore }
      );
    }
    throw err;
  }

  const stores = getModerationStores();
  const gateway = getContenuModerationGateway();
  const contexte = {
    moderateurId: moderateur.utilisateurId,
    commentaire: payload.commentaire ?? null,
  };

  try {
    let resultat: ResultatAction;
    switch (payload.action) {
      case "REJETER":
        resultat = await rejeterSignalement(stores, {
          signalementId: payload.signalementId!,
          ...contexte,
        });
        break;
      case "RETIRER_CONTENU":
        resultat = await retirerContenuSignale(stores, gateway, {
          signalementId: payload.signalementId!,
          ...contexte,
        });
        break;
      case "SUSPENDRE_COMPTE":
        resultat = await suspendreCompte(stores, gateway, {
          compteCibleId: payload.compteCibleId!,
          signalementId: payload.signalementId ?? null,
          ...contexte,
        });
        break;
    }

    return NextResponse.json(
      {
        decision: toDecisionModerationView(resultat.decision),
        signalement: resultat.signalement,
      },
      { status: 200, headers: noStore }
    );
  } catch (err) {
    if (
      err instanceof SignalementIntrouvableError ||
      err instanceof ContenuModereIntrouvableError ||
      err instanceof CompteModereIntrouvableError
    ) {
      return NextResponse.json({ error: err.message }, { status: 404, headers: noStore });
    }
    if (err instanceof SignalementDejaTraiteError) {
      return NextResponse.json(
        { error: err.message, statut: err.statut },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { error: "L'action de modération a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
