"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Port TypeScript de `components/core/Tag.jsx` (design system Doublure).
 *
 * Pastille (`--radius-pill`) : l'un des trois seuls usages autorisés du rayon
 * complet avec les avatars et le bouton REC.
 *
 * Ajout par rapport au design system : `aria-pressed`. Le tag est un bouton
 * bascule ; sans cet attribut l'état sélectionné n'est transmis que par la
 * couleur, ce qui échoue au critère WCAG « information non véhiculée par la
 * seule couleur ».
 */
export interface TagProps {
  children: ReactNode;
  selected?: boolean;
  count?: number;
  onClick?: () => void;
  onRemove?: () => void;
  style?: CSSProperties;
}

export function Tag({ children, selected = false, count, onClick, onRemove, style }: TagProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        background: selected
          ? "var(--surface-inverse)"
          : hover
            ? "var(--surface-sunken)"
            : "var(--surface-card)",
        color: selected ? "var(--text-inverse)" : "var(--text-primary)",
        border: `2px solid ${selected ? "var(--surface-inverse)" : "var(--border-medium)"}`,
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-body-sm)",
        fontWeight: "var(--weight-medium)",
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      {children}
      {count != null ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            color: selected ? "var(--ink-300)" : "var(--text-muted)",
          }}
        >
          {count}
        </span>
      ) : null}
      {onRemove ? <Icon name="x" size={13} /> : null}
    </button>
  );
}
