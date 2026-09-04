import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import ModerationDashboard from "@/components/ModerationDashboard";
import { buildLoginRedirectPath } from "@/lib/authGuard";
import { RoleInsuffisantError } from "@/lib/authz";
import {
  exigerModerateur,
  NonAuthentifieError,
} from "@/lib/moderationAuth";
import { MODERATION_ADMIN_PATH } from "@/lib/moderationClient";

/**
 * Page `/admin/moderation` — ST 7.2 « Dashboard de modération », découpage en
 * tâches point 2 : interface de traitement des signalements.
 *
 * **Double garde** (cf. `src/middleware.ts` + `src/lib/moderationAuth.ts`) :
 *  - le middleware Edge redirige vers `/connexion` si le cookie de session est
 *    absent (`/admin/moderation` est un préfixe protégé) ;
 *  - ici, `exigerModerateur` vérifie le jeton **et le rôle** : un compte
 *    connecté mais non modérateur reçoit un `403` (page « accès refusé »), pas
 *    un rendu partiel du dashboard.
 */
export const metadata: Metadata = {
  title: "Modération — Doublure",
  robots: { index: false, follow: false },
};

// Dépend de la session : jamais de rendu statique.
export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  try {
    await exigerModerateur(cookies());
  } catch (err) {
    if (err instanceof NonAuthentifieError) {
      redirect(buildLoginRedirectPath(MODERATION_ADMIN_PATH));
    }
    if (err instanceof RoleInsuffisantError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <TopBar />
          <main style={{ flex: 1, padding: "var(--space-6)", maxWidth: 640, margin: "0 auto" }}>
            <h1>Accès refusé</h1>
            <p>
              Cette page est réservée à l&apos;équipe de modération. Si vous pensez
              qu&apos;il s&apos;agit d&apos;une erreur, contactez un administrateur.
            </p>
          </main>
          <Footer />
        </div>
      );
    }
    throw err;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 960,
          margin: "0 auto",
          padding: "var(--space-6) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <header>
          <h1 style={{ margin: 0 }}>File de modération</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            Traitez les signalements des utilisateurs. Chaque décision est
            journalisée (traçabilité).
          </p>
        </header>
        <ModerationDashboard />
      </main>
      <Footer />
    </div>
  );
}
