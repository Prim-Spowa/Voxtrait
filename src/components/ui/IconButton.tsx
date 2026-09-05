"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Port TypeScript de `components/core/IconButton.jsx` (design system Doublure).
 *
 * Bouton icône seule. Le libellé accessible (`label`) est obligatoire — le
 * design system n'autorise aucun bouton icône muet ; il alimente à la fois
 * `aria-label` et `title` (infobulle native).
 *
 * Écart assumé vs la maquette : le nom d'icône est contraint à `IconName`
 * (registre Lucide de `ui/Icon`) au lieu d'une chaîne libre, pour rester dans
 * le jeu d'icônes validé et faire échouer la compilation sur une icône absente.
 */

const SIZES = {
  sm: { box: 28, glyph: 15 },
  md: { box: 36, glyph: 18 },
  lg: { box: 44, glyph: 22 },
} as const;

export type IconButtonSize = keyof typeof SIZES;
export type IconButtonVariant = "secondary" | "ghost" | "stage";

export interface IconButtonProps {
  icon: IconName;
  /** Libellé accessible — obligatoire, aucun bouton icône muet. */
  label: string;
  size?: IconButtonSize;
  /** `stage` = posé sur la vidéo (verre translucide, sans bordure). */
  variant?: IconButtonVariant;
  active?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** État d'un bouton à bascule (reflète `active` par défaut). */
  "aria-pressed"?: boolean;
  /** État d'un bouton dépliant un panneau. */
  "aria-expanded"?: boolean;
  style?: CSSProperties;
}

export function IconButton({
  icon,
  label,
  size = "md",
  variant = "secondary",
  active = false,
  disabled = false,
  onClick,
  style,
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const s = SIZES[size];
  const onStage = variant === "stage";

  const base = active
    ? "var(--accent-primary)"
    : onStage
      ? "color-mix(in oklab, var(--white) 12%, transparent)"
      : variant === "ghost"
        ? "transparent"
        : "var(--surface-card)";

  const background =
    hover && !active && !disabled
      ? onStage
        ? "color-mix(in oklab, var(--white) 22%, transparent)"
        : "var(--surface-sunken)"
      : base;

  return (
    <button
      {...rest}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: s.box,
        height: s.box,
        flex: "0 0 auto",
        background,
        color: active
          ? "var(--text-on-accent)"
          : onStage
            ? "var(--white)"
            : "var(--text-primary)",
        border: onStage || variant === "ghost" ? "2px solid transparent" : "var(--border-hard)",
        borderRadius: "var(--radius-control)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition:
          "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <Icon name={icon} size={s.glyph} />
    </button>
  );
}
