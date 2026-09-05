"use client";

import type { CSSProperties } from "react";

/**
 * Port TypeScript de `components/media/Prompter.jsx` (design system Doublure).
 *
 * Prompteur karaoké : la réplique courante s'affiche en très grand (Archivo
 * 700, `--text-prompter` = 34 px — règle non négociable du design system) et
 * se remplit mot à mot en vert néon ; la réplique suivante reste en retrait.
 * Fond « scène » toujours sombre quel que soit le thème.
 *
 * Voir aussi `src/components/ScriptSynchronise.tsx` (ST 1.3), qui applique le
 * même habillage sans le remplissage mot à mot : le modèle `ScriptLigne` de
 * ST 1.3 n'a ni champ `character` ni bornes de mot, et la surbrillance
 * progressive relève de l'outil d'enregistrement.
 */

export interface PrompterLine {
  /** Nom du personnage, affiché en mono cyan. */
  character: string;
  text: string;
  /** Bornes en secondes sur la timeline de l'extrait. */
  start: number;
  end: number;
}

export interface PrompterProps {
  lines?: PrompterLine[];
  /** Position de lecture en secondes — pilote le remplissage. */
  time?: number;
  style?: CSSProperties;
}

export function Prompter({ lines = [], time = 0, style }: PrompterProps) {
  const found = lines.findIndex((l) => time >= l.start && time < l.end);
  const idx = Math.max(0, found);
  const current = lines[idx] ?? lines[0];
  const next = lines[idx + 1];
  if (!current) return null;

  const words = current.text.split(" ");
  const progress = Math.max(
    0,
    Math.min(1, (time - current.start) / Math.max(0.2, current.end - current.start))
  );
  const filled = Math.round(progress * words.length);

  return (
    <div
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-5) var(--space-6)",
        background: "var(--surface-stage)",
        borderRadius: "var(--radius-card)",
        border: "2px solid var(--ink-950)",
        minHeight: 168,
        justifyContent: "center",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            letterSpacing: "var(--tracking-mono-caps)",
            textTransform: "uppercase",
            color: "var(--accent-secondary)",
          }}
        >
          {current.character}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            color: "var(--ink-500)",
          }}
        >
          {current.start.toFixed(1)}s → {current.end.toFixed(1)}s
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-ui)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-prompter)",
          lineHeight: 1.15,
          letterSpacing: "var(--tracking-tight)",
          display: "flex",
          flexWrap: "wrap",
          columnGap: "0.28em",
          rowGap: "0.1em",
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              color: i < filled ? "var(--accent-tertiary)" : "var(--ink-300)",
              textShadow:
                i < filled
                  ? "0 0 18px color-mix(in oklab, var(--accent-tertiary) 55%, transparent)"
                  : "none",
              transition: "color var(--dur-instant) linear",
            }}
          >
            {w}
          </span>
        ))}
      </p>
      {next ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-prompter-next)",
            color: "var(--ink-600)",
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-micro)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-mono-caps)",
              marginRight: 8,
            }}
          >
            {next.character}
          </span>
          {next.text}
        </p>
      ) : null}
    </div>
  );
}
