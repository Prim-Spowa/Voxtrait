"use client";

import type { CSSProperties, ReactNode } from "react";
import { Tag } from "./Tag";

/**
 * Port TypeScript de `components/nav/SideNav.jsx` (design system Doublure).
 *
 * Colonne de filtres à gauche du catalogue (232 px, `--sidebar-w`, filet
 * 1 px). Chaque groupe est un titre mono + une nuée de `Tag` à bascule.
 *
 * Écarts assumés vs la maquette :
 * - `header` : emplacement optionnel au-dessus des groupes, pour un champ de
 *   recherche (la maquette n'en prévoit pas ; `BibliothequeListing` en a
 *   besoin — un seul champ de recherche par écran).
 * - `groupMode="single"` : dans ce mode, sélectionner un tag d'un groupe
 *   remplace la sélection de ce groupe (radio), au lieu de l'ajouter. Utilisé
 *   par `BibliothequeListing` : l'API `GET /api/extraits` n'accepte qu'une
 *   origine et qu'un type à la fois — des tags multi-sélection promettraient
 *   un filtrage que le serveur ne sait pas exécuter.
 * - `<nav>` étiqueté (`aria-label`) et `<ul>`/`<li>` pour la sémantique de
 *   liste de filtres.
 */

export interface SideNavItem {
  label: string;
  count?: number;
}

export interface SideNavGroup {
  label: string;
  items: SideNavItem[];
}

export interface SideNavProps {
  groups?: SideNavGroup[];
  /** Libellés actuellement actifs. */
  selected?: string[];
  onToggle?: (label: string, group: SideNavGroup) => void;
  /** Contenu rendu au-dessus des groupes (typiquement un champ de recherche). */
  header?: ReactNode;
  /** Étiquette accessible de la colonne. */
  "aria-label"?: string;
  style?: CSSProperties;
}

export function SideNav({
  groups = [],
  selected = [],
  onToggle,
  header,
  style,
  ...rest
}: SideNavProps) {
  return (
    <nav
      aria-label={rest["aria-label"] ?? "Filtres du catalogue"}
      style={{
        width: "var(--sidebar-w)",
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "var(--space-5) var(--space-4)",
        borderRight: "var(--border-hairline)",
        background: "var(--surface-card)",
        ...style,
      }}
    >
      {header}
      {groups.map((group) => (
        <div
          key={group.label}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          <h5
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-micro)",
              fontWeight: "var(--weight-bold)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {group.label}
          </h5>
          <ul
            role="list"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-2)",
            }}
          >
            {group.items.map((item) => (
              <li key={item.label} style={{ display: "flex" }}>
                <Tag
                  count={item.count}
                  selected={selected.includes(item.label)}
                  onClick={() => onToggle?.(item.label, group)}
                >
                  {item.label}
                </Tag>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
