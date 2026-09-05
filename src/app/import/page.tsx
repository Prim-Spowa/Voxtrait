import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ImportForm from "@/components/ImportForm";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { readSessionFromCookieStore } from "@/lib/session";
import { buildLoginRedirectPath } from "@/lib/authGuard";

/**
 * Page « Importer une vidéo » (`/import`) — ST 9.5 « Formulaire d'import
 * utilisateur », découpage en tâches (l'ensemble de la story) : héberge le
 * formulaire (`ImportForm`) qui déroule le parcours d'import déjà exposé côté
 * API par ST 5.1 (« Import et compression vidéo ») et ST 5.2 (« Certification
 * des droits à l'import »).
 *
 * Route déjà réservée aux comptes par le middleware (`/import/:path*`, cf.
 * `src/middleware.ts` + `src/lib/authGuard.ts`, ST 4.2) et par
 * `resolveImportAccess` côté API (session + CGU acceptées, ST 4.3). Ce
 * garde-fou serveur (vérification cryptographique du jeton via
 * `readSessionFromCookieStore`) évite un rendu inutile si le cookie est
 * présent mais falsifié/expiré — même principe que
 * `mon-espace/historique/page.tsx` (ST 6.2). Il ne contrôle **pas**
 * l'acceptation des CGU : un compte connecté mais n'ayant pas encore accepté
 * les CGU voit le formulaire, et se voit opposer l'erreur `403` de
 * `resolveImportAccess` à la soumission — la page ne duplique pas cette
 * logique de blocage (source de vérité unique côté API).
 */
export const metadata: Metadata = {
  title: "Importer une vidéo — Doublure",
  description:
    "Importez un extrait vidéo personnel pour le redoubler : sélection du fichier, certification des droits, suivi de l'import.",
};

// Dépend de la session : jamais de rendu statique.
export const dynamic = "force-dynamic";

export default function ImportPage() {
  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    redirect(buildLoginRedirectPath("/import"));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          padding: "var(--space-6) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <header>
          <h1 style={{ margin: 0 }}>Importer une vidéo</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            Importez un extrait vidéo personnel (5 minutes maximum) pour le
            redoubler. Votre import est vérifié puis compressé automatiquement ;
            il n&apos;apparaît dans la bibliothèque qu&apos;après validation par
            la modération.
          </p>
        </header>
        <ImportForm />
      </main>
      <Footer />
    </div>
  );
}
