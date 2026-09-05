import type { CSSProperties } from "react";

/**
 * Cadre « scène » du design system Doublure : fond nocturne (`--surface-stage`)
 * cerclé d'un trait encre épais, coins `--radius-card`. **Toujours sombre quel
 * que soit le thème du site** — la scène vidéo et le prompteur restent noirs
 * (règle des cartes `guidelines/`).
 *
 * Source unique partagée par `VideoStage`, `Prompter` (ports du design system,
 * ST 11.1) et par les composants métier qui reprennent ce cadre :
 * `src/components/VideoPlayer.tsx` (ST 1.2) et
 * `src/components/ScriptSynchronise.tsx` (ST 1.3).
 */
export const STAGE_FRAME_STYLE: CSSProperties = {
  background: "var(--surface-stage)",
  border: "2px solid var(--ink-950)",
  borderRadius: "var(--radius-card)",
};

/** Variante en cadre + halo rouge pendant une prise (`--glow-rec`). */
export const STAGE_FRAME_RECORDING_STYLE: CSSProperties = {
  ...STAGE_FRAME_STYLE,
  border: "2px solid var(--state-rec)",
  boxShadow: "var(--glow-rec)",
};
