"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_EMBED_LOAD_TIMEOUT_MS,
  createFallbackClock,
  resolvePlayerMode,
  validatePlayerUrl,
  type FallbackClockHandle,
  type PlayerSource,
} from "@/lib/videoPlayer";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Lecteur vidéo unifié (ST 1.2 « Lecteur vidéo (extraits embed et upload) »).
 *
 * Un seul composant, deux modes internes sélectionnés par `source` :
 * - `UPLOAD` → lecteur HTML5 natif (`<video>`), servi depuis le stockage
 *   objet/CDN — évènements de lecture natifs et fiables.
 * - `EMBED` → `<iframe>` vers une plateforme tierce — pas d'API de timing
 *   fiable cross-origine, cf. horloge de secours dans `lib/videoPlayer.ts`.
 *
 * Interface commune aux deux modes (choix technique de ST 1.2) : les mêmes
 * callbacks `onPlay` / `onPause` / `onTimeUpdate` / `onError` sont utilisés
 * quelle que soit la source, pour simplifier l'intégration avec la synchro du
 * script (ST 1.3) et l'enregistrement vocal (ST 2.1).
 */
export interface VideoPlayerProps {
  source: PlayerSource;
  url: string;
  /** Titre de l'extrait — utilisé comme libellé accessible (aria-label / title d'iframe). */
  title: string;
  poster?: string | null;
  /** Délai avant de considérer un embed comme bloqué/indisponible (tests). */
  embedLoadTimeoutMs?: number;
  onPlay?: () => void;
  onPause?: () => void;
  /** Temps de lecture courant, en secondes (réel en mode natif, estimé en mode embed). */
  onTimeUpdate?: (currentTime: number) => void;
  onError?: (message: string) => void;
  style?: CSSProperties;
}

const STAGE_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  background: "var(--surface-stage)",
  border: "2px solid var(--ink-950)",
  borderRadius: "var(--radius-card)",
  overflow: "hidden",
};

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        ...STAGE_STYLE,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        padding: "var(--space-6)",
        textAlign: "center",
        color: "var(--ink-100)",
      }}
    >
      <Icon name="alert-triangle" size={22} color="var(--state-danger)" />
      <p style={{ margin: 0, fontSize: "var(--text-body)" }}>{message}</p>
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function NativePlayer({
  url,
  title,
  poster,
  onPlay,
  onPause,
  onTimeUpdate,
  onError,
}: Pick<VideoPlayerProps, "url" | "title" | "poster" | "onPlay" | "onPause" | "onTimeUpdate" | "onError">) {
  const [failed, setFailed] = useState<string | null>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    if (failed && !reportedRef.current) {
      reportedRef.current = true;
      onError?.(failed);
    }
  }, [failed, onError]);

  if (failed) {
    return <ErrorNotice message={failed} />;
  }

  return (
    <video
      controls
      poster={poster ?? undefined}
      aria-label={title}
      style={{ ...STAGE_STYLE, display: "block", objectFit: "cover" }}
      onPlay={() => onPlay?.()}
      onPause={() => onPause?.()}
      onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
      onError={() =>
        setFailed("La vidéo n'a pas pu être chargée. La source est peut-être indisponible.")
      }
    >
      <source src={url} />
      Votre navigateur ne prend pas en charge la lecture vidéo intégrée.
    </video>
  );
}

function EmbedPlayer({
  url,
  title,
  loadTimeoutMs,
  onPlay,
  onPause,
  onTimeUpdate,
  onError,
}: Pick<VideoPlayerProps, "url" | "title" | "onPlay" | "onPause" | "onTimeUpdate" | "onError"> & {
  loadTimeoutMs: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [manualPlaying, setManualPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const clockRef = useRef<FallbackClockHandle | null>(null);
  const reportedRef = useRef(false);

  // L'horloge de secours n'est créée qu'une fois (montage) mais doit toujours
  // notifier la version la plus récente de `onTimeUpdate` — d'où l'indirection
  // par ref plutôt qu'une dépendance directe dans l'effet de création.
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // Filet de sécurité : certaines plateformes bloquent l'affichage (en-tête
  // `X-Frame-Options`/CSP) sans déclencher d'évènement `error` exploitable.
  // Si ni `onLoad` ni `onError` ne se sont produits avant expiration du
  // délai, on considère l'embed en échec (cf. ST 1.2, "Points d'attention").
  useEffect(() => {
    if (loaded || failed) return;
    const timer = setTimeout(() => {
      setFailed(
        "Le chargement de la source embarquée a expiré. Elle est peut-être bloquée ou indisponible."
      );
    }, loadTimeoutMs);
    return () => clearTimeout(timer);
  }, [loaded, failed, loadTimeoutMs]);

  useEffect(() => {
    const clock = createFallbackClock({
      onTick: (t) => {
        setElapsed(t);
        onTimeUpdateRef.current?.(t);
      },
    });
    clockRef.current = clock;
    return () => clock.pause();
  }, []);

  useEffect(() => {
    if (failed && !reportedRef.current) {
      reportedRef.current = true;
      onError?.(failed);
    }
  }, [failed, onError]);

  if (failed) {
    return <ErrorNotice message={failed} />;
  }

  function toggleManualPlayback() {
    if (manualPlaying) {
      clockRef.current?.pause();
      setManualPlaying(false);
      onPause?.();
    } else {
      clockRef.current?.start();
      setManualPlaying(true);
      onPlay?.();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div style={STAGE_STYLE}>
        <iframe
          src={url}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          onLoad={() => setLoaded(true)}
          onError={() =>
            setFailed("La source embarquée n'a pas pu être chargée (bloquée ou indisponible).")
          }
        />
      </div>

      {/* Horloge de secours (cf. lib/videoPlayer.ts) : les plateformes embarquées
          n'exposant pas d'API de timing fiable, la position de lecture n'est
          disponible qu'en estimation manuelle. Comportement documenté comme
          hypothèse à valider (cf. notes de dev ST 1.2). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={manualPlaying ? "pause" : "play"}
          onClick={toggleManualPlayback}
        >
          {manualPlaying ? "Signaler la pause" : "Signaler le début de la lecture"}
        </Button>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-caption)",
            color: "var(--text-secondary)",
          }}
        >
          {formatTime(elapsed)} (estimation)
        </span>
      </div>
    </div>
  );
}

export function VideoPlayer({
  source,
  url,
  title,
  poster,
  embedLoadTimeoutMs = DEFAULT_EMBED_LOAD_TIMEOUT_MS,
  onPlay,
  onPause,
  onTimeUpdate,
  onError,
  style,
}: VideoPlayerProps) {
  const validationError = validatePlayerUrl(url);
  const reportedInvalidUrlRef = useRef<string | null>(null);

  // `onError` lu via ref : ne doit déclencher un nouveau signalement qu'à un
  // changement effectif d'URL, pas à chaque re-render du parent (qui peut
  // recréer la fonction `onError` inline à chaque passage).
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (validationError && reportedInvalidUrlRef.current !== url) {
      reportedInvalidUrlRef.current = url;
      onErrorRef.current?.(validationError);
    }
  }, [validationError, url]);

  if (validationError) {
    return (
      <div style={style}>
        <ErrorNotice message={validationError} />
      </div>
    );
  }

  const mode = resolvePlayerMode(source);

  return (
    <div style={style}>
      {mode === "native" ? (
        <NativePlayer
          url={url}
          title={title}
          poster={poster}
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
          onError={onError}
        />
      ) : (
        <EmbedPlayer
          url={url}
          title={title}
          loadTimeoutMs={embedLoadTimeoutMs}
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
          onError={onError}
        />
      )}
    </div>
  );
}

export default VideoPlayer;
