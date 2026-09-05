"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Bascule de thème « clair » / « mode scène » (sombre) du design system
 * Doublure.
 *
 * Source de vérité : l'attribut `data-theme` sur `<html>` (lu par les tokens
 * de `src/styles/tokens/colors.css`). La préférence est persistée dans
 * `localStorage` sous la clé `doublure:theme` pour être restaurée à la visite
 * suivante ; à défaut de préférence enregistrée, on suit `prefers-color-scheme`.
 *
 * ST 11.1 : avant cette story, `TopBar` posait `data-theme` mais sans
 * persistance ni partage entre écrans. Ce hook centralise les deux.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "doublure:theme";

/** Thème initial : préférence enregistrée, sinon préférence système, sinon clair. */
export function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage indisponible (mode privé, cookies bloqués) : on ignore.
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export interface UseThemeResult {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

export function useTheme(): UseThemeResult {
  // Rendu initial serveur/hydratation : toujours « light » (valeur du DOM
  // rendu côté serveur) pour éviter une divergence d'hydratation ; l'effet
  // ci-dessous réaligne immédiatement sur la préférence réelle.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const initial = readInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistance best-effort.
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, isDark: theme === "dark", toggle, setTheme };
}
