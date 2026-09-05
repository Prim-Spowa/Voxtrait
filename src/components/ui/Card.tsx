"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Port TypeScript de `components/core/Card.jsx` (design system Doublure).
 *
 * Conteneur de surface :
 * - `flat` (défaut) — filet 1 px, densité catalogue ;
 * - `raised` — bordure 2 px encre + ombre dure décalée (bloc mis en avant) ;
 * - `inverse` — fond encre, texte clair.
 *
 * `padding` est une chaîne CSS (souvent un token `--space-*`) ; `as` permet de
 * rendre un `<section>`, `<article>`, `<li>`… plutôt qu'un `<div>`.
 */

export type CardVariant = "flat" | "raised" | "inverse";

export interface CardProps {
  children?: ReactNode;
  variant?: CardVariant;
  padding?: string;
  as?: ElementType;
  id?: string;
  "data-testid"?: string;
  style?: CSSProperties;
}

export function Card({
  children,
  variant = "flat",
  padding = "var(--space-4)",
  as,
  style,
  ...rest
}: CardProps) {
  const El = as ?? "div";
  const raised = variant === "raised";
  const inverse = variant === "inverse";

  return (
    <El
      {...rest}
      style={{
        background: inverse ? "var(--surface-inverse)" : "var(--surface-card)",
        color: inverse ? "var(--text-inverse)" : "var(--text-primary)",
        border: raised || inverse ? "var(--border-hard)" : "var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        boxShadow: raised ? "var(--shadow-hard)" : "none",
        padding,
        ...style,
      }}
    >
      {children}
    </El>
  );
}
