import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import DemandesRetraitDashboard from "@/components/DemandesRetraitDashboard";
import { buildLoginRedirectPath } from "@/lib/authGuard";
import { RoleInsuffisantError } from "@/lib/authz";
import { exigerModerateur, NonAuthentifieError } from "@/lib/moderationAuth";
import { DEMANDES_RETRAIT_ADMIN_PATH } from "@/lib/demandeRetraitClient";

/**
 * Page `/admin/demandes-retrait` — ST 7.3 « Procédure notice-and-takedown ».
 *
 * **Double garde** identique à `/admin/moderation` (ST 7.2) : le middleware Edge
 * exige la présence du cookie ; ici `exigerModerateur` vérifie le jeton **et le
 * rôle** (`MODERATEUR` / `ADMIN`).
 */
export const metadata: Metadata = {
  title: "Demandes de retrait — Doublure",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DemandesRetraitPage() {
  try {
    await exigerModerateur(cookies());
  } catch (err) {
    if (err instanceof NonAuthentifieError) {
      redirect(buildLoginRedirectPath(DEMANDES_RETRAIT_ADMIN_PATH));
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
          <h1 style={{ margin: 0 }}>Demandes de retrait (ayants droit)</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            Procédure notice-and-takedown. Un retrait décidé ici applique le
            statut <code>RETRAIT_AYANT_DROIT</code> au contenu et journalise une
            décision dédiée (distincte d&apos;un retrait de modération), pour le
            suivi des délais.
          </p>
        </header>
        <DemandesRetraitDashboard />
      </main>
      <Footer />
    </div>
  );
}
