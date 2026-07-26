import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDataSource } from "@/lib/config";
import { mockExtraitDelegate } from "@/lib/mocks/extraits.mock";
import {
  InvalidQueryParamError,
  listExtraits,
  parseExtraitsQueryParams,
} from "@/lib/extraits";

/**
 * GET /api/extraits — ST 1.1 "Endpoint et page de listing de la bibliothèque".
 *
 * Query params: origine (FR|US|JP), type (FILM|SERIE|DESSIN_ANIME), q (recherche
 * texte sur le titre), page (défaut 1), pageSize (défaut 20, max 50).
 *
 * Toujours restreint aux extraits au statut VALIDE (endpoint public, non admin).
 *
 * Source de données : Prisma/Postgres par défaut, ou jeu de données mocké en
 * mémoire si `DATA_SOURCE=mock` (cf. `src/lib/config.ts` et
 * `src/lib/mocks/extraits.mock.ts`) — utile pour développer/tester ST 1.1 (et
 * ST 1.2, cf. `/dev/lecteur`) sans base Postgres ni contenu réel importé. Les
 * deux delegates respectent le même contrat (`ExtraitDelegate`), donc
 * `listExtraits` ci-dessous est inchangé quelle que soit la source.
 */
export async function GET(request: NextRequest) {
  let params;
  try {
    params = parseExtraitsQueryParams(request.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof InvalidQueryParamError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const extraitDelegate = getDataSource() === "mock" ? mockExtraitDelegate : prisma.extrait;
  const page = await listExtraits(extraitDelegate, params);

  return NextResponse.json(page, {
    headers: {
      // Bibliothèque publique lue fréquemment, peu volatile : cache court
      // côté CDN/edge acceptable, revalidation côté navigateur désactivée.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
