import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exigerModerateur, NonAuthentifieError } from "@/lib/moderationAuth";
import { RoleInsuffisantError } from "@/lib/authz";
import { genererRapportDelais } from "@/lib/demandeRetrait";
import { getDemandeRetraitStore } from "@/lib/mocks/demandeRetrait.mock";

/**
 * `GET /api/admin/demandes-retrait/rapport` — rapport des délais de traitement
 * des demandes de retrait (ST 7.3, tâche 3 : suivi / justification des délais).
 *
 * **Réservé aux modérateurs** (même garde que `/api/admin/demandes-retrait`).
 * `200 { total, enAttente, traitees, rejetees, delaiMoyenHeures,
 * delaiMedianHeures, delaiMaxHeures, closesDansDelaiCible, closesHorsDelaiCible,
 * enAttenteHorsDelaiCible, delaiCibleHeures }` ; `401` / `403`.
 */

const noStore = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    await exigerModerateur(cookies());
  } catch (err) {
    if (err instanceof NonAuthentifieError) {
      return NextResponse.json({ error: err.message }, { status: 401, headers: noStore });
    }
    if (err instanceof RoleInsuffisantError) {
      return NextResponse.json({ error: err.message }, { status: 403, headers: noStore });
    }
    throw err;
  }

  const rapport = await genererRapportDelais(getDemandeRetraitStore());
  return NextResponse.json(rapport, { status: 200, headers: noStore });
}
