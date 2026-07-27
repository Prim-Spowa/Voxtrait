import { notFound } from "next/navigation";
import { isMockDataSource } from "@/lib/config";
import { DevScriptSyncClient } from "./DevScriptSyncClient";

export const metadata = {
  title: "QA — Script synchronisé (ST 1.3)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `DATA_SOURCE`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique) —
// même pattern que `/dev/lecteur` (ST 1.2).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel de la synchronisation script/dialogue (ST 1.3).
 * Disponible uniquement en mode mock (`DATA_SOURCE=mock`, cf.
 * `src/lib/config.ts`) : pas de page de QA exposée en production.
 */
export default function DevScriptSyncPage() {
  if (!isMockDataSource()) {
    notFound();
  }

  return <DevScriptSyncClient />;
}
