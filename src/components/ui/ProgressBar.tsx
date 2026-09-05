"use client";

import type { CSSProperties } from "react";

/**
 * Port TypeScript de `components/core/ProgressBar.jsx` (design system Doublure).
 *
 * Écart assumé vs la maquette : ajout des attributs `role="progressbar"` /
 * `aria-valuenow|min|max` et de `aria-label` (repli sur `label`). Piste
 * encastrée, remplissage accent selon le ton, libellé mono optionnel avec
 * pourcentage à droite — rendu conservé.
 */

export interface ProgressBarProps {
  value?: number;
  max?: number;
  tone?: "primary" | "secondary" | "rec";
  height?: number;
  /** Libellé mono au-dessus, avec pourcentage à droite. Sert aussi de nom accessible. */
  label?: string;
  /** Nom accessible explicite si `label` n'est pas affiché. */
  "aria-label"?: string;
  style?: CSSProperties;
}

export function ProgressBar({
  value = 0,
  max = 100,
  tone = "primary",
  height = 6,
  label,
  style,
  ...rest
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    tone === "rec"
      ? "var(--state-rec)"
      : tone === "secondary"
        ? "var(--accent-secondary)"
        : "var(--accent-primary)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      {label ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            color: "var(--text-secondary)",
            letterSpacing: "var(--tracking-mono-caps)",
          }}
        >
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={rest["aria-label"] ?? label}
        style={{
          height,
          background: "var(--surface-sunken)",
          borderRadius: "var(--radius-pill)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width var(--dur-base) var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}
