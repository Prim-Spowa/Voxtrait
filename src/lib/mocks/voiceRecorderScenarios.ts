import type { PlayerSource } from "@/lib/videoPlayer";
import { EMBED_SAMPLE_URL_YOUTUBE, UPLOAD_SAMPLE_URL } from "@/lib/mocks/extraits.mock";

/**
 * Scénarios de test manuel du module d'enregistrement vocal (ST 2.1), rendus
 * sur la page `/dev/enregistrement` quand `DATA_SOURCE=mock` (cf.
 * `src/lib/config.ts`) — même convention que `videoPlayerScenarios.ts`
 * (ST 1.2).
 *
 * Couvre la Definition of Done "tests manuels multi-navigateurs (Chrome,
 * Firefox, Safari)" : le scénario UPLOAD exerce la prévisualisation combinée
 * automatique (vidéo + voix), le scénario EMBED exerce le message de repli
 * documenté pour les sources sans contrôle de lecture programmatique fiable.
 */
export interface VoiceRecorderScenario {
  id: string;
  /**
   * Id d'un extrait réellement présent dans `MOCK_EXTRAITS` — utilisé comme
   * `extraitId` par `DoublageExport` (ST 3.1) pour que `POST /api/doublages`
   * résolve une vidéo source (sinon 404). Distinct de `id` (identifiant du
   * scénario de QA).
   */
  extraitId: string;
  label: string;
  description: string;
  source: PlayerSource;
  url: string;
  title: string;
}

export const VOICE_RECORDER_SCENARIOS: VoiceRecorderScenario[] = [
  {
    id: "upload-doublage",
    extraitId: "mock-002",
    label: "Upload — prévisualisation combinée automatique",
    description:
      "Enregistrez votre voix pendant le déroulé de l'extrait, puis rejouez la prévisualisation : " +
      "la vidéo (muette) et votre voix doivent démarrer avec le même décalage que celui observé " +
      "au moment où vous avez cliqué sur « Démarrer l'enregistrement ».",
    source: "UPLOAD",
    url: UPLOAD_SAMPLE_URL,
    title: "Big Buck Bunny — extrait importé de démonstration",
  },
  {
    id: "embed-doublage",
    extraitId: "mock-001",
    label: "Embed — repli sans prévisualisation combinée",
    description:
      "Vérifie le message de repli : pas de contrôle programmatique fiable sur l'iframe tierce " +
      "(même limite que l'horloge de secours de VideoPlayer, ST 1.2), donc seule la voix isolée " +
      "peut être réécoutée après l'enregistrement.",
    source: "EMBED",
    url: EMBED_SAMPLE_URL_YOUTUBE,
    title: "Big Buck Bunny — extrait de démonstration (YouTube)",
  },
];
