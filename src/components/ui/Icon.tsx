"use client";

import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader,
  LogIn,
  Moon,
  Search,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Enveloppe Lucide — pendant TypeScript de `components/core/Icon.jsx` du design
 * system « Doublure arcade ».
 *
 * Le design system utilise le CDN `unpkg.com/lucide` + `window.lucide` (adapté à
 * des maquettes HTML statiques). En production on passe par `lucide-react` :
 * pas de dépendance à un CDN externe, tree-shaking, et rendu synchrone donc
 * testable en jsdom.
 *
 * Règles du design system respectées : trait 2 px, jamais rempli, toujours
 * `currentColor`, `aria-hidden` (l'icône n'est jamais porteuse de sens seule).
 *
 * Le registre ne contient que les icônes réellement rendues aujourd'hui.
 * Ajouter une icône est un geste conscient — c'est ce qui garantit qu'on reste
 * dans le jeu Lucide listé par le design system, et que le bundle ne grossit
 * pas silencieusement.
 */
const REGISTRY = {
  "alert-triangle": AlertTriangle,
  "chevron-down": ChevronDown,
  // Ajout assumé : `chevron-left`/`chevron-right` ne figurent pas dans le jeu
  // listé par le design system (qui ne prévoit que `arrow-left`), mais la
  // pagination du listing a besoin des deux directions.
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  loader: Loader,
  "log-in": LogIn,
  moon: Moon,
  search: Search,
  sun: Sun,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  color = "currentColor",
  style,
}: IconProps) {
  const Glyph = REGISTRY[name];
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        color,
        flex: "0 0 auto",
        ...style,
      }}
    >
      <Glyph size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
