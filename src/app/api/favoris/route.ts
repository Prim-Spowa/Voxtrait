import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDataSource } from "@/lib/config";
import { mockExtraitDelegate } from "@/lib/mocks/extraits.mock";
import { findExtraitById } from "@/lib/extraits";
import { readActiveSessionFromCookieStore } from "@/lib/session";
import { chargerFavoris, type ResolveExtraitResumeFavori } from "@/lib/favori";
import { getFavoriStore } from "@/lib/mocks/favori.mock";
import { FavorisQueryError, parseFavorisQuery } from "@/lib/favoriClient";

/**
 * GET /api/favoris — ST 8.1 « Marquer une scène en favori », découpage en
 * tâches point 3 : « Endpoint `GET /api/favoris` paginé (favoris du compte
 * connecté), réutilisant la structure de listing de ST 1.1 ».
 *
 * Renvoie la page demandée des favoris du compte connecté, les plus récents
 * d'abord, chaque entrée enrichie des métadonnées de l'extrait favorisé
 * (titre, vignette — ST 1.1). Contrairement à `GET /api/doublages` (ST 6.2),
 * aucun paramètre `utilisateur=me` n'est nécessaire : ce endpoint n'expose que
 * les favoris du compte de la session, il n'existe pas de variante « favoris
 * d'un tiers » (cf. `lib/favoriClient.ts`).
 *
 * Query params (cf. `parseFavorisQuery`) : `page` (défaut 1), `pageSize`
 * (défaut 20, plafond 50).
 *
 * Réponses :
 *  - `200` `{ items, pagination }` (`FavorisResponse`) ;
 *  - `400` : query params invalides ;
 *  - `401` : pas de session valide.
 *
 * `Cache-Control: no-store` : contenu strictement personnel, jamais mis en cache.
 *
 * ⚠️ Périmètre : en mode `mock`, le store des favoris est en mémoire (perdu au
 * redémarrage) ; en mode `api`, il passe par `prisma.favori` (client à
 * régénérer, cf. README).
 */
export async function GET(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const session = await readActiveSessionFromCookieStore(cookies());
  if (!session) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour consulter vos favoris." },
      { status: 401, headers: noStore }
    );
  }

  let query;
  try {
    query = parseFavorisQuery(new URL(request.url).searchParams);
  } catch (err) {
    if (err instanceof FavorisQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    throw err;
  }

  const extraitDelegate =
    getDataSource() === "mock" ? mockExtraitDelegate : prisma.extrait;
  const resolveExtrait: ResolveExtraitResumeFavori = async (extraitId) => {
    const extrait = await findExtraitById(extraitDelegate, extraitId);
    if (!extrait) return null;
    return {
      titre: extrait.titre,
      thumbnail: extrait.thumbnail ?? null,
      origine: extrait.origine,
      type: extrait.type,
      source: extrait.source,
      statut: extrait.statut,
    };
  };

  const favoris = await chargerFavoris(getFavoriStore(), {
    utilisateurId: session.sub,
    page: query.page,
    pageSize: query.pageSize,
    resolveExtrait,
  });

  return NextResponse.json(favoris, { headers: noStore });
}
