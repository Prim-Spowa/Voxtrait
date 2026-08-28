import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import { CGU_SECTIONS, CGU_VERSION } from "@/lib/cgu";

/**
 * Page `/cgu` — ST 4.3 « Acceptation des CGU (fan-usage) », découpage en
 * tâches : « page CGU versionnée ».
 *
 * Rend le texte des CGU (`CGU_SECTIONS`) et affiche la version en vigueur
 * (`CGU_VERSION`) : c'est cette version que l'utilisateur accepte à
 * l'inscription (case obligatoire) ou via `POST /api/auth/cgu` si les CGU ont
 * évolué depuis sa dernière acceptation.
 *
 * ⚠️ Le texte est un brouillon technique — validation juridique requise avant
 * mise en production (ST 4.3, DoD : « validation du texte CGU par un juriste
 * signalée comme prérequis externe »).
 */
export const metadata = {
  title: "Conditions générales d'utilisation — Doublure",
  description:
    "Conditions générales d'utilisation de la plateforme de redoublage (fandub) : usage des contenus, responsabilités, modération et retrait.",
};

export default function CguPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <main
        style={{
          flex: 1,
          padding: "var(--space-7) var(--gutter-page)",
        }}
      >
        <article style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 style={{ marginTop: 0, fontSize: "var(--text-title)" }}>
            Conditions générales d&apos;utilisation
          </h1>
          <p style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)" }}>
            Version {CGU_VERSION}
          </p>

          {CGU_SECTIONS.map((section) => (
            <section key={section.titre} style={{ marginTop: "var(--space-6)" }}>
              <h2 style={{ fontSize: "var(--text-subtitle, var(--text-title))" }}>{section.titre}</h2>
              {section.paragraphes.map((paragraphe, index) => (
                <p key={index} style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {paragraphe}
                </p>
              ))}
            </section>
          ))}
        </article>
      </main>
      <Footer />
    </div>
  );
}
