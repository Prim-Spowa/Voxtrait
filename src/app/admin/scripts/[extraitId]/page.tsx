import { AdminScriptEditorClient } from "./AdminScriptEditorClient";

export const metadata = {
  title: "Admin — Script synchronisé (ST 1.3)",
  robots: { index: false, follow: false },
};

/**
 * Outil interne de saisie/import des lignes de script (ST 1.3, découpage en
 * tâches, point 4). Page mince : toute la logique vit dans
 * `AdminScriptEditorClient` (composant client, cf. commentaire de ce
 * fichier pour l'avertissement sur l'absence de contrôle d'accès).
 *
 * Contrairement à `/dev/lecteur` (ST 1.2), cette page n'est pas limitée au
 * mode `DATA_SOURCE=mock` : c'est un outil de contenu destiné à fonctionner
 * contre la base réelle une fois le catalogue en production, pas seulement
 * un outil de QA.
 */
export default function AdminScriptPage({ params }: { params: { extraitId: string } }) {
  return <AdminScriptEditorClient extraitId={params.extraitId} />;
}
