import { notFound } from "next/navigation";
import { DevEnregistrementClient } from "./DevEnregistrementClient";

export const metadata = {
  title: "QA — Enregistrement vocal (ST 2.1)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `NODE_ENV`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique) — même
// convention que `/dev/lecteur` (ST 1.2) et `/dev/script-sync` (ST 1.3).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel du module d'enregistrement vocal (ST 2.1 — DoD "tests
 * manuels multi-navigateurs (Chrome, Firefox, Safari)"). Outil de QA isolé,
 * hors parcours utilisateur : ses scénarios
 * (`src/lib/mocks/voiceRecorderScenarios.ts`) sont des fixtures locales,
 * indépendantes de la source de données. Jusqu'à ST 9.1 (« Bascule intégrale
 * sur PostgreSQL »), la page n'était accessible qu'avec `DATA_SOURCE=mock` ;
 * ce mode ayant été retiré, la garde porte désormais directement sur
 * l'environnement d'exécution — jamais exposée en production.
 */
export default function DevEnregistrementPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevEnregistrementClient />;
}
