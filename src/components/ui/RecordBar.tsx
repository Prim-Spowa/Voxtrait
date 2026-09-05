"use client";

import type { CSSProperties } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { LevelMeter } from "./LevelMeter";

/**
 * Port TypeScript de `components/media/RecordBar.jsx` (design system Doublure).
 *
 * Barre d'enregistrement sous la scène : gros bouton REC rond (halo rouge
 * pulsé pendant la prise), chrono mono, vumètre, actions de prise. Machine à
 * états `idle → counting → recording → done`.
 *
 * Voir `src/components/VoiceRecorder.tsx` (ST 2.1/2.2) pour la logique réelle
 * de capture (permission micro, MediaRecorder, réinitialisation) : ce
 * composant n'est que la présentation.
 */

const LABEL: Record<RecordBarState, string> = {
  idle: "Prêt",
  counting: "Ça tourne dans…",
  recording: "Enregistrement",
  done: "Prise terminée",
};

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export type RecordBarState = "idle" | "counting" | "recording" | "done";

export interface RecordBarProps {
  state?: RecordBarState;
  /** Temps écoulé de la prise, en secondes. */
  elapsed?: number;
  duration?: number;
  /** Niveau micro 0→1. */
  level?: number;
  /** Valeur du décompte affichée en état `counting`. */
  countdown?: number;
  onRecord?: () => void;
  onStop?: () => void;
  onRetake?: () => void;
  onSave?: () => void;
  style?: CSSProperties;
}

export function RecordBar({
  state = "idle",
  elapsed = 0,
  duration = 72,
  level = 0.5,
  countdown = 3,
  onRecord,
  onStop,
  onRetake,
  onSave,
  style,
}: RecordBarProps) {
  const rec = state === "recording";
  const stopping = rec || state === "counting";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5)",
        minHeight: "var(--recbar-h)",
        padding: "var(--space-3) var(--space-5)",
        background: "var(--surface-inverse)",
        color: "var(--text-inverse)",
        border: "2px solid var(--surface-inverse)",
        borderRadius: "var(--radius-lg)",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={stopping ? onStop : onRecord}
        aria-label={stopping ? "Arrêter l'enregistrement" : "Lancer l'enregistrement"}
        style={{
          width: 56,
          height: 56,
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          background: rec ? "var(--state-rec)" : "var(--white)",
          color: rec ? "var(--white)" : "var(--ink-950)",
          border: "none",
          borderRadius: "var(--radius-pill)",
          cursor: "pointer",
          boxShadow: rec ? "var(--glow-rec)" : "none",
          animation: rec ? "dbl-pulse-rec 1.6s var(--ease-in-out) infinite" : "none",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        <Icon name={stopping ? "square" : "mic"} size={22} strokeWidth={2.5} />
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 148 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            letterSpacing: "var(--tracking-mono-caps)",
            textTransform: "uppercase",
            color: rec ? "var(--state-rec)" : "var(--ink-400)",
          }}
        >
          {state === "counting" ? `${LABEL.counting} ${countdown}` : LABEL[state]}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-subtitle)",
            fontWeight: "var(--weight-bold)",
          }}
        >
          {fmt(elapsed)}
          <span style={{ color: "var(--ink-500)" }}> / {fmt(duration)}</span>
        </span>
      </div>

      <LevelMeter level={level} active={rec} style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {state === "done" ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon="rotate-ccw"
              onClick={onRetake}
              style={{ color: "var(--ink-300)" }}
            >
              Refaire
            </Button>
            <Button variant="primary" size="sm" icon="check" onClick={onSave}>
              Valider la prise
            </Button>
          </>
        ) : (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-micro)",
              color: "var(--ink-500)",
              letterSpacing: "var(--tracking-mono-caps)",
            }}
          >
            espace = rec
          </span>
        )}
      </div>
    </div>
  );
}
