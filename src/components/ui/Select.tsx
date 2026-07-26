"use client";

import { useId, type ChangeEvent, type CSSProperties } from "react";
import { Icon } from "./Icon";

/** Port TypeScript de `components/core/Select.jsx` (design system Doublure). */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: SelectOption[];
  label: string;
  id?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Select({
  value,
  onChange,
  options,
  label,
  id,
  disabled = false,
  style,
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      <label
        htmlFor={selectId}
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--weight-semibold)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <select
          id={selectId}
          value={value}
          onChange={onChange}
          disabled={disabled}
          style={{
            appearance: "none",
            width: "100%",
            padding: "9px 36px 9px var(--space-3)",
            background: disabled ? "var(--surface-sunken)" : "var(--surface-card)",
            border: "2px solid var(--border-medium)",
            borderRadius: "var(--radius-control)",
            fontSize: "var(--text-body)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size={16}
          color="var(--text-secondary)"
          style={{ position: "absolute", right: "var(--space-3)", pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
