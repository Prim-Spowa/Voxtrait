import { notFound } from "next/navigation";
import { isMockDataSource } from "@/lib/config";
import { DevEnregistrementClient } from "./DevEnregistrementClient";

export const metadata = {
  title: "QA — Enregistrement vocal (ST 2.1)",
  robots: { index: false, follow: false },
};

// Rendu à la requête : la disponibilité de la page dépend de `DATA_SOURCE`,
// évaluée côté serveur à chaque appel (pas de mise en cache statique) — même
// convention que `/dev/lecteur` (ST 1.2) et `/dev/script-sync` (ST 1.3).
export const dynamic = "force-dynamic";

/**
 * Page de test manuel du module d'enregistrement vocal (ST 2.1 — DoD "tests
 * manuels multi-navigateurs (Chrome, Firefox, Safari)"). Disponible
 * uniquement en mode mock (`DATA_SOURCE=mock`), pas en production.
 */
export default function DevEnregistrementPage() {
  if (!isMockDataSource()) {
    notFound();
  }

  return <DevEnregistrementClient />;
}
