import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { LoginPageClient } from "./LoginPageClient";

/**
 * Page `/connexion` — ST 4.2 « Connexion / déconnexion » (US 4.2 : me
 * connecter). Pendant de `/inscription` (ST 4.1).
 *
 * `dynamic = "force-dynamic"` : écran d'authentification, jamais mis en cache
 * statique (cohérent avec `/inscription`).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Se connecter — Doublure",
  description:
    "Connectez-vous pour retrouver vos doublages sauvegardés. Aucun compte n'est nécessaire pour doubler, télécharger ou partager.",
  robots: { index: false, follow: true },
};

export default function ConnexionPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <main
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          padding: "var(--space-7) var(--gutter-page)",
        }}
      >
        <LoginPageClient next={searchParams?.next} />
      </main>
      <Footer />
    </div>
  );
}
