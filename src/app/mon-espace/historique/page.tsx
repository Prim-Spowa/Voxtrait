import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DoublageHistoriqueListing from "@/components/DoublageHistoriqueListing";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { readSessionFromCookieStore } from "@/lib/session";
import { buildLoginRedirectPath } from "@/lib/authGuard";
import { MON_ESPACE_HISTORIQUE_PATH } from "@/lib/doublageSauvegardeClient";

/**
 * Page « Mon historique » — ST 6.2 « Historique des doublages », découpage en
 * tâches point 2 : « Page frontend listant les doublages avec actions
 * associées ».
 *
 * Route réservée aux comptes (`/mon-espace/*`, cf. `src/lib/authGuard.ts` +
 * `src/middleware.ts`). Le middleware Edge fait déjà barrage en amont ; ce
 * garde-fou serveur (vérification cryptographique du jeton via
 * `readSessionFromCookieStore`) évite un rendu inutile si le cookie est présent
 * mais falsifié/expiré, et renvoie vers la connexion avec `?next=` renseigné.
 *
 * Le contenu (listing + pagination + actions) est un composant client qui
 * consomme `GET /api/doublages?utilisateur=me`.
 */
export const metadata: Metadata = {
  title: "Mon historique — Doublure",
  description: "Retrouvez, réécoutez, téléchargez et partagez vos doublages sauvegardés.",
};

// L'historique dépend de la session : jamais de rendu statique.
export const dynamic = "force-dynamic";

export default function MonHistoriquePage() {
  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    redirect(buildLoginRedirectPath(MON_ESPACE_HISTORIQUE_PATH));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <div style={{ flex: 1, display: "flex", width: "100%" }}>
        <DoublageHistoriqueListing />
      </div>
      <Footer />
    </div>
  );
}
