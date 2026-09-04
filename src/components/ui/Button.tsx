"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Port TypeScript de `components/core/Button.jsx` (design system Doublure). */

const SIZES = {
  sm: { padding: "6px 10px", fontSize: "var(--text-body-sm)", icon: 14, gap: "6px" },
  md: { padding: "9px 14px", fontSize: "var(--text-body)", icon: 16, gap: "8px" },
  lg: { padding: "13px 20px", fontSize: "var(--text-subtitle)", icon: 20, gap: "10px" },
} as const;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "inverse";
export type ButtonSize = keyof typeof SIZES;

function skin(variant: ButtonVariant) {
  switch (variant) {
    case "secondary":
      return {
        background: "var(--surface-card)",
        color: "var(--text-primary)",
        border: "var(--border-hard)",
        shadow: "var(--shadow-hard-sm)",
      };
    case "ghost":
      return {
        background: "transparent",
        color: "var(--text-secondary)",
        border: "2px solid transparent",
        shadow: "none",
      };
    case "danger":
      return {
        background: "var(--state-danger)",
        color: "var(--white)",
        border: "var(--border-hard)",
        shadow: "var(--shadow-hard-sm)",
      };
    case "inverse":
      return {
        background: "var(--surface-inverse)",
        color: "var(--text-inverse)",
        border: "2px solid var(--surface-inverse)",
        shadow: "none",
      };
    default:
      return {
        background: "var(--accent-primary)",
        color: "var(--text-on-accent)",
        border: "var(--border-hard)",
        shadow: "var(--shadow-hard-sm)",
      };
  }
}

export interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  /** Libellé accessible quand le bouton n'a pas de texte visible. */
  "aria-label"?: string;
  /** État d'un bouton à bascule (ex. « Rejouer » / panneau de partage, ST 6.2). */
  "aria-pressed"?: boolean;
  /** État d'un bouton dépliant un panneau (ex. « Signaler », ST 7.1). */
  "aria-expanded"?: boolean;
  style?: CSSProperties;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconEnd,
  disabled = false,
  fullWidth = false,
  type = "button",
  onClick,
  style,
  ...rest
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);
  const s = SIZES[size];
  const k = skin(variant);

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        width: fullWidth ? "100%" : "auto",
        padding: s.padding,
        fontSize: s.fontSize,
        fontFamily: "var(--font-ui)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "var(--tracking-tight)",
        background:
          hover && !disabled && variant === "ghost" ? "var(--surface-sunken)" : k.background,
        color: k.color,
        border: k.border,
        borderRadius: "var(--radius-control)",
        boxShadow: pressed ? "none" : k.shadow,
        // Appui : le bouton s'enfonce en diagonale, pas de scale ni de changement
        // de couleur (règle « Appui » du design system).
        transform: pressed
          ? "translate(var(--press-translate), var(--press-translate))"
          : "none",
        filter: hover && !disabled && variant !== "ghost" ? "brightness(1.06)" : "none",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition:
          "transform var(--dur-instant) var(--ease-out), box-shadow var(--dur-instant) var(--ease-out), filter var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={s.icon} /> : null}
    </button>
  );
}
