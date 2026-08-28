import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildClearedSessionCookie } from "@/lib/session";

/**
 * POST /api/auth/logout — ST 4.2 « Connexion / déconnexion », découpage en
 * tâches point 2 : « Endpoint logout + invalidation côté serveur (si session
 * stockée) ou expiration JWT ».
 *
 * Le jeton de session est **sans état** (pas de table de sessions, cf.
 * `lib/session.ts`) : la déconnexion consiste à poser un cookie vide qui
 * expire immédiatement (`buildClearedSessionCookie` : `maxAge: 0`). Le
 * navigateur supprime alors le cookie ; les requêtes suivantes sont
 * anonymes.
 *
 * Limite assumée : un jeton qui aurait été exfiltré resterait
 * cryptographiquement valide jusqu'à sa date d'expiration (30 j). Une vraie
 * invalidation serveur demanderait une liste de révocation (jti + store
 * partagé) — signalé en notes de dev ST 4.2 pour arbitrage.
 *
 * `POST` (et non `GET`) : action à effet de bord, non déclenchable par un
 * simple `<img>`/préchargement. Idempotent : se déconnecter sans session
 * renvoie quand même `200`.
 */
export async function POST() {
  const cookie = buildClearedSessionCookie();
  cookies().set(cookie.name, cookie.value, cookie.options);

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
