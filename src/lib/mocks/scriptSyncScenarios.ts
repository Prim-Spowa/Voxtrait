import type { PlayerSource } from "@/lib/videoPlayer";
import {
  EMBED_SAMPLE_URL_YOUTUBE,
  UPLOAD_SAMPLE_URL,
} from "@/lib/mocks/extraits.mock";

/**
 * Scénarios de test manuel de la synchronisation script/dialogue (ST 1.3),
 * rendus sur la page `/dev/script-sync` (hors production, cf. ST 9.1) — même
 * rôle que `videoPlayerScenarios.ts` pour ST 1.2.
 *
 * Deux scénarios, pour vérifier à l'œil les deux critères d'acceptation de
 * US 1.3 — appuyés sur le jeu de données de démonstration injecté par
 * `prisma/seed.ts` (ST 9.1, anciennement `lib/mocks/script.mock.ts`) :
 * - `mock-001` a un script complet (avec un silence volontaire) →
 *   surbrillance dynamique pendant la lecture ;
 * - `mock-002` n'a aucune ligne de script → message "pas de script
 *   disponible" plutôt qu'une erreur bloquante.
 */
export interface ScriptSyncScenario {
  id: string;
  label: string;
  description: string;
  extraitId: string;
  source: PlayerSource;
  url: string;
  title: string;
}

export const SCRIPT_SYNC_SCENARIOS: ScriptSyncScenario[] = [
  {
    id: "avec-script",
    label: "Avec script — L'Odyssée Stellaire",
    description:
      "Le script se met en surbrillance en suivant la position de lecture. Cliquez sur " +
      "\"Signaler le début de la lecture\" (mode embed, cf. ST 1.2) pour démarrer l'horloge " +
      "de secours, ou utilisez le curseur ci-dessous pour vous positionner directement.",
    extraitId: "mock-001",
    source: "EMBED",
    url: EMBED_SAMPLE_URL_YOUTUBE,
    title: "L'Odyssée Stellaire — Pilote",
  },
  {
    id: "sans-script",
    label: "Sans script — Réverbérations",
    description:
      "Aucune ligne de script pour cet extrait : vérifie le message d'absence de script " +
      "(US 1.3, second critère d'acceptation — pas d'erreur bloquante).",
    extraitId: "mock-002",
    source: "UPLOAD",
    url: UPLOAD_SAMPLE_URL,
    title: "Réverbérations",
  },
];
