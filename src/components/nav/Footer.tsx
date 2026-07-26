/**
 * Port TypeScript de `components/nav/Footer.jsx` (design system Doublure).
 *
 * Les liens juridiques vivent ici et nulle part ailleurs : « pas de bandeau
 * permanent », mention discrète et factuelle (règle « Juridique »). Les cibles
 * pointent vers des pages non encore créées — elles seront branchées avec les
 * stories correspondantes (CGU, charte, signalement, retrait ayant droit).
 */

const LINKS = [
  { label: "À propos", href: "/a-propos" },
  { label: "CGU", href: "/cgu" },
  { label: "Charte fandub", href: "/charte-fandub" },
  { label: "Signaler un contenu", href: "/signaler" },
  { label: "Retrait ayant droit", href: "/retrait" },
  { label: "Confidentialité", href: "/confidentialite" },
];

export function Footer() {
  return (
    <footer
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-6) var(--gutter-page)",
        borderTop: "var(--border-hairline)",
        background: "var(--surface-card)",
        fontSize: "var(--text-caption)",
        color: "var(--text-muted)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-display)",
          color: "var(--text-primary)",
        }}
      >
        Doublure
      </span>
      <nav aria-label="Liens légaux" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} style={{ color: "var(--text-muted)", borderBottom: "none" }}>
            {l.label}
          </a>
        ))}
      </nav>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-micro)",
        }}
      >
        Projet de fans, sans but commercial.
      </span>
    </footer>
  );
}
