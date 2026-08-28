import { NextRequest, NextResponse } from "next/server";
import { toDoublageJobView } from "@/lib/doublage";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";

/**
 * GET /api/doublages/:id — ST 3.1, découpage en tâches point 4 :
 * « Notification frontend de fin de traitement (polling ou websocket) ».
 *
 * Le frontend (`DoublageExport`) interroge cette route jusqu'à obtenir un
 * statut terminal (`pret` → l'URL de téléchargement est présente, ou `echec`).
 * Voir `computeNextPollDelayMs` (back-off) et `isTerminalDoublageStatus` dans
 * `src/lib/doublageClient.ts`.
 *
 * `Cache-Control: no-store` : l'état d'un job change à chaque étape du
 * traitement, aucune mise en cache ne doit intervenir entre deux polls.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Identifiant de job manquant." }, { status: 400 });
  }

  const job = await getDoublageJobStore().get(id);
  if (!job) {
    return NextResponse.json(
      { error: "Job de doublage introuvable ou expiré." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { job: toDoublageJobView(job) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
