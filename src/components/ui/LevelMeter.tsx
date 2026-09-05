"use client";

import type { CSSProperties } from "react";

/**
 * Port TypeScript de `components/media/LevelMeter.jsx` (design system Doublure).
 *
 * Vumètre décoratif : barres animées pendant une prise (`active`), au repos
 * sinon. Au-delà de 0,82 les barres passent en ambre (saturation micro).
 * `aria-hidden` : c'est un indicateur visuel, le retour audible/chiffré est
 * porté ailleurs (chrono, message d'état de `RecordBar`).
 */

export interface LevelMeterProps {
  /** Niveau moyen 0→1. */
  level?: number;
  /** Anime les barres — à activer uniquement pendant une prise. */
  active?: boolean;
  bars?: number;
  style?: CSSProperties;
}

export function LevelMeter({ level = 0.5, active = false, bars = 28, style }: LevelMeterProps) {
  return (
    <div
      aria-hidden="true"
      style={{ display: "flex", alignItems: "center", gap: 3, height: 34, ...style }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin((i / bars) * Math.PI * 2.4));
        const h = Math.max(0.12, level * wave);
        const hot = h > 0.82;
        return (
          <span
            key={i}
            style={{
              flex: 1,
              height: Math.round(h * 34),
              background: active
                ? hot
                  ? "var(--state-warning)"
                  : "var(--accent-tertiary)"
                : "color-mix(in oklab, var(--white) 18%, transparent)",
              borderRadius: 1,
              transformOrigin: "center",
              animation: active
                ? `dbl-level ${600 + (i % 5) * 90}ms var(--ease-in-out) infinite`
                : "none",
            }}
          />
        );
      })}
    </div>
  );
}
