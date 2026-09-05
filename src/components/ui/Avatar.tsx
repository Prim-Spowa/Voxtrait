"use client";

import type { CSSProperties } from "react";

/**
 * Port TypeScript de `components/core/Avatar.jsx` (design system Doublure).
 *
 * Pastille ronde : image `src` si fournie, sinon initiales (1 à 2 lettres) en
 * mono sur fond encre. `ring` = anneau magenta (auteur mis en avant /
 * utilisateur en cours d'enregistrement). Le `name` sert d'infobulle ; quand
 * l'avatar est purement décoratif à côté d'un nom déjà écrit, il est masqué
 * aux lecteurs d'écran (`aria-hidden`).
 */

const SIZES = { xs: 22, sm: 28, md: 36, lg: 56 } as const;

export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps {
  /** Pseudo — infobulle et source des initiales. */
  name?: string;
  /** URL d'image ; à défaut, initiales sur fond encre. */
  src?: string;
  size?: AvatarSize;
  /** Anneau magenta : utilisateur en cours d'enregistrement / auteur mis en avant. */
  ring?: boolean;
  /** Masqué aux lecteurs d'écran quand le nom est déjà visible à côté. */
  "aria-hidden"?: boolean;
  style?: CSSProperties;
}

export function Avatar({ name = "", src, size = "md", ring = false, style, ...rest }: AvatarProps) {
  const d = SIZES[size] ?? SIZES.md;
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span
      {...rest}
      title={name || undefined}
      style={{
        width: d,
        height: d,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: src ? `center/cover no-repeat url(${src})` : "var(--surface-inverse)",
        color: "var(--text-inverse)",
        fontFamily: "var(--font-mono)",
        fontSize: Math.round(d * 0.34),
        fontWeight: "var(--weight-bold)",
        borderRadius: "var(--radius-pill)",
        boxShadow: ring ? "0 0 0 2px var(--accent-primary)" : "none",
        ...style,
      }}
    >
      {src ? "" : initials}
    </span>
  );
}
