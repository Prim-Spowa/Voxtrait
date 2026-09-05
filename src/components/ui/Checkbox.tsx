"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Port TypeScript de `components/core/Checkbox.jsx` (design system Doublure).
 *
 * Écart assumé vs la maquette : la maquette pilote une `<span onClick>` sans
 * input réel — non focusable, non cochable au clavier. Ce port encapsule un
 * vrai `<input type="checkbox">` visuellement masqué : focus clavier, barre
 * d'espace, et association `<label>`/`<input>` natives. Le rendu visuel (case
 * 20 px, coche Lucide sur fond accent) est conservé à l'identique.
 */

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: ReactNode;
  /** Ligne secondaire — mentions légères (droits, usage non commercial). */
  hint?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  hint,
  disabled = false,
  style,
}: CheckboxProps) {
  const hintId = useId();
  const labelId = useId();

  return (
    <label
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          flex: "0 0 auto",
          marginTop: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "var(--accent-primary)" : "var(--surface-card)",
          border: "2px solid var(--border-strong)",
          borderRadius: "var(--radius-xs)",
          color: "var(--text-on-accent)",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span id={labelId} style={{ fontSize: "var(--text-body-sm)" }}>
          {label}
        </span>
        {hint ? (
          <span
            id={hintId}
            style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
