import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildClearedSessionCookie, revokeSession, SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * POST /api/auth/logout — ST 4.2 « Connexion / déconnexion », découpage en
 * tâches point 2 : « Endpoint logout + invalidation côté serveur (si session
 * stockée) ou expiration JWT ».
 *
 * Deux effets, dans cet ordre :
 *  1. **Révocation côté serveur** (`revokeSession`, ST 9.4) : la session est
 *     retirée du store partagé (`lib/sessionStore.ts`) — toute requête
 *     ultérieure présentant ce jeton (même copié ailleurs) sera désormais
 *     rejetée par `readActiveSessionFromCookieStore`, sur n'importe quel
 *     process. Résout la limite documentée depuis ST 4.2 (« un jeton qui
 *     aurait été exfiltré resterait cryptographiquement valide jusqu'à son
 *     expiration ») — c'était l'arbitrage laissé en suspens, tranché par
 *     ST 9.4.
 *  2. Pose d'un cookie vide qui expire immédiatement
 *     (`buildClearedSessionCookie` : `maxAge: 0`), pour que le navigateur du
 *     compte qui se déconnecte cesse d'envoyer le jeton.
 *
 * `POST` (et non `GET`) : action à effet de bord, non déclenchable par un
 * simple `<img>`/préchargement. Idempotent : se déconnecter sans session (ou
 * avec un jeton déjà invalide) renvoie quand même `200`
 * (`revokeSession`/`buildClearedSessionCookie` sont silencieux dans ce cas).
 */
export async function POST() {
  const cookieStore = cookies();
  await revokeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  const cookie = buildClearedSessionCookie();
  cookieStore.set(cookie.name, cookie.value, cookie.options);

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
