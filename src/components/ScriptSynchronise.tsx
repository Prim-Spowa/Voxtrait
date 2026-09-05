"use client";

import type { CSSProperties } from "react";
import { STAGE_FRAME_STYLE } from "@/components/ui/stageSurface";
import { resolveActiveLineIndex } from "@/lib/scriptClient";
import type { ScriptLigneDTO } from "@/types/script";

/**
 * Composant d'affichage du script synchronisé (ST 1.3 "Synchronisation
 * script/dialogue", découpage en tâches, point 2 "Composant d'affichage du
 * script avec surbrillance dynamique" et point 3 "Gestion du cas « pas de
 * script disponible »").
 *
 * Reçoit `lignes` (déjà triées par `timestampDebut`, cf. `GET
 * /api/extraits/:id/script`) et `time` — la position de lecture courante, en
 * secondes, telle que remontée par `onTimeUpdate` de `VideoPlayer` (ST 1.2).
 * Ne fait aucun appel réseau lui-même : c'est la page qui l'intègre qui
 * récupère les lignes (cf. notes de dev — pas de page d'assemblage
 * lecteur+script dans le périmètre de ST 1.3).
 *
 * ---
 * **Habillage.** Reprend les tokens `--text-prompter` / `--text-prompter-next`
 * du design system « Doublure arcade », explicitement dédiés au "script
 * synchronisé façon prompteur" (cf. `styles/tokens/typography.css`) — même
 * esprit que le composant `Prompter` du design system
 * (`Claude output/Design system Doublure arcade/components/media/Prompter.jsx`) :
 * réplique active en très grand, réplique suivante en retrait, sur un fond
 * "scène" toujours sombre quel que soit le thème du site (cf.
 * `--surface-stage`, comme `VideoPlayer`/ST 1.2).
 *
 * Écart assumé par rapport au composant du design system : pas de champ
 * "personnage" (absent du modèle `ScriptLigne` de ST 1.3, cf. notes de dev)
 * et pas de remplissage mot à mot façon karaoké — ST 1.3 demande une
 * "surbrillance" de la ligne active, pas un rendu progressif au mot près
 * (qui relève plutôt de l'outil d'enregistrement, ST 2.1, hors périmètre
 * ici).
 */
export interface ScriptSynchroniseProps {
  lignes: ScriptLigneDTO[];
  /** Position de lecture courante, en secondes. */
  time: number;
  style?: CSSProperties;
}

const STAGE_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-5) var(--space-6)",
  // ST 11.1 : cadre « scène » mutualisé (cf. `components/ui/stageSurface`) —
  // même habillage que `Prompter` du design system.
  ...STAGE_FRAME_STYLE,
  minHeight: 120,
  justifyContent: "center",
};

export function ScriptSynchronise({ lignes, time, style }: ScriptSynchroniseProps) {
  // Cas "pas de script disponible" (US 1.3, second critère d'acceptation) :
  // message informatif, pas une erreur bloquante — `role="status"` (région
  // live non intrusive) plutôt que `role="alert"`.
  if (lignes.length === 0) {
    return (
      <div
        role="status"
        data-testid="script-synchronise-vide"
        style={{
          ...STAGE_STYLE,
          color: "var(--ink-300)",
          fontSize: "var(--text-body)",
          textAlign: "center",
          ...style,
        }}
      >
        Aucun script n&apos;est disponible pour cet extrait.
      </div>
    );
  }

  const activeIndex = resolveActiveLineIndex(lignes, time);
  const active = activeIndex >= 0 ? lignes[activeIndex] : null;
  const next = activeIndex >= 0 ? lignes[activeIndex + 1] : null;

  // Avant la première réplique, ou pendant un silence entre deux répliques :
  // aucune ligne n'est "prononcée à l'écran" au sens du critère d'acceptation
  // US 1.3 — on n'invente pas de surbrillance sur une ligne qui ne correspond
  // pas à l'instant courant, mais on garde le cadre du prompteur visible pour
  // éviter un saut de mise en page à chaque silence.
  if (!active) {
    return (
      <div
        data-testid="script-synchronise"
        style={{ ...STAGE_STYLE, ...style }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-prompter-next)",
            color: "var(--ink-500)",
          }}
        >
          …
        </p>
      </div>
    );
  }

  return (
    <div data-testid="script-synchronise" style={{ ...STAGE_STYLE, ...style }}>
      <p
        data-testid="script-synchronise-ligne-active"
        style={{
          margin: 0,
          fontFamily: "var(--font-ui)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-prompter)",
          lineHeight: 1.15,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--accent-tertiary)",
        }}
      >
        {active.texte}
      </p>
      {next ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-prompter-next)",
            color: "var(--ink-500)",
            lineHeight: 1.3,
          }}
        >
          {next.texte}
        </p>
      ) : null}
    </div>
  );
}

export default ScriptSynchronise;
