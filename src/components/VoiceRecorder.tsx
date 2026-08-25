"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_MAX_RECORDING_SECONDS,
  canResetRecording,
  describeMicrophoneError,
  formatElapsedLabel,
  computeAudioPlaybackDelayMs,
  hasReachedMaxDuration,
  pickSupportedMimeType,
  startRecordingSession,
  stopRecordingSilently,
  type MediaRecorderLike,
  type RecorderStatus,
} from "@/lib/voiceRecorder";
import {
  createDefaultAudioBlobStore,
  type AudioBlobStore,
} from "@/lib/audioBlobStore";
// Réutilisation de l'horloge de secours de ST 1.2 : c'est un utilitaire
// générique (mesure d'un temps écoulé, start/pause/reset), pas une logique
// spécifique au lecteur vidéo — éviter d'en dupliquer une copie ici, avec sa
// propre suite de tests déjà couverte par `lib/__tests__/videoPlayer.test.ts`.
import { createFallbackClock, type FallbackClockHandle, type PlayerSource } from "@/lib/videoPlayer";
import { Button } from "@/components/ui/Button";

/**
 * Module d'enregistrement vocal synchronisé (ST 2.1).
 *
 * Capture le micro (`MediaRecorder`) pendant que l'extrait vidéo est en
 * cours de lecture ailleurs dans la page (le composant ne pilote pas
 * lui-même `VideoPlayer` — cf. ST 1.2/1.3 : `currentVideoTime` lui est
 * transmis par le composant parent, comme `time` l'est à `ScriptSynchronise`
 * dans `DevScriptSyncClient`). L'horodatage vidéo au moment du démarrage de
 * l'enregistrement est conservé pour aligner la prévisualisation combinée
 * post-enregistrement (cf. `computeAudioPlaybackDelayMs`).
 *
 * Prévisualisation combinée (résumé de ST 2.1) : entièrement côté client,
 * aucun envoi serveur à ce stade (cf. ST 3.1 pour le mixage/export). Limitée
 * aux sources `UPLOAD` — pour les sources `EMBED`, il n'existe pas d'API de
 * contrôle programmatique fiable cross-origine pour rejouer l'iframe tierce
 * en synchronisation automatique (même constat déjà documenté pour l'horloge
 * de secours de `VideoPlayer`, ST 1.2) ; un message de repli est affiché et
 * seule la voix enregistrée peut être réécoutée isolément.
 *
 * Action « Recommencer » (ST 2.2) : disponible pendant l'enregistrement, sur
 * un résultat déjà produit, ou après une erreur (cf. `canResetRecording`).
 * Elle interrompt une capture en cours sans la sauvegarder, libère le flux
 * micro, écarte le blob précédent (état local et `AudioBlobStore`), et
 * ramène le composant à `idle`. `VoiceRecorder` ne pilote pas `VideoPlayer`
 * (cf. ci-dessus) : la remise à zéro de la vidéo elle-même est déléguée au
 * composant parent via `onRequestVideoReset`.
 */
export interface VoiceRecorderProps {
  /** Position de lecture vidéo courante (secondes), alimentée par `onTimeUpdate` de `VideoPlayer` (ST 1.2) dans le composant parent. */
  currentVideoTime: number;
  /** Source de l'extrait, pour la prévisualisation combinée post-enregistrement. */
  videoSource: PlayerSource;
  videoUrl: string;
  videoTitle: string;
  /** Durée maximale d'enregistrement, en secondes (défaut : 5 min, cf. `DEFAULT_MAX_RECORDING_SECONDS`). */
  maxDurationSeconds?: number;
  /** Identifiant de session pour le stockage temporaire (ST 2.1, tâche 4). */
  recordingId?: string;
  onRecordingComplete?: (result: RecordingResult) => void;
  onError?: (message: string) => void;
  /**
   * Appelé par l'action « Recommencer » (ST 2.2) pour demander au parent de
   * remettre la vidéo à zéro — `VoiceRecorder` ne détient pas de référence
   * vers `VideoPlayer` (`currentVideoTime` circule en lecture seule depuis
   * le parent, cf. doc de ce composant), donc le seek effectif reste de la
   * responsabilité de l'appelant.
   */
  onRequestVideoReset?: () => void;
  style?: CSSProperties;

  // --- Points d'injection pour les tests (mêmes conventions que `VideoPlayer`
  // avec `embedLoadTimeoutMs`, ou `extraitDelegate` pour ST 1.1) : aucune de
  // ces API n'est disponible dans l'environnement de test (jsdom). ---
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
  store?: AudioBlobStore;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  startedAtVideoTimeSeconds: number;
  durationSeconds: number;
}

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-5)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
};

export function VoiceRecorder({
  currentVideoTime,
  videoSource,
  videoUrl,
  videoTitle,
  maxDurationSeconds = DEFAULT_MAX_RECORDING_SECONDS,
  recordingId,
  onRecordingComplete,
  onError,
  onRequestVideoReset,
  style,
  getUserMedia,
  createMediaRecorder,
  isTypeSupported,
  store,
}: VoiceRecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorderLike | null>(null);
  const clockRef = useRef<FallbackClockHandle | null>(null);
  const startedAtVideoTimeRef = useRef(0);
  const elapsedRef = useRef(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingIdRef = useRef<string>(
    recordingId ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `enregistrement-${Date.now()}`)
  );
  const storeRef = useRef<AudioBlobStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = store ?? createDefaultAudioBlobStore();
  }

  // Résolution des dépendances navigateur, injectables en test (cf. doc des props).
  const resolvedIsTypeSupported =
    isTypeSupported ??
    ((mimeType: string) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType));
  const resolvedCreateRecorder =
    createMediaRecorder ??
    ((stream: MediaStream, options?: MediaRecorderOptions) =>
      new MediaRecorder(stream, options) as unknown as MediaRecorderLike);

  // `stopRecording` doit être joignable depuis l'horloge (arrêt automatique à
  // la durée maximale) sans recréer le timer à chaque render — indirection
  // par ref, même pattern que `onTimeUpdateRef` dans `VideoPlayer`.
  const stopRecordingRef = useRef<() => void>(() => {});

  useEffect(() => {
    const clock = createFallbackClock({
      onTick: (t) => {
        elapsedRef.current = t;
        setElapsedSeconds(t);
        if (hasReachedMaxDuration(t, maxDurationSeconds)) {
          stopRecordingRef.current();
        }
      },
      intervalMs: 250,
    });
    clockRef.current = clock;
    return () => clock.pause();
  }, [maxDurationSeconds]);

  // Objet URL du blob enregistré, pour l'élément `<audio>` de prévisualisation
  // — révoqué à chaque changement de résultat ou au démontage pour éviter une
  // fuite mémoire (cf. "Points d'attention" DoD ST 2.1).
  useEffect(() => {
    if (!result) {
      setAudioObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setAudioObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => {
    return () => {
      releaseStream();
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function requestMicrophoneAccess() {
    setStatus("requesting-permission");
    setMessage(null);

    const hasInjectedGetUserMedia = getUserMedia !== undefined;
    if (
      !hasInjectedGetUserMedia &&
      (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    ) {
      const unsupported =
        "Votre navigateur ne permet pas l'enregistrement audio (API microphone indisponible).";
      setMessage(unsupported);
      setStatus("permission-denied");
      onError?.(unsupported);
      return;
    }

    const resolvedGetUserMedia =
      getUserMedia ?? ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));

    try {
      const stream = await resolvedGetUserMedia({ audio: true });
      streamRef.current = stream;
      setStatus("ready");
    } catch (err) {
      const description = describeMicrophoneError(err);
      setMessage(description);
      setStatus("permission-denied");
      onError?.(description);
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickSupportedMimeType(resolvedIsTypeSupported) ?? "";
    const recorder = resolvedCreateRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    // `currentVideoTime` est lu directement depuis les props (fermeture de ce
    // rendu) : `startRecording` est recréée à chaque rendu et attachée telle
    // quelle au bouton, donc toujours à jour au moment du clic — pas besoin
    // d'indirection par ref ici (contrairement à l'horloge ci-dessus, câblée
    // une seule fois dans un effet à portée plus large).
    startedAtVideoTimeRef.current = currentVideoTime;

    startRecordingSession(recorder, currentVideoTime, mimeType, {
      onStop: (blob) => {
        const finalResult: RecordingResult = {
          blob,
          mimeType,
          startedAtVideoTimeSeconds: startedAtVideoTimeRef.current,
          durationSeconds: elapsedRef.current,
        };
        setResult(finalResult);
        setStatus("stopped");
        void storeRef.current?.save(recordingIdRef.current, blob);
        onRecordingComplete?.(finalResult);
      },
      onError: (description) => {
        setMessage(description);
        setStatus("error");
        onError?.(description);
        releaseStream();
      },
    });

    setElapsedSeconds(0);
    elapsedRef.current = 0;
    setStatus("recording");
    clockRef.current?.reset();
    clockRef.current?.start();
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "recording") return;
    clockRef.current?.pause();
    recorderRef.current.stop();
    releaseStream();
  }
  stopRecordingRef.current = stopRecording;

  function playPreview() {
    const audioEl = previewAudioRef.current;
    if (!audioEl || !result) return;

    if (videoSource === "UPLOAD" && previewVideoRef.current) {
      const videoEl = previewVideoRef.current;
      videoEl.currentTime = 0;
      videoEl.muted = true;
      void videoEl.play();
    }

    audioEl.currentTime = 0;
    const delayMs = computeAudioPlaybackDelayMs(result.startedAtVideoTimeSeconds);
    previewTimerRef.current = setTimeout(() => {
      void audioEl.play();
    }, delayMs);
    setPreviewPlaying(true);
  }

  function stopPreview() {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewVideoRef.current?.pause();
    previewAudioRef.current?.pause();
    setPreviewPlaying(false);
  }

  /**
   * Action « Recommencer » (ST 2.2). Voir la doc de `VoiceRecorderProps` et
   * `canResetRecording` pour les états concernés.
   *
   * Ordre volontaire : détacher/arrêter le recorder AVANT `releaseStream()`
   * — un `MediaRecorder` encore actif sur un flux dont les pistes viennent
   * d'être stoppées peut lever selon les navigateurs ; `stopRecordingSilently`
   * gère aussi le cas où `recorderRef.current` est `null` (ex. reset depuis
   * `stopped`, où le recorder de la capture précédente est déjà `inactive`).
   */
  function resetRecording() {
    stopRecordingSilently(recorderRef.current);
    recorderRef.current = null;
    releaseStream();

    clockRef.current?.pause();
    clockRef.current?.reset();

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewPlaying(false);

    elapsedRef.current = 0;
    setElapsedSeconds(0);
    setResult(null);
    setMessage(null);
    setStatus("idle");

    // Écarte le blob précédent du stockage temporaire (cf. ST 2.1, tâche 4) —
    // sans quoi un enregistrement abandonné resterait accessible sous le même
    // `recordingId` après un nouvel essai réussi.
    void storeRef.current?.remove(recordingIdRef.current);

    onRequestVideoReset?.();
  }

  return (
    <div style={{ ...PANEL_STYLE, ...style }} data-testid="voice-recorder">
      {status === "idle" && (
        <Button type="button" icon="mic" onClick={() => void requestMicrophoneAccess()}>
          Activer le micro
        </Button>
      )}

      {status === "requesting-permission" && (
        <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>
          Demande d&apos;accès au microphone…
        </p>
      )}

      {status === "permission-denied" && (
        <div role="alert" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, color: "var(--state-danger)" }}>{message}</p>
          <Button type="button" variant="secondary" icon="mic" onClick={() => void requestMicrophoneAccess()}>
            Réessayer
          </Button>
        </div>
      )}

      {status === "ready" && (
        <Button type="button" icon="mic" onClick={startRecording}>
          Démarrer l&apos;enregistrement
        </Button>
      )}

      {status === "recording" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span
            data-testid="recording-indicator"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-caption)",
              color: "var(--state-rec)",
            }}
          >
            ● Enregistrement en cours — {formatElapsedLabel(elapsedSeconds)} /{" "}
            {formatElapsedLabel(maxDurationSeconds)}
          </span>
          <Button type="button" variant="danger" icon="square" onClick={stopRecording}>
            Arrêter l&apos;enregistrement
          </Button>
        </div>
      )}

      {status === "error" && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
          {message}
        </p>
      )}

      {status === "stopped" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>
            Enregistrement terminé ({formatElapsedLabel(result.durationSeconds)}).
          </p>

          <audio
            ref={previewAudioRef}
            src={audioObjectUrl ?? undefined}
            controls
            data-testid="voice-recorder-audio-only"
          />

          {videoSource === "UPLOAD" ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={previewVideoRef}
                src={videoUrl}
                aria-label={videoTitle}
                muted
                style={{
                  width: "100%",
                  aspectRatio: "16 / 9",
                  background: "var(--surface-stage)",
                  borderRadius: "var(--radius-card)",
                }}
                data-testid="voice-recorder-preview-video"
              />
              <Button
                type="button"
                variant="secondary"
                icon={previewPlaying ? "square" : "play"}
                onClick={previewPlaying ? stopPreview : playPreview}
              >
                {previewPlaying
                  ? "Arrêter la prévisualisation"
                  : "Lire la prévisualisation (vidéo + voix)"}
              </Button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
              Prévisualisation combinée non disponible pour les sources embarquées (pas de contrôle
              de lecture fiable cross-origine, cf. ST 1.2) : écoutez votre voix isolément ci-dessus,
              puis comparez en rejouant l&apos;extrait dans le lecteur principal.
            </p>
          )}
        </div>
      )}

      {canResetRecording(status) && (
        <Button type="button" variant="secondary" icon="rotate-ccw" onClick={resetRecording}>
          Recommencer
        </Button>
      )}
    </div>
  );
}

export default VoiceRecorder;
