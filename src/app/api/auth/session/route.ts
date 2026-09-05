import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import { toUtilisateurPublic, type UtilisateurDelegate } from "@/lib/auth";
import { readActiveSessionFromCookieStore } from "@/lib/session";

/**
 * GET /api/auth/session — ST 4.2 « Connexion / déconnexion ».
 *
 * Renvoie l'utilisateur connecté (`{ utilisateur }`) ou `{ utilisateur: null }`
 * si la session est absente / invalide / expirée. Toujours `200` : c'est une
 * lecture d'état, pas une ressource protégée.
 *
 * Sert à la navigation (`TopBar` : afficher « Se connecter » ou le bouton de
 * déconnexion) et de brique réutilisable pour les futures pages `/mon-espace`
 * (ST 6.x), qui devront de toute façon revérifier la session côté serveur
 * (le middleware ne contrôle que la présence du cookie — cf. `src/middleware.ts`).
 *
 * La vérification cryptographique du jeton, **et** de sa non-révocation
 * (ST 9.4), est faite par `readActiveSessionFromCookieStore` (`node:crypto` +
 * `lib/sessionStore.ts`) : cette route s'exécute sur le runtime Node, pas
 * Edge.
 */
export async function GET() {
  const noStore = { "Cache-Control": "no-store" };
  const payload = await readActiveSessionFromCookieStore(cookies());

  if (!payload) {
    return NextResponse.json({ utilisateur: null }, { status: 200, headers: noStore });
  }

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : prisma.utilisateur;

  // Le compte a pu être supprimé / suspendu depuis l'émission du jeton :
  // on relit la source de vérité plutôt que de faire confiance au seul jeton.
  const user = await delegate.findFirst({ where: { id: payload.sub } });
  if (!user || user.statut === "SUSPENDU") {
    return NextResponse.json({ utilisateur: null }, { status: 200, headers: noStore });
  }

  return NextResponse.json(
    { utilisateur: toUtilisateurPublic(user) },
    { status: 200, headers: noStore }
  );
}
