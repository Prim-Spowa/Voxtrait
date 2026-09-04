import type { Metadata } from "next";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";
import DemandeRetraitForm from "@/components/DemandeRetraitForm";
import { TYPES_CONTENU_SIGNALE, type TypeContenuSignale } from "@/lib/demandeRetraitClient";

/**
 * Page `/demande-retrait` — ST 7.3 « Procédure notice-and-takedown », découpage
 * en tâches point 2 : point de contact des ayants droit.
 *
 * Page **publique** (un ayant droit n'a pas de compte). Elle héberge le
 * formulaire (`DemandeRetraitForm`) et rappelle la procédure. Elle accepte des
 * paramètres `?type=EXTRAIT|DOUBLAGE&id=...` pour pré-remplir le contenu visé
 * quand on y arrive depuis une page de contenu.
 */
export const metadata: Metadata = {
  title: "Demande de retrait de contenu — Doublure",
  description:
    "Formulaire réservé aux ayants droit souhaitant demander le retrait d'un contenu.",
};

export const dynamic = "force-dynamic";

function parseType(raw: string | string[] | undefined): TypeContenuSignale | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (TYPES_CONTENU_SIGNALE as readonly string[]).includes(value)
    ? (value as TypeContenuSignale)
    : undefined;
}

export default function DemandeRetraitPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const contenuTypeInitial = parseType(searchParams?.type);
  const idRaw = searchParams?.id;
  const contenuIdInitial = (Array.isArray(idRaw) ? idRaw[0] : idRaw) ?? undefined;

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
          <h1 style={{ margin: 0 }}>Demande de retrait de contenu</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
            Ce formulaire est réservé aux titulaires de droits (ou à leurs
            représentants) souhaitant demander le retrait d&apos;un extrait ou
            d&apos;un doublage. Pour un signalement communautaire (contenu
            choquant, spam…), utilisez le bouton « Signaler » présent sur chaque
            contenu.
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
            Votre demande est enregistrée puis examinée par notre équipe. En cas
            de demande fondée, le contenu est retiré et vous êtes informé par
            email. Les demandes manifestement abusives peuvent être écartées.
          </p>
        </header>
        <DemandeRetraitForm
          contenuTypeInitial={contenuTypeInitial}
          contenuIdInitial={contenuIdInitial}
        />
      </main>
      <Footer />
    </div>
  );
}
