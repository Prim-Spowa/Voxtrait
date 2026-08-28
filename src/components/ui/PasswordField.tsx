"use client";

import type { CSSProperties } from "react";

/**
 * Champ mot de passe — extrait de `RegisterForm` (ST 4.1) pour être partagé
 * avec `LoginForm` (ST 4.2).
 *
 * `Input` (`components/ui/Input.tsx`) ne gère volontairement pas
 * `type="password"` (registre de types restreint). Ce composant dédié évite
 * d'élargir le composant partagé : l'étiquette reste liée au champ
 * (`htmlFor`) et l'erreur est annoncée (`role="alert"`).
 */
export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  /** `current-password` (connexion) ou `new-password` (inscription). */
  autoComplete?: "current-password" | "new-password";
  style?: CSSProperties;
}

const LABEL_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  fontWeight: "var(--weight-semibold)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-caps)",
  color: "var(--text-secondary)",
};

export function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  style,
}: PasswordFieldProps) {
  const messageId = `${id}-message`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      <label htmlFor={id} style={LABEL_STYLE}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? messageId : undefined}
        style={{
          padding: "9px var(--space-3)",
          border: `2px solid ${error ? "var(--state-danger)" : "var(--border-medium)"}`,
          borderRadius: "var(--radius-control)",
          background: "var(--surface-card)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-body)",
        }}
      />
      {(hint || error) && (
        <span
          id={messageId}
          role={error ? "alert" : undefined}
          style={{
            fontSize: "var(--text-caption)",
            color: error ? "var(--state-danger)" : "var(--text-muted)",
          }}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}

export default PasswordField;
