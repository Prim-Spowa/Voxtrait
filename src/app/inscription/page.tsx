import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { RegisterForm } from "@/components/RegisterForm";

/**
 * Page `/inscription` — ST 4.1 « Inscription » (US 4.1 : créer un compte).
 *
 * Page publique (on ne peut pas s'inscrire en étant déjà connecté, mais la
 * redirection des utilisateurs connectés dépend de la lecture de session,
 * qui relève de ST 4.2 — non gérée ici).
 *
 * `dynamic = "force-dynamic"` : cohérent avec les autres pages liées à un
 * état serveur (ST 3.2) et pour éviter une mise en cache statique d'un
 * écran d'authentification.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Créer un compte — Doublure",
  description:
    "Créez un compte pour sauvegarder vos doublages et les retrouver plus tard. Aucun compte n'est nécessaire pour doubler, télécharger ou partager.",
  robots: { index: false, follow: true },
};

export default function InscriptionPage() {
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
        <RegisterForm />
      </main>
      <Footer />
    </div>
  );
}
