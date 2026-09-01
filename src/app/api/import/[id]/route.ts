import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionFromCookieStore } from "@/lib/session";
import { toImportJobView } from "@/lib/import";
import { getImportJobStore } from "@/lib/mocks/import.mock";

/**
 * GET /api/import/:id — ST 5.1, découpage en tâches point 3-4 (suivi
 * asynchrone) : notification de fin de compression par polling.
 *
 * Le frontend interroge cette route jusqu'à un statut terminal (`pret` →
 * `extraitId` présent, ou `echec`). Voir `computeNextImportPollDelayMs` et
 * `isTerminalImportStatus` dans `src/lib/importClient.ts`.
 *
 * Réservé au propriétaire du job (l'importateur) : un job d'import concerne un
 * contenu encore non modéré, il ne doit pas être observable par un tiers. On
 * renvoie `404` (et non `403`) quand le demandeur n'est pas le propriétaire,
 * pour ne pas révéler l'existence du job.
 *
 * `Cache-Control: no-store` : l'état change à chaque étape du traitement.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const noStore = { "Cache-Control": "no-store" };

  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json(
      { error: "Identifiant de job manquant." },
      { status: 400, headers: noStore }
    );
  }

  const payload = readSessionFromCookieStore(cookies());
  if (!payload) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour suivre un import." },
      { status: 401, headers: noStore }
    );
  }

  const job = await getImportJobStore().get(id);
  if (!job || job.input.utilisateurId !== payload.sub) {
    return NextResponse.json(
      { error: "Job d'import introuvable ou expiré." },
      { status: 404, headers: noStore }
    );
  }

  return NextResponse.json({ job: toImportJobView(job) }, { headers: noStore });
}
