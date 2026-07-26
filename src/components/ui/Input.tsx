"use client";

import { useId, useState, type ChangeEvent, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Port TypeScript de `components/core/Input.jsx` (design system Doublure).
 *
 * Écart assumé : le `label` est toujours rendu (jamais remplacé par un simple
 * placeholder) et lié au champ via `htmlFor`. Il peut être masqué visuellement
 * avec `hideLabel`, ce qui préserve l'accessibilité au lecteur d'écran là où la
 * maquette ne montre pas d'étiquette (barre de recherche de la TopBar).
 */
export interface InputProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  type?: "text" | "search" | "email" | "url";
  disabled?: boolean;
  mono?: boolean;
  id?: string;
  style?: CSSProperties;
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  fontWeight: "var(--weight-semibold)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-caps)",
  color: "var(--text-secondary)",
};

export function Input({
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder,
  hint,
  error,
  icon,
  type = "text",
  disabled = false,
  mono = false,
  id,
  style,
}: InputProps) {
  const [focus, setFocus] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  const borderColor = error
    ? "var(--state-danger)"
    : focus
      ? "var(--border-strong)"
      : "var(--border-medium)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      <label htmlFor={inputId} style={hideLabel ? VISUALLY_HIDDEN : LABEL_STYLE}>
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          background: disabled ? "var(--surface-sunken)" : "var(--surface-card)",
          border: `2px solid ${borderColor}`,
          borderRadius: "var(--radius-control)",
          padding: "0 var(--space-3)",
          boxShadow: focus ? "var(--ring-focus)" : "none",
          transition:
            "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        }}
      >
        {icon ? <Icon name={icon} size={16} color="var(--text-muted)" /> : null}
        <input
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={onChange}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? messageId : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "9px 0",
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
            fontSize: "var(--text-body)",
          }}
        />
      </div>
      {hint || error ? (
        <span
          id={messageId}
          style={{
            fontSize: "var(--text-caption)",
            color: error ? "var(--state-danger)" : "var(--text-muted)",
          }}
        >
          {error || hint}
        </span>
      ) : null}
    </div>
  );
}
