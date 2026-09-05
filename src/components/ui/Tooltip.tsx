"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Port TypeScript de `components/core/Tooltip.jsx` (design system Doublure).
 *
 * Écart assumé vs la maquette : l'infobulle apparaît aussi au focus clavier
 * (`focus`/`blur`), pas seulement au survol, et l'enfant est décrit via
 * `aria-describedby`. Style mono/capitales sur fond inversé conservé.
 *
 * Le tooltip ne remplace jamais un libellé accessible : l'enfant doit rester
 * nommé par lui-même.
 */

export interface TooltipProps {
  label: string;
  children?: ReactNode;
  placement?: "top" | "bottom";
  style?: CSSProperties;
}

export function Tooltip({ label, children, placement = "top", style }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const pos: CSSProperties =
    placement === "bottom"
      ? { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
      : { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };

  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={id}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        style={{
          position: "absolute",
          ...pos,
          zIndex: 30,
          whiteSpace: "nowrap",
          padding: "4px 8px",
          background: "var(--surface-inverse)",
          color: "var(--text-inverse)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-micro)",
          letterSpacing: "var(--tracking-mono-caps)",
          borderRadius: "var(--radius-xs)",
          pointerEvents: "none",
        }}
      >
        {label}
      </span>
    </span>
  );
}
