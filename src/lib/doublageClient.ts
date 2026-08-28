/**
 * Logique client-safe de l'export du doublage — ST 3.1 « Génération et
 * téléchargement du fichier de doublage » (US 3.1 : télécharger le résultat
 * vidéo + voix).
 *
 * Séparée de `lib/doublage.ts` (orchestration serveur : file de jobs, FFmpeg,
 * stockage) pour pouvoir être importée depuis un composant `"use client"`
 * (`DoublageExport`) sans faire entrer le code serveur dans le bundle
 * navigateur — même séparation que `lib/scriptClient.ts` vs `lib/script.ts`
 * (ST 1.3) ou `lib/extraitsClient.ts` vs `lib/extraits.ts` (ST 1.1).
 *
 * Contient : le contrat de statut de job partagé client/serveur, la
 * validation de la requête d'export (durée ≤ 5 min, taille, type MIME), la
 * stratégie de polling (« Notification frontend de fin de traitement
 * (polling ou websocket) », découpage en tâches point 4), et la construction
 * du nom de fichier téléchargé.
 */

import { DEFAULT_MAX_RECORDING_SECONDS } from "@/lib/voiceRecorder";
import { DOUBLAGE_OUTPUT_EXTENSION } from "@/lib/ffmpegCommand";

/**
 * Cycle de vie d'un job de doublage, tel qu'exposé au frontend :
 * - `en_attente`   : job créé, en file, pas encore pris par un worker ;
 * - `en_traitement`: mixage FFmpeg en cours ;
 * - `pret`         : fichier généré, `downloadUrl` disponible ;
 * - `echec`        : le traitement a échoué (`error` renseigné).
 */
export type DoublageJobStatus = "en_attente" | "en_traitement" | "pret" | "echec";

/** Statuts terminaux : le frontend arrête de poller une fois l'un d'eux atteint. */
const TERMINAL_STATUSES: readonly DoublageJobStatus[] = ["pret", "echec"];

export function isTerminalDoublageStatus(status: DoublageJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Représentation d'un job renvoyée par `GET /api/doublages/:id` et manipulée
 * par le composant `DoublageExport`. Ne contient jamais le blob audio source
 * ni de chemin interne — uniquement ce dont le frontend a besoin.
 */
export interface DoublageJobView {
  id: string;
  status: DoublageJobStatus;
  /** Progression indicative 0..1 (utile pour une barre de progression). */
  progress: number;
  /** URL de téléchargement signée et expirante — présente uniquement si `status === "pret"`. */
  downloadUrl?: string;
  /** Nom de fichier suggéré pour le téléchargement. */
  downloadFilename?: string;
  /** Date d'expiration ISO de `downloadUrl`. */
  expiresAt?: string;
  /** Message d'erreur utilisateur — présent uniquement si `status === "echec"`. */
  error?: string;
}

// --- Validation de la requête d'export ------------------------------------

/**
 * Types MIME audio acceptés en entrée d'export — l'union des types que
 * `MediaRecorder` peut produire selon le navigateur (cf.
 * `PREFERRED_RECORDING_MIME_TYPES` dans `lib/voiceRecorder.ts`). On tolère le
 * paramètre `;codecs=...` en le retirant avant comparaison.
 */
export const ACCEPTED_AUDIO_MIME_TYPES: readonly string[] = [
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
];

/**
 * Taille maximale acceptée pour le blob audio (25 Mo). Ordre de grandeur : une
 * piste Opus mono de 5 min pèse ~2-4 Mo ; 25 Mo laisse de la marge pour des
 * encodages moins efficaces (mp4/AAC sur Safari) sans ouvrir la porte à des
 * envois abusifs. Cohérent avec la contrainte de durée des 5 min (ST 5.1).
 */
export const MAX_DOUBLAGE_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Durée maximale du doublage : identique à la limite d'enregistrement
 * (`DEFAULT_MAX_RECORDING_SECONDS`, elle-même alignée sur les 5 min imposées
 * aux extraits en ST 5.1). Une petite tolérance est ajoutée pour absorber les
 * imprécisions de mesure de durée côté navigateur.
 */
export const MAX_DOUBLAGE_DURATION_SECONDS = DEFAULT_MAX_RECORDING_SECONDS;
const DURATION_TOLERANCE_SECONDS = 1;

export interface DoublageRequestMetadata {
  extraitId: string;
  audioMimeType: string;
  audioSizeBytes: number;
  audioDurationSeconds: number;
}

/** Retire le paramètre `;codecs=...` d'un type MIME pour ne comparer que le type de base. */
export function normalizeAudioMimeType(mimeType: string): string {
  return (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Valide les métadonnées d'une demande d'export avant l'envoi (côté composant)
 * et à la réception (côté endpoint `POST /api/doublages`) — une seule source
 * de vérité, comme `validateScriptLigneInput` pour ST 1.3.
 *
 * @returns un message d'erreur utilisateur, ou `null` si la requête est valide.
 */
export function validateDoublageRequest(meta: DoublageRequestMetadata): string | null {
  if (!meta.extraitId || !meta.extraitId.trim()) {
    return "L'extrait de référence est manquant.";
  }
  if (!ACCEPTED_AUDIO_MIME_TYPES.includes(normalizeAudioMimeType(meta.audioMimeType))) {
    return "Le format de l'enregistrement audio n'est pas pris en charge.";
  }
  if (!Number.isFinite(meta.audioSizeBytes) || meta.audioSizeBytes <= 0) {
    return "L'enregistrement audio est vide ou illisible.";
  }
  if (meta.audioSizeBytes > MAX_DOUBLAGE_AUDIO_BYTES) {
    return "L'enregistrement audio dépasse la taille maximale autorisée (25 Mo).";
  }
  if (!Number.isFinite(meta.audioDurationSeconds) || meta.audioDurationSeconds <= 0) {
    return "La durée de l'enregistrement est invalide.";
  }
  if (meta.audioDurationSeconds > MAX_DOUBLAGE_DURATION_SECONDS + DURATION_TOLERANCE_SECONDS) {
    return "La durée du doublage dépasse la limite de 5 minutes.";
  }
  return null;
}

// --- Stratégie de polling ------------------------------------------------

export const DOUBLAGE_POLL_MIN_DELAY_MS = 1000;
export const DOUBLAGE_POLL_MAX_DELAY_MS = 5000;

/**
 * Délai avant la prochaine interrogation de `GET /api/doublages/:id`, avec un
 * back-off exponentiel borné : on interroge vite au début (le traitement d'un
 * extrait court peut se terminer en quelques secondes) puis on espace pour ne
 * pas marteler l'API si le job traîne dans la file.
 *
 * `attempt` est le numéro de la tentative écoulée (0 = tout premier poll).
 */
export function computeNextPollDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const delay = DOUBLAGE_POLL_MIN_DELAY_MS * 2 ** safeAttempt;
  return Math.min(delay, DOUBLAGE_POLL_MAX_DELAY_MS);
}

/**
 * Indique si la transition d'état `previous` → `next` doit déclencher le
 * téléchargement automatique du fichier (US 3.1 : « quand je clique sur
 * télécharger [...] un fichier [...] est généré et téléchargé »).
 *
 * Déclenche uniquement au *passage* à `pret` avec une URL exploitable — pas à
 * chaque poll renvoyant `pret`, pour ne pas relancer un téléchargement à
 * chaque tick si le composant continue de poller par erreur.
 */
export function shouldTriggerDownload(
  previous: DoublageJobView | null,
  next: DoublageJobView
): boolean {
  if (next.status !== "pret" || !next.downloadUrl) return false;
  return previous?.status !== "pret";
}

// --- Nom de fichier ------------------------------------------------------

/**
 * Construit un nom de fichier de téléchargement lisible à partir du titre de
 * l'extrait, en retombant sur l'id du job si le titre est vide/inexploitable.
 * Ex. : `"L'Odyssée Stellaire — Pilote"` → `odyssee-stellaire-pilote-doublage.mp4`.
 */
export function buildDoublageDownloadFilename(
  extraitTitre: string | null | undefined,
  jobId: string
): string {
  const slug = slugify(extraitTitre ?? "");
  const base = slug || `doublage-${slugify(jobId) || "extrait"}`;
  return `${base}${slug ? "-doublage" : ""}.${DOUBLAGE_OUTPUT_EXTENSION}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
