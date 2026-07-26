import type { PlayerSource } from "@/lib/videoPlayer";
import {
  EMBED_SAMPLE_URL_VIMEO,
  EMBED_SAMPLE_URL_YOUTUBE,
  UPLOAD_SAMPLE_URL,
} from "@/lib/mocks/extraits.mock";

/**
 * Scénarios de test manuel du lecteur vidéo (ST 1.2), rendus sur la page
 * `/dev/lecteur` quand `DATA_SOURCE=mock` (cf. `src/lib/config.ts`).
 *
 * Couvre explicitement la Definition of Done de ST 1.2 : « test manuel sur au
 * moins 2 plateformes d'embed cibles » (YouTube + Vimeo ici) et la gestion des
 * erreurs de chargement (source indisponible, embed bloqué, URL invalide).
 */
export interface VideoPlayerScenario {
  id: string;
  label: string;
  description: string;
  source: PlayerSource;
  url: string;
  title: string;
}

export const VIDEO_PLAYER_SCENARIOS: VideoPlayerScenario[] = [
  {
    id: "embed-youtube",
    label: "Embed — YouTube",
    description: "Plateforme cible n°1 (DoD ST 1.2).",
    source: "EMBED",
    url: EMBED_SAMPLE_URL_YOUTUBE,
    title: "Big Buck Bunny — extrait de démonstration (YouTube)",
  },
  {
    id: "embed-vimeo",
    label: "Embed — Vimeo",
    description: "Plateforme cible n°2 (DoD ST 1.2).",
    source: "EMBED",
    url: EMBED_SAMPLE_URL_VIMEO,
    title: "Big Buck Bunny — extrait de démonstration (Vimeo)",
  },
  {
    id: "embed-blocked",
    label: "Embed — bloqué (X-Frame-Options)",
    description:
      "Simule une plateforme qui refuse l'affichage en iframe : vérifie le filet de " +
      "sécurité par délai d'expiration (cf. DEFAULT_EMBED_LOAD_TIMEOUT_MS dans lib/videoPlayer.ts).",
    source: "EMBED",
    url: "https://www.google.com",
    title: "Source bloquant l'affichage en iframe",
  },
  {
    id: "upload-ok",
    label: "Upload — lecture native",
    description: "Fichier importé, servi depuis un stockage objet/CDN (mode natif <video>).",
    source: "UPLOAD",
    url: UPLOAD_SAMPLE_URL,
    title: "Big Buck Bunny — extrait importé de démonstration",
  },
  {
    id: "upload-broken",
    label: "Upload — source indisponible",
    description: "Vérifie la gestion d'erreur de chargement (fichier manquant/404).",
    source: "UPLOAD",
    url: "https://example.com/fichier-inexistant-doublage.mp4",
    title: "Source vidéo indisponible (test d'erreur)",
  },
  {
    id: "invalid-url",
    label: "URL invalide/absente",
    description: "Vérifie la validation en amont du montage du lecteur (lib/videoPlayer.ts).",
    source: "UPLOAD",
    url: "",
    title: "URL absente (test de validation)",
  },
];
