"use client";

import type { CSSProperties } from "react";

/**
 * Port TypeScript de `components/core/Switch.jsx` (design system Doublure).
 *
 * Écart assumé vs la maquette : la maquette pilote une `<span onClick>` sans
 * contrôle réel. Ce port utilise `<button role="switch" aria-checked>` :
 * focusable, actionnable au clavier (Entrée / Espace), état exposé aux
 * technologies d'assistance. Piste 40×22, pastille 14 px translatée — rendu
 * identique.
 */

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Switch({ checked = false, onChange, label, disabled = false, style }: SwitchProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 40,
          height: 22,
          padding: 2,
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          background: checked ? "var(--accent-secondary)" : "var(--surface-sunken)",
          border: "2px solid var(--border-strong)",
          borderRadius: "var(--radius-pill)",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: "var(--radius-pill)",
            background: "var(--ink-950)",
            transform: checked ? "translateX(18px)" : "translateX(0)",
            transition: "transform var(--dur-fast) var(--ease-out)",
          }}
        />
      </button>
      {label ? <span style={{ fontSize: "var(--text-body-sm)" }}>{label}</span> : null}
    </label>
  );
}
