import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findVisibleExtraitById } from "@/lib/extraits";

/**
 * GET /api/extraits/:id — ST 10.3 « Page publique unifiée d'un extrait »,
 * découpage en tâches point 1.
 *
 * Détail d'un extrait, consommé par la page publique `/extraits/:id`
 * (`ExtraitPageClient`) pour assembler `VideoPlayer` (ST 1.2), `VoiceRecorder`
 * (ST 2.1/2.2) et `DoublageExport` (ST 3.1) autour de la vidéo. Même
 * restriction de visibilité que `GET /api/extraits` (ST 1.1) : un extrait
 * introuvable ou dont le statut n'est pas `VALIDE` (en attente de
 * modération, rejeté, retiré) répond `404` sans distinguer les deux cas —
 * endpoint public, pas d'admin, cf. `findVisibleExtraitById`.
 *
 * Source de données : Prisma/Postgres, comme `GET /api/extraits` et
 * `GET /api/extraits/:id/script` (ST 9.1 « Bascule intégrale sur
 * PostgreSQL » — pas de bascule `DATA_SOURCE=mock` sur cet endpoint).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const extraitId = params.id?.trim();
  if (!extraitId) {
    return NextResponse.json({ error: "Identifiant d'extrait manquant." }, { status: 400 });
  }

  const extrait = await findVisibleExtraitById(prisma.extrait, extraitId);
  if (!extrait) {
    return NextResponse.json({ error: "Extrait introuvable." }, { status: 404 });
  }

  return NextResponse.json(extrait, {
    headers: {
      // Même politique de cache que `GET /api/extraits` (ST 1.1) : extrait
      // public déjà validé, peu volatile.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
