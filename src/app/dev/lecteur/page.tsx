import { notFound } from "next/navigation";
import { isMockDataSource } from "@/lib/config";
import { DevLecteurClient } from "./DevLecteurClient";

export const metadata = {
  title: "QA — Lecteur vidéo (ST 1.2)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `DATA_SOURCE`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel du lecteur vidéo (ST 1.2 — DoD "test manuel sur au
 * moins 2 plateformes d'embed cibles"). Disponible uniquement en mode mock
 * (`DATA_SOURCE=mock`, cf. `src/lib/config.ts`) : pas de page de QA exposée en
 * production (`DATA_SOURCE=api` par défaut).
 */
export default function DevLecteurPage() {
  if (!isMockDataSource()) {
    notFound();
  }

  return <DevLecteurClient />;
}
