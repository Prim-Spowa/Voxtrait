import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session.shared";
import { buildLoginRedirectPath, isProtectedPath } from "@/lib/authGuard";

/**
 * Middleware de protection des routes — ST 4.2 « Connexion / déconnexion »,
 * découpage en tâches point 3.
 *
 * ⚠️ Partage des responsabilités (contrôle en deux temps) :
 *
 *  1. **Ici (middleware, runtime Edge)** : contrôle de **présence** du cookie
 *     de session sur les chemins protégés (`isProtectedPath`). Pas de
 *     vérification de signature : le middleware s'exécute sur le runtime Edge
 *     de Next, où `node:crypto` (HMAC) n'est pas disponible. Un visiteur sans
 *     cookie est redirigé vers `/connexion?next=…` **avant** que la page
 *     protégée ne soit rendue — c'est le garde-fou UX.
 *
 *  2. **Dans la page / le Route Handler protégé (runtime Node)** : appel à
 *     `readSessionFromCookieStore(cookies())` (`lib/session.ts`) qui, lui,
 *     **vérifie** la signature et l'expiration. C'est le garde-fou de
 *     sécurité : un cookie forgé passe le middleware mais est rejeté ici.
 *
 * Autrement dit : le middleware ne doit jamais être la seule ligne de défense.
 * Toute page sous un préfixe protégé doit revérifier la session côté serveur
 * (à brancher au fil des ST 5.x / 6.x qui créeront ces pages).
 */

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  const loginTarget = buildLoginRedirectPath(`${pathname}${search}`);
  redirectUrl.pathname = loginTarget.split("?")[0]!;
  redirectUrl.search = loginTarget.slice(loginTarget.indexOf("?"));
  return NextResponse.redirect(redirectUrl);
}

/**
 * Ne fait tourner le middleware que sur les préfixes concernés — évite le
 * coût sur toutes les autres routes (assets, bibliothèque publique, API
 * publiques). Doit rester cohérent avec `PROTECTED_PREFIXES` de
 * `lib/authGuard.ts`.
 */
export const config = {
  matcher: [
    "/mon-espace/:path*",
    "/import/:path*",
    "/admin/moderation/:path*",
    "/admin/demandes-retrait/:path*",
  ],
};
