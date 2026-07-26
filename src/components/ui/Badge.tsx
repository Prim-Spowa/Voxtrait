"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Port TypeScript de `components/core/Badge.jsx` (design system Doublure). */

const TONES = {
  neutral: { bg: "var(--surface-sunken)", fg: "var(--text-secondary)" },
  primary: { bg: "var(--accent-primary)", fg: "var(--text-on-accent)" },
  info: { bg: "var(--state-info)", fg: "var(--text-on-accent)" },
  success: { bg: "var(--state-success)", fg: "var(--text-on-accent)" },
  warning: { bg: "var(--state-warning)", fg: "var(--text-on-accent)" },
  danger: { bg: "var(--state-danger)", fg: "var(--white)" },
  rec: { bg: "var(--state-rec)", fg: "var(--white)" },
} as const;

export type BadgeTone = keyof typeof TONES;

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
  style?: CSSProperties;
}

export function Badge({ children, tone = "neutral", icon, style }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 7px",
        background: t.bg,
        color: t.fg,
        // Tout ce qui se compte s'écrit en mono (règle « Chiffres »).
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-micro)",
        fontWeight: "var(--weight-bold)",
        textTransform: "uppercase",
        letterSpacing: "var(--tracking-mono-caps)",
        borderRadius: "var(--radius-xs)",
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={11} strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}
