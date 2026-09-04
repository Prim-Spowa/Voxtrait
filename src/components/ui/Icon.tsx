"use client";

import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Link as LinkIcon,
  Loader,
  LogIn,
  LogOut,
  Mic,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Share2,
  Square,
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
  // Ajout assumé pour ST 3.2 (DoublageShareButtons) : `check` (retour visuel
  // « lien copié »), `link` (copier le lien), `share-2` (bouton Web Share).
  check: Check,
  link: LinkIcon,
  "share-2": Share2,
  "chevron-down": ChevronDown,
  // Ajout assumé : `chevron-left`/`chevron-right` ne figurent pas dans le jeu
  // listé par le design system (qui ne prévoit que `arrow-left`), mais la
  // pagination du listing a besoin des deux directions.
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  // Ajout assumé pour ST 3.1 (DoublageExport, bouton « Générer et télécharger
  // le doublage ») : ne figurait pas encore dans le registre.
  download: Download,
  // Ajout assumé pour ST 7.1 (SignalerButton, action « Signaler ») : symbole
  // standard de signalement, présent dans le jeu Lucide du design system.
  flag: Flag,
  loader: Loader,
  "log-in": LogIn,
  // Ajout assumé pour ST 4.2 (LogoutButton) : `log-out`.
  "log-out": LogOut,
  // Ajout assumé pour ST 2.1 (VoiceRecorder, demande de permission micro et
  // contrôle de l'enregistrement) : ni `mic` ni `square` ne figuraient encore
  // dans le registre.
  mic: Mic,
  moon: Moon,
  // Ajout assumé pour ST 1.2 (VideoPlayer, contrôle manuel de l'horloge de
  // secours en mode embed) : ni `play` ni `pause` ne figuraient encore dans
  // le registre, bien que présents dans le jeu Lucide du design system
  // (utilisés par `IconButton` côté maquettes statiques).
  play: Play,
  pause: Pause,
  // Ajout assumé pour ST 2.2 (VoiceRecorder, action « Recommencer » de
  // réinitialisation de l'enregistrement) : ne figurait pas encore dans le
  // registre.
  "rotate-ccw": RotateCcw,
  search: Search,
  // Ajout assumé pour ST 2.1 : symbole standard "stop" pour l'arrêt de
  // l'enregistrement vocal.
  square: Square,
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
