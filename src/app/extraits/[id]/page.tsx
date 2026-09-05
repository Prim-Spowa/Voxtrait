import { ExtraitPageClient } from "./ExtraitPageClient";
import { Footer } from "@/components/nav/Footer";
import { TopBar } from "@/components/nav/TopBar";

export const metadata = {
  title: "Doubler un extrait — Doublure",
  description:
    "Visionnez l'extrait, suivez le script synchronisé et enregistrez votre voix par-dessus.",
};

/**
 * Route publique `/extraits/:id` — ST 10.3 « Page publique unifiée d'un
 * extrait (visionnage + script + doublage) », découpage en tâches point 1.
 *
 * Réunit dans un même parcours les composants jusqu'ici seulement assemblés
 * dans l'outil de QA `/dev/enregistrement` (ST 2.1) : `VideoPlayer` (ST 1.2),
 * `ScriptSynchronise` (ST 1.3), `VoiceRecorder` avec réinitialisation
 * (ST 2.1/2.2) et `DoublageExport` (ST 3.1). C'est cette route que les
 * cartes de la bibliothèque (`BibliothequeListing`, ST 1.1) ciblent
 * désormais via `ClipCard.href`.
 *
 * Page mince : comme `AdminScriptEditorClient` (ST 1.3) et
 * `BibliothequeListing` (ST 1.1), toute la récupération de données
 * (`GET /api/extraits/:id`, `GET /api/extraits/:id/script`) et la gestion de
 * l'état (introuvable/non validé, pas de script, enregistrement en cours)
 * vivent côté client dans `ExtraitPageClient` — même convention que le reste
 * du projet plutôt que le chargement serveur ponctuel de `/doublage/:id`
 * (ST 3.2), qui doit lui exposer des balises Open Graph dynamiques ; rien
 * de tel n'est requis ici (cf. notes de dev ST 10.3).
 */
export default function ExtraitPage({ params }: { params: { id: string } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar active="library" />
      <ExtraitPageClient extraitId={params.id} />
      <Footer />
    </div>
  );
}
