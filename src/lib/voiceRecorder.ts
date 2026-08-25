/**
 * Logique du module d'enregistrement vocal synchronisé (ST 2.1 « Module
 * d'enregistrement vocal synchronisé »).
 *
 * Même séparation logique/composant que `lib/videoPlayer.ts` (ST 1.2) :
 * fonctions pures testables sans monter de DOM ni de vrai `MediaRecorder`
 * (interface `MediaRecorderLike` injectée, cf. `startRecordingSession`).
 */

/** États du cycle de vie de l'enregistrement, pilotés par `VoiceRecorder`. */
export type RecorderStatus =
  | "idle"
  | "requesting-permission"
  | "permission-denied"
  | "ready"
  | "recording"
  | "stopped"
  | "error";

/**
 * Durée maximale d'un enregistrement, alignée sur la contrainte de 5 minutes
 * déjà imposée aux extraits importés (cf. ST 5.1, "Points d'attention") — un
 * doublage ne peut pas dépasser la durée de l'extrait qu'il accompagne, et
 * borner la capture limite aussi la mémoire consommée par le blob audio
 * (cf. ST 2.1, "Points d'attention" : "gestion mémoire pour les extraits
 * proches de 5 minutes").
 */
export const DEFAULT_MAX_RECORDING_SECONDS = 300;

/**
 * Traduit les erreurs `getUserMedia`/`MediaRecorder` (essentiellement des
 * `DOMException` nommées par les navigateurs) en messages utilisateur
 * explicites en français, plutôt que de laisser remonter un message
 * technique. Couvre le découpage en tâches "Demande de permission micro +
 * gestion des refus/erreurs navigateur".
 *
 * Les noms couverts (`NotAllowedError`, `NotFoundError`, ...) sont ceux de la
 * spec MediaStream/`getUserMedia` — cf. MDN. Un nom non reconnu retombe sur un
 * message générique plutôt que de bloquer silencieusement.
 */
export function describeMicrophoneError(error: unknown): string {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === "object" && error !== null && "name" in error
        ? String((error as { name: unknown }).name)
        : undefined;

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "L'accès au microphone a été refusé. Autorisez-le dans les paramètres de votre navigateur pour pouvoir enregistrer votre voix.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Aucun microphone n'a été détecté sur cet appareil.";
    case "NotReadableError":
    case "TrackStartError":
      return "Le microphone est déjà utilisé par une autre application. Fermez-la puis réessayez.";
    case "SecurityError":
      return "L'accès au microphone nécessite une connexion sécurisée (HTTPS).";
    case "AbortError":
      return "La demande d'accès au microphone a été interrompue. Réessayez.";
    default: {
      const message = error instanceof Error ? error.message : undefined;
      return message
        ? `Impossible d'accéder au microphone (${message}).`
        : "Impossible d'accéder au microphone pour une raison inconnue.";
    }
  }
}

/**
 * Types MIME candidats pour `MediaRecorder`, par ordre de préférence.
 *
 * Point d'attention DoD "Compatibilité navigateurs (Safari a des limitations
 * connues sur `MediaRecorder`)" : Safari ne supporte historiquement pas
 * `audio/webm` mais expose `audio/mp4` — d'où une liste de repli plutôt qu'un
 * seul type MIME codé en dur.
 */
export const PREFERRED_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

/**
 * Sélectionne le premier type MIME supporté parmi une liste de candidats.
 *
 * `isTypeSupported` est injecté (plutôt qu'un appel direct à
 * `MediaRecorder.isTypeSupported`) pour rester testable sans dépendre de la
 * disponibilité de `MediaRecorder` dans l'environnement d'exécution — même
 * pattern que `extraitDelegate` (ST 1.1) ou `embedLoadTimeoutMs` (ST 1.2).
 */
export function pickSupportedMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = PREFERRED_RECORDING_MIME_TYPES
): string | null {
  for (const candidate of candidates) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return null;
}

/**
 * Sous-ensemble de l'API `MediaRecorder` réellement utilisé ici — permet un
 * mock simple en test (cf. DoD "Tests unitaires sur la logique de synchro
 * (mock `MediaRecorder`)"), sans dépendre de l'implémentation réelle du
 * navigateur (absente de jsdom).
 */
export interface MediaRecorderLike {
  readonly state: "inactive" | "recording" | "paused";
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
}

export interface RecordingSessionHandlers {
  onStop?: (blob: Blob) => void;
  onError?: (message: string) => void;
}

export interface RecordingSession {
  /**
   * Position de lecture vidéo (secondes) au moment où l'enregistrement a
   * démarré — l'horodatage relatif au temps vidéo demandé par le résumé de
   * ST 2.1. Réutilisé ensuite par `computeAudioPlaybackDelayMs` pour aligner
   * la prévisualisation.
   */
  readonly startedAtVideoTimeSeconds: number;
  readonly mimeType: string;
}

/**
 * Démarre une session d'enregistrement sur un `MediaRecorder` (réel ou
 * mocké) et câble les handlers de fin/erreur.
 *
 * Les morceaux (`chunks`) sont assemblés en un unique `Blob` à l'arrêt
 * (`onstop`), plutôt que d'exposer les morceaux bruts à l'appelant — c'est la
 * forme attendue par le stockage temporaire (`lib/audioBlobStore.ts`) et par
 * la prévisualisation (`URL.createObjectURL`).
 */
export function startRecordingSession(
  recorder: MediaRecorderLike,
  videoTimeSeconds: number,
  mimeType: string,
  handlers: RecordingSessionHandlers = {}
): RecordingSession {
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onstop = () => {
    handlers.onStop?.(new Blob(chunks, { type: mimeType || undefined }));
  };
  recorder.onerror = (event) => {
    handlers.onError?.(describeMicrophoneError(event?.error));
  };

  recorder.start();

  return { startedAtVideoTimeSeconds: videoTimeSeconds, mimeType };
}

/**
 * Vérifie si la durée maximale autorisée d'enregistrement est atteinte —
 * utilisé pour déclencher un arrêt automatique (cf. `VoiceRecorder`, effet de
 * l'horloge d'écoulement) plutôt que de compter sur l'utilisateur pour
 * arrêter lui-même avant la limite.
 */
export function hasReachedMaxDuration(
  elapsedSeconds: number,
  maxDurationSeconds: number = DEFAULT_MAX_RECORDING_SECONDS
): boolean {
  return elapsedSeconds >= maxDurationSeconds;
}

/**
 * Délai (en millisecondes) avant de démarrer la lecture de la piste audio
 * enregistrée lors de la prévisualisation combinée (résumé de ST 2.1 :
 * « lecture combinée vidéo + piste audio capturée [...] superposés »), la
 * vidéo de prévisualisation repartant systématiquement du début.
 *
 * ⚠️ Ne compense que le décalage lié à l'instant de démarrage dans la
 * timeline vidéo — pas la latence propre du pipeline micro/encodeur, non
 * mesurée ici (cf. notes de dev, point signalé pour revue humaine).
 */
export function computeAudioPlaybackDelayMs(startedAtVideoTimeSeconds: number): number {
  return Math.max(0, Math.round(startedAtVideoTimeSeconds * 1000));
}

/** Formate un nombre de secondes en `mm:ss`, pour l'affichage du chrono d'enregistrement. */
export function formatElapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * États du recorder pour lesquels l'action « Recommencer » (ST 2.2) a un
 * effet réel : un enregistrement en cours à interrompre, un résultat déjà
 * produit à écarter, ou une erreur survenue pendant la capture.
 *
 * Volontairement exclus :
 * - `idle` / `requesting-permission` : rien à réinitialiser (pas encore de
 *   flux micro ni de blob).
 * - `ready` : le flux micro est ouvert mais rien n'a encore été enregistré ;
 *   démarrer directement l'enregistrement a le même effet utile.
 * - `permission-denied` : couvert par le bouton « Réessayer » déjà existant
 *   (ST 2.1), qui relance la même demande de permission — ajouter
 *   « Recommencer » à côté aurait été redondant.
 */
const RESETTABLE_RECORDER_STATUSES: readonly RecorderStatus[] = [
  "recording",
  "stopped",
  "error",
];

/** Indique si l'action « Recommencer » (ST 2.2) doit être proposée pour un état donné. */
export function canResetRecording(status: RecorderStatus): boolean {
  return RESETTABLE_RECORDER_STATUSES.includes(status);
}

/**
 * Arrête un `MediaRecorder` en cours sans déclencher `onStop`/`onError`
 * (ST 2.2, action « Recommencer ») : les handlers sont détachés avant
 * l'arrêt pour qu'un enregistrement abandonné ne produise ni résultat ni
 * sauvegarde dans le store (`AudioBlobStore`).
 *
 * Ne fait rien si `recorder` est `null` ou déjà `inactive` — idempotent,
 * comme le reste des opérations de réinitialisation de ce module.
 */
export function stopRecordingSilently(recorder: MediaRecorderLike | null): void {
  if (!recorder || recorder.state === "inactive") return;
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
  recorder.stop();
}
