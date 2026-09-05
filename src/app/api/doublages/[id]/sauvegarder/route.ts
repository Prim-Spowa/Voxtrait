import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readActiveSessionFromCookieStore } from "@/lib/session";
import {
  DoublageJobPasPretError,
  sauvegarderDoublage,
  toDoublageSauvegardeView,
} from "@/lib/doublageSauvegarde";
import { getDoublageSauvegardeStore } from "@/lib/mocks/doublageSauvegarde.mock";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";

/**
 * POST /api/doublages/:id/sauvegarder — ST 6.1 « Sauvegarde privée d'un
 * doublage », découpage en tâches point 2 : « Endpoint de sauvegarde liant le
 * fichier généré au compte ».
 *
 * Lie le doublage généré `:id` (job ST 3.1 au statut `pret`) au compte de
 * l'utilisateur connecté, en **visibilité privée par défaut** (ST 6.1). Le
 * fichier n'est **pas** re-généré : on recopie l'URL de sortie du job.
 *
 * Idempotent : ré-appelé pour le même doublage et le même compte, renvoie la
 * sauvegarde existante (`200`) sans créer de doublon.
 *
 * Réponses :
 *  - `201` `{ sauvegarde }` : sauvegarde créée ;
 *  - `200` `{ sauvegarde }` : sauvegarde déjà existante (idempotence) ;
 *  - `400` : identifiant manquant ;
 *  - `401` : pas de session valide ;
 *  - `404` : job de doublage introuvable ou expiré (TTL 15 min, ST 3.1) ;
 *  - `409` : le doublage n'est pas encore prêt (`en_traitement` / `echec`).
 *
 * ⚠️ Périmètre : le store de jobs (ST 3.1) est en mémoire — un doublage n'est
 * donc sauvegardable que tant que son job vit (avant purge). En mode `mock`,
 * le store des sauvegardes est lui aussi en mémoire ; en mode `api`, il passe
 * par `prisma.doublage` (client à régénérer, cf. README).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const noStore = { "Cache-Control": "no-store" };

  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json(
      { error: "Identifiant de doublage manquant." },
      { status: 400, headers: noStore }
    );
  }

  const payload = await readActiveSessionFromCookieStore(cookies());
  if (!payload) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour sauvegarder un doublage." },
      { status: 401, headers: noStore }
    );
  }

  const job = await getDoublageJobStore().get(id);
  if (!job) {
    return NextResponse.json(
      { error: "Doublage introuvable ou expiré." },
      { status: 404, headers: noStore }
    );
  }

  try {
    const store = getDoublageSauvegardeStore();
    const existait = await store.findByJob(payload.sub, job.id);
    const sauvegarde = await sauvegarderDoublage(store, {
      job,
      utilisateurId: payload.sub,
    });

    return NextResponse.json(
      { sauvegarde: toDoublageSauvegardeView(sauvegarde) },
      { status: existait ? 200 : 201, headers: noStore }
    );
  } catch (err) {
    if (err instanceof DoublageJobPasPretError) {
      return NextResponse.json(
        { error: "Le doublage n'est pas encore prêt à être sauvegardé." },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { error: "La sauvegarde du doublage a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
