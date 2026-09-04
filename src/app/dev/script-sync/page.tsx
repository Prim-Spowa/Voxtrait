import { notFound } from "next/navigation";
import { DevScriptSyncClient } from "./DevScriptSyncClient";

export const metadata = {
  title: "QA — Script synchronisé (ST 1.3)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `NODE_ENV`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique) — même
// pattern que `/dev/lecteur` (ST 1.2).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel de la synchronisation script/dialogue (ST 1.3). Outil
 * de QA isolé, hors parcours utilisateur : ses scénarios
 * (`src/lib/mocks/scriptSyncScenarios.ts`) référencent les extraits `mock-001`
 * (script complet) / `mock-002` (sans script) du jeu de données de
 * démonstration injecté par `prisma/seed.ts` — la page continue de
 * fonctionner sans changement contre `GET /api/extraits/:id/script`
 * (ST 9.1 : le endpoint interroge désormais toujours Postgres). Jusqu'à
 * ST 9.1, la page n'était accessible qu'avec `DATA_SOURCE=mock` ; ce mode
 * ayant été retiré, la garde porte désormais directement sur l'environnement
 * d'exécution — jamais exposée en production.
 */
export default function DevScriptSyncPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevScriptSyncClient />;
}
