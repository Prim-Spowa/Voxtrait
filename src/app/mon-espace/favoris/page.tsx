import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FavorisListing from "@/components/FavorisListing";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { readSessionFromCookieStore } from "@/lib/session";
import { buildLoginRedirectPath } from "@/lib/authGuard";
import { MON_ESPACE_FAVORIS_PATH } from "@/lib/favoriClient";

/**
 * Page « Mes favoris » — ST 8.1 « Marquer une scène en favori », découpage en
 * tâches point 5 : « Page `/mon-espace/favoris` réutilisant le composant de
 * listing de la bibliothèque (ST 1.1) ».
 *
 * Route réservée aux comptes (`/mon-espace/*`, cf. `src/lib/authGuard.ts` +
 * `src/middleware.ts`). Le middleware Edge fait déjà barrage en amont ; ce
 * garde-fou serveur (vérification cryptographique du jeton via
 * `readSessionFromCookieStore`) évite un rendu inutile si le cookie est
 * présent mais falsifié/expiré, et renvoie vers la connexion avec `?next=`
 * renseigné — même structure que `/mon-espace/historique` (ST 6.2).
 *
 * Le contenu (grille + pagination + retrait) est un composant client qui
 * consomme `GET /api/favoris`.
 */
export const metadata: Metadata = {
  title: "Mes favoris — Doublure",
  description: "Retrouvez les scènes que vous avez marquées en favori.",
};

// Le listing dépend de la session : jamais de rendu statique.
export const dynamic = "force-dynamic";

export default function MesFavorisPage() {
  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    redirect(buildLoginRedirectPath(MON_ESPACE_FAVORIS_PATH));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <div style={{ flex: 1, display: "flex", width: "100%" }}>
        <FavorisListing />
      </div>
      <Footer />
    </div>
  );
}
