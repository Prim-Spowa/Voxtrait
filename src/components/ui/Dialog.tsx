"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { IconButton } from "./IconButton";

/**
 * Port TypeScript de `components/core/Dialog.jsx` (design system Doublure).
 *
 * Écarts assumés vs la maquette :
 * - `position: fixed` (et non `absolute`) : l'app n'a pas de conteneur de
 *   positionnement dédié ; la maquette vit dans un cadre de démo.
 * - Ajout du motif ARIA complet : `aria-labelledby` sur le titre, fermeture
 *   par Échap, focus porté sur le dialogue à l'ouverture et restitué à
 *   l'élément précédent à la fermeture.
 *
 * Le composant est non monté quand `open` est faux (il ne rend rien).
 */

export interface DialogProps {
  open?: boolean;
  title?: ReactNode;
  children?: ReactNode;
  /** Boutons d'action, alignés à droite sur fond encastré. */
  footer?: ReactNode;
  onClose?: () => void;
  width?: number;
  style?: CSSProperties;
}

export function Dialog({
  open = true,
  title,
  children,
  footer,
  onClose,
  width = 480,
  style,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onClose) {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        background: "var(--surface-overlay)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: width,
          background: "var(--surface-card)",
          border: "var(--border-hard)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-overlay)",
          outline: "none",
          ...style,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-4) var(--space-5)",
            borderBottom: "var(--border-hairline)",
          }}
        >
          <h3 id={titleId} style={{ fontSize: "var(--text-title)" }}>
            {title}
          </h3>
          {onClose ? (
            <IconButton icon="x" label="Fermer" size="sm" variant="ghost" onClick={onClose} />
          ) : null}
        </header>
        <div
          style={{
            padding: "var(--space-5)",
            fontSize: "var(--text-body)",
            color: "var(--text-secondary)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {children}
        </div>
        {footer ? (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-2)",
              padding: "var(--space-4) var(--space-5)",
              borderTop: "var(--border-hairline)",
              background: "var(--surface-sunken)",
              borderRadius: "0 0 var(--radius-lg) var(--radius-lg)",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
