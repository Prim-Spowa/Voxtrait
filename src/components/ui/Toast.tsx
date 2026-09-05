"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";

/**
 * Port TypeScript de `components/core/Toast.jsx` (design system Doublure).
 *
 * Notification brève sur fond inversé, liseré coloré à gauche selon le ton.
 * `role="status"` (annonce polie) ; pour une erreur bloquante, préférer un
 * message inline associé au champ.
 */

const TONES: Record<"success" | "danger" | "info", { icon: IconName; color: string }> = {
  success: { icon: "check-circle-2", color: "var(--state-success)" },
  danger: { icon: "alert-triangle", color: "var(--state-danger)" },
  info: { icon: "info", color: "var(--state-info)" },
};

export type ToastTone = keyof typeof TONES;

export interface ToastProps {
  children?: ReactNode;
  tone?: ToastTone;
  onClose?: () => void;
  style?: CSSProperties;
}

export function Toast({ children, tone = "success", onClose, style }: ToastProps) {
  const t = TONES[tone] ?? TONES.info;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--surface-inverse)",
        color: "var(--text-inverse)",
        border: "2px solid var(--surface-inverse)",
        borderLeft: `4px solid ${t.color}`,
        borderRadius: "var(--radius-control)",
        boxShadow: "var(--shadow-overlay)",
        fontSize: "var(--text-body-sm)",
        ...style,
      }}
    >
      <Icon name={t.icon} size={17} color={t.color} />
      <span style={{ flex: 1 }}>{children}</span>
      {onClose ? (
        <IconButton icon="x" label="Fermer" size="sm" variant="stage" onClick={onClose} />
      ) : null}
    </div>
  );
}
