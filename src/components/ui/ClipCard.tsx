"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Badge } from "./Badge";
import type { Origine } from "@/types/extrait";

/**
 * Port TypeScript de `components/media/ClipCard.jsx` (design system Doublure).
 *
 * Écarts assumés par rapport au composant du design system, tous liés au
 * périmètre d'US 1.1 :
 *
 * - **`work`, `duration`, `lines` non rendus.** Le modèle `Extrait` d'US 1.1 ne
 *   porte ni œuvre, ni durée, ni nombre de répliques. Plutôt que d'inventer des
 *   valeurs ou d'afficher des tirets, ces zones sont absentes. Elles seront
 *   réintroduites quand le modèle sera étendu (cf. notes de dev ST 1.1).
 * - **`onSave` (signet) rendu via le slot `actions` (ST 8.1).** La sauvegarde
 *   exigeait un compte (Epic 4), hors périmètre d'US 1.1 — ce n'est plus le
 *   cas depuis ST 4.x. Plutôt que de coupler `ClipCard` à l'API des favoris,
 *   le slot générique `actions` (positionné comme `onSave` dans la maquette :
 *   à droite du titre) laisse l'appelant y rendre un `FavoriButton` (ou toute
 *   autre action future) — `ClipCard` reste sans dépendance à `lib/favoriClient.ts`.
 * - **`href` optionnel.** Ouvrir un extrait est le sujet d'US 1.2. Tant que
 *   `href` n'est pas fourni, la carte est une vignette non interactive : ni
 *   survol actif, ni appel « doubler », pour ne pas promettre une action qui
 *   n'existe pas encore. Fournir `href` suffira à activer le comportement
 *   complet du design system.
 */

const ORIGIN_COLOR: Record<Origine, string> = {
  FR: "var(--origin-fr)",
  US: "var(--origin-us)",
  JP: "var(--origin-jp)",
};

export interface ClipCardProps {
  title: string;
  origin: Origine;
  /** Libellé lisible du type de contenu (Film, Série, Dessin animé). */
  kind: string;
  thumb?: string | null;
  source?: "embed" | "import";
  /** Cible du lien vers la page de l'extrait — US 1.2. */
  href?: string;
  /**
   * Action(s) affichée(s) à droite du titre — même emplacement que le signet
   * `onSave` de la maquette (ST 8.1 : `FavoriButton`). `undefined` par défaut :
   * aucune zone d'action n'est réservée tant que rien n'est fourni.
   */
  actions?: ReactNode;
  style?: CSSProperties;
}

const PLACEHOLDER = "/assets/placeholder-thumb.svg";

export function ClipCard({
  title,
  origin,
  kind,
  thumb,
  source = "embed",
  href,
  actions,
  style,
}: ClipCardProps) {
  const [hover, setHover] = useState(false);
  const interactive = Boolean(href);
  const raised = interactive && hover;

  const media = (
    <div
      style={{
        position: "relative",
        aspectRatio: "16 / 9",
        background: "var(--surface-stage)",
        overflow: "hidden",
      }}
    >
      {/* alt="" volontaire : la vignette est redondante avec le titre affiché
          juste en dessous (image décorative au sens WAI). */}
      <img
        src={thumb || PLACEHOLDER}
        alt=""
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      <span style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 5 }}>
        <Badge tone="neutral" style={{ background: ORIGIN_COLOR[origin], color: "var(--ink-950)" }}>
          {origin}
        </Badge>
        {source === "import" ? (
          <Badge
            tone="neutral"
            style={{
              background: "color-mix(in oklab, var(--ink-950) 78%, transparent)",
              color: "var(--ink-100)",
            }}
          >
            import
          </Badge>
        ) : null}
      </span>
      {interactive ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            opacity: hover ? 1 : 0,
            transition: "opacity var(--dur-fast) var(--ease-out)",
            background: "color-mix(in oklab, var(--ink-950) 35%, transparent)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              background: "var(--accent-primary)",
              color: "var(--text-on-accent)",
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-body-sm)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              borderRadius: "var(--radius-control)",
              boxShadow: "var(--glow-primary)",
            }}
          >
            doubler
          </span>
        </span>
      ) : null}
    </div>
  );

  const body = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "var(--space-3)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-body)",
            letterSpacing: "var(--tracking-tight)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {title}
        </h3>
        {actions ? (
          // `stopPropagation` : quand `href` est fourni, `body` est rendu à
          // l'intérieur du `<a>` de la carte (cf. plus bas) — sans ce garde-fou,
          // cliquer sur une action (ex. `FavoriButton`, ST 8.1) déclencherait
          // aussi la navigation de la carte.
          <span onClick={(e) => e.stopPropagation()}>{actions}</span>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: "var(--text-caption)", color: "var(--text-secondary)" }}>
        {kind}
      </p>
    </div>
  );

  const frame: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-card)",
    // Survol : décalage 2 px haut-gauche + bordure encre + ombre dure.
    border: `2px solid ${raised ? "var(--border-strong)" : "var(--border-subtle)"}`,
    borderRadius: "var(--radius-card)",
    overflow: "hidden",
    boxShadow: raised ? "var(--shadow-hard-sm)" : "none",
    transform: raised ? "translate(-2px, -2px)" : "none",
    transition:
      "transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
    ...style,
  };

  if (!href) {
    return (
      <article style={frame}>
        {media}
        {body}
      </article>
    );
  }

  return (
    <article style={frame}>
      <a
        href={href}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          color: "inherit",
          border: "none",
          textDecoration: "none",
        }}
      >
        {media}
        {body}
      </a>
    </article>
  );
}
