import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import {
  acceptCguPourUtilisateur,
  UtilisateurIntrouvableError,
  type UtilisateurDelegate,
} from "@/lib/auth";
import { readActiveSessionFromCookieStore } from "@/lib/session";
import { CGU_VERSION } from "@/lib/cgu";

/**
 * POST /api/auth/cgu — ST 4.3 « Acceptation des CGU (fan-usage) », découpage
 * en tâches point 3 : « Endpoint de mise à jour de l'acceptation (utile si
 * les CGU évoluent) ».
 *
 * Enregistre, pour l'utilisateur connecté, l'acceptation de la version
 * courante des CGU (`CGU_VERSION`). Sert :
 *  - à l'inscription, l'acceptation est déjà posée par `POST /api/auth/register`
 *    (case obligatoire) — cet endpoint couvre le cas « CGU mises à jour » :
 *    un compte existant ré-accepte avant de pouvoir importer (ST 5.1) ;
 *  - de cible à une modale d'acceptation affichée quand `aAccepteCguActuelles`
 *    est faux.
 *
 * Corps : ignoré (l'acceptation porte toujours sur `CGU_VERSION` côté serveur —
 * on ne fait pas confiance à une version fournie par le client).
 *
 * Réponses :
 *  - `200` `{ utilisateur, version }` : acceptation enregistrée ;
 *  - `401` `{ error }` : pas de session valide, ou compte introuvable.
 *
 * Vérification cryptographique et de non-révocation du jeton via
 * `readActiveSessionFromCookieStore` (`node:crypto` + `lib/sessionStore.ts`,
 * ST 9.4) — runtime Node, pas Edge (cf. `GET /api/auth/session`).
 */
export async function POST() {
  const noStore = { "Cache-Control": "no-store" };

  const payload = await readActiveSessionFromCookieStore(cookies());
  if (!payload) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour accepter les CGU." },
      { status: 401, headers: noStore }
    );
  }

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : prisma.utilisateur;

  try {
    const utilisateur = await acceptCguPourUtilisateur(delegate, payload.sub);
    return NextResponse.json(
      { utilisateur, version: CGU_VERSION },
      { status: 200, headers: noStore }
    );
  } catch (err) {
    if (err instanceof UtilisateurIntrouvableError) {
      return NextResponse.json({ error: err.message }, { status: 401, headers: noStore });
    }
    // Détail technique non propagé au client (cf. `POST /api/auth/register`).
    return NextResponse.json(
      { error: "L'enregistrement de l'acceptation a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
