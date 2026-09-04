import { notFound } from "next/navigation";
import { DevLecteurClient } from "./DevLecteurClient";

export const metadata = {
  title: "QA — Lecteur vidéo (ST 1.2)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `NODE_ENV`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel du lecteur vidéo (ST 1.2 — DoD "test manuel sur au
 * moins 2 plateformes d'embed cibles"). Outil de QA isolé, hors parcours
 * utilisateur : ses scénarios (`src/lib/mocks/videoPlayerScenarios.ts`) sont
 * des fixtures locales, indépendantes de la source de données (aucun appel
 * à `GET /api/extraits`). Jusqu'à ST 9.1 (« Bascule intégrale sur
 * PostgreSQL »), la page n'était accessible qu'avec `DATA_SOURCE=mock` ; ce
 * mode ayant été retiré, la garde porte désormais directement sur
 * l'environnement d'exécution — jamais exposée en production.
 */
export default function DevLecteurPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevLecteurClient />;
}
