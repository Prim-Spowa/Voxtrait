"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";

/**
 * Port TypeScript de `components/core/Tabs.jsx` (design system Doublure).
 *
 * Écart assumé vs la maquette : ajout de la navigation clavier attendue pour
 * le motif ARIA « tabs » (flèches gauche/droite, Début/Fin) et du `tabIndex`
 * roving (seul l'onglet actif est dans l'ordre de tabulation). Le rendu
 * (soulignement accent de l'onglet actif, capitales, compteur mono) est
 * conservé.
 *
 * `onChange` reçoit la `value` de l'onglet ciblé ; le composant reste
 * contrôlé (aucun état interne de sélection).
 */

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items?: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  style?: CSSProperties;
}

export function Tabs({ items = [], value, onChange, style }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((it) => it.value === value);
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange?.(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        gap: "var(--space-5)",
        borderBottom: "2px solid var(--border-subtle)",
        ...style,
      }}
    >
      {items.map((it, i) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(it.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 0 10px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--text-body-sm)",
              fontWeight: "var(--weight-semibold)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active ? "inset 0 -3px 0 0 var(--accent-primary)" : "none",
              marginBottom: -2,
              transition: "color var(--dur-fast) var(--ease-out)",
            }}
          >
            {it.label}
            {it.count != null ? (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-micro)",
                  color: "var(--text-muted)",
                }}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
