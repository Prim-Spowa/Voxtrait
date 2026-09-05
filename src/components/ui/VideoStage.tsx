"use client";

import type { CSSProperties, ReactNode } from "react";
import { Badge } from "./Badge";
import { IconButton } from "./IconButton";

/**
 * Port TypeScript de `components/media/VideoStage.jsx` (design system Doublure).
 *
 * Scène vidéo 16/9, **toujours sur fond noir quel que soit le thème**
 * (`--surface-stage`). Passe en cadre + halo rouge (`--glow-rec`) pendant
 * l'enregistrement. Barre de contrôles maquette (lecture, timecode mono,
 * barre de progression cliquable, volume, plein écran).
 *
 * Ce composant est une **scène de présentation** : les contrôles pilotent des
 * callbacks (`onTogglePlay`, `onSeek`) et n'encapsulent pas d'élément
 * `<video>` réel. Pour un lecteur réel (upload natif / iframe embed), voir
 * `src/components/VideoPlayer.tsx`, qui reprend déjà ce cadre.
 */

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface VideoStageProps {
  /** URL d'affiche ; à défaut, fond scène + libellé mono. */
  poster?: string;
  label?: string;
  /** Position de lecture en secondes. */
  time?: number;
  duration?: number;
  playing?: boolean;
  recording?: boolean;
  onTogglePlay?: () => void;
  onSeek?: (seconds: number) => void;
  /** Superpositions : compte à rebours, prompteur, filigrane. */
  children?: ReactNode;
  style?: CSSProperties;
}

export function VideoStage({
  poster,
  label = "extrait vidéo",
  time = 0,
  duration = 72,
  playing = false,
  recording = false,
  onTogglePlay,
  onSeek,
  children,
  style,
}: VideoStageProps) {
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div
      style={{
        position: "relative",
        background: "var(--surface-stage)",
        border: recording ? "2px solid var(--state-rec)" : "2px solid var(--ink-950)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        boxShadow: recording ? "var(--glow-rec)" : "none",
        transition: "box-shadow var(--dur-base) var(--ease-out)",
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          display: "grid",
          placeItems: "center",
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-caption)",
              letterSpacing: "var(--tracking-mono-caps)",
              textTransform: "uppercase",
              color: "var(--ink-400)",
            }}
          >
            {label}
          </span>
        )}
        {recording ? (
          <span style={{ position: "absolute", top: "var(--space-3)", left: "var(--space-3)" }}>
            <Badge tone="rec" icon="circle">
              rec
            </Badge>
          </span>
        ) : null}
        {children}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3)",
          background: "color-mix(in oklab, var(--ink-950) 92%, transparent)",
        }}
      >
        <IconButton
          icon={playing ? "pause" : "play"}
          label={playing ? "Pause" : "Lire"}
          variant="stage"
          onClick={onTogglePlay}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-caption)",
            color: "var(--ink-300)",
          }}
        >
          {fmt(time)} / {fmt(duration)}
        </span>
        <div
          role="slider"
          aria-label="Position de lecture"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onClick={(e) => {
            if (!onSeek) return;
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(((e.clientX - r.left) / r.width) * duration);
          }}
          onKeyDown={(e) => {
            if (!onSeek) return;
            if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 5));
            else if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 5));
          }}
          style={{
            flex: 1,
            height: 6,
            background: "color-mix(in oklab, var(--white) 14%, transparent)",
            borderRadius: "var(--radius-pill)",
            cursor: "pointer",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: recording ? "var(--state-rec)" : "var(--accent-secondary)",
              borderRadius: "var(--radius-pill)",
            }}
          />
        </div>
        <IconButton icon="volume-2" label="Volume de l'extrait" variant="stage" size="sm" />
        <IconButton icon="maximize" label="Plein écran" variant="stage" size="sm" />
      </div>
    </div>
  );
}
