import BibliothequeListing from "@/components/BibliothequeListing";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";

// ST 1.1 — page `/bibliotheque` : accessible sans compte (cf. US 1.1,
// "visiteur"), pas de garde d'authentification ici.
export const metadata = {
  title: "Bibliothèque — Doublure",
  description:
    "Parcourez la bibliothèque d'extraits vidéo (films, séries, dessins animés) à redoubler.",
};

/**
 * Encart d'appel. Traité comme un « encart isolé » du design system : fond
 * carte, bordure 2 px encre et ombre dure décalée — même traitement que l'état
 * vide du listing, pour que les deux blocs de la page se répondent. Le seul
 * accent magenta de l'écran reste le surtitre.
 *
 * Titre ≤ 5 mots, sous-titre ≤ 2 lignes, vouvoiement (règles de contenu du
 * design system). Le texte est celui validé dans le README du design system.
 */
function Hero() {
  return (
    <section
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-6)",
        flexWrap: "wrap",
        padding: "var(--space-6)",
        background: "var(--surface-card)",
        color: "var(--text-primary)",
        border: "var(--border-hard)",
        boxShadow: "var(--shadow-hard-sm)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          maxWidth: 560,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-caps)",
            color: "var(--accent-primary)",
          }}
        >
          prêtez votre voix
        </span>
        <h1 style={{ fontSize: "var(--text-display-lg)" }}>
          Choisissez une scène,
          <br />
          prenez le micro
        </h1>
        <p style={{ margin: 0, fontSize: "var(--text-body)", color: "var(--text-secondary)" }}>
          Le script défile mot à mot sous la vidéo. Aucun compte n&apos;est nécessaire pour
          doubler, télécharger ou partager.
        </p>
      </div>
    </section>
  );
}

export default function BibliothequePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar active="library" />

      {/* Pas de `max-width` ici : la colonne de filtres est collée au bord
          gauche, comme la barre supérieure. Le plafond de 1440 px du design
          system est appliqué à la seule colonne de résultats, à l'intérieur du
          listing — sinon le bloc entier se recentre et laisse une bande vide à
          gauche. */}
      <div style={{ flex: 1, display: "flex", width: "100%" }}>
        <BibliothequeListing hero={<Hero />} />
      </div>

      <Footer />
    </div>
  );
}
