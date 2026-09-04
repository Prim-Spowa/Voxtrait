import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDataSource } from "@/lib/config";
import { mockExtraitDelegate } from "@/lib/mocks/extraits.mock";
import { findExtraitById } from "@/lib/extraits";
import { readSessionFromCookieStore } from "@/lib/session";
import { ajouterFavori, retirerFavori, toFavoriView } from "@/lib/favori";
import { getFavoriStore } from "@/lib/mocks/favori.mock";

/**
 * POST /api/extraits/:id/favori — ST 8.1 « Marquer une scène en favori »,
 * découpage en tâches point 2 : « Endpoint `POST /api/extraits/:id/favori`
 * (ajout) […], réservés aux comptes connectés ».
 *
 * Ajoute l'extrait `:id` aux favoris du compte connecté.
 *
 * Réponses :
 *  - `201` `{ favori }` : favori créé ;
 *  - `200` `{ favori }` : favori déjà existant (idempotence, même convention
 *    que `POST /api/doublages/:id/sauvegarder`, ST 6.1) ;
 *  - `400` : identifiant d'extrait manquant ;
 *  - `401` : pas de session valide ;
 *  - `404` : extrait introuvable.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const noStore = { "Cache-Control": "no-store" };

  const extraitId = params.id?.trim();
  if (!extraitId) {
    return NextResponse.json(
      { error: "Identifiant d'extrait manquant." },
      { status: 400, headers: noStore }
    );
  }

  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour ajouter un favori." },
      { status: 401, headers: noStore }
    );
  }

  const extraitDelegate =
    getDataSource() === "mock" ? mockExtraitDelegate : prisma.extrait;
  const extrait = await findExtraitById(extraitDelegate, extraitId);
  if (!extrait) {
    return NextResponse.json(
      { error: "Extrait introuvable." },
      { status: 404, headers: noStore }
    );
  }

  const store = getFavoriStore();
  const existait = await store.find(session.sub, extraitId);
  const favori = await ajouterFavori(store, {
    utilisateurId: session.sub,
    extraitId,
  });

  return NextResponse.json(
    { favori: toFavoriView(favori) },
    { status: existait ? 200 : 201, headers: noStore }
  );
}

/**
 * DELETE /api/extraits/:id/favori — ST 8.1, découpage en tâches point 2 :
 * « […] et `DELETE /api/extraits/:id/favori` (retrait), réservés aux comptes
 * connectés ».
 *
 * Retire l'extrait `:id` des favoris du compte connecté. **Idempotent** : ne
 * lève jamais d'erreur si le favori n'existait déjà pas — l'extrait n'est pas
 * revérifié (on doit pouvoir retirer un favori même si son extrait a depuis
 * été retiré, cf. `src/lib/favori.ts`).
 *
 * Réponses :
 *  - `200` `{ removed }` : `removed` indique si une ligne a effectivement été
 *    supprimée ;
 *  - `400` : identifiant d'extrait manquant ;
 *  - `401` : pas de session valide.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const noStore = { "Cache-Control": "no-store" };

  const extraitId = params.id?.trim();
  if (!extraitId) {
    return NextResponse.json(
      { error: "Identifiant d'extrait manquant." },
      { status: 400, headers: noStore }
    );
  }

  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour retirer un favori." },
      { status: 401, headers: noStore }
    );
  }

  const removed = await retirerFavori(getFavoriStore(), {
    utilisateurId: session.sub,
    extraitId,
  });

  return NextResponse.json({ removed }, { status: 200, headers: noStore });
}
