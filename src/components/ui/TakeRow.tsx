"use client";

import { useState, type CSSProperties } from "react";
import { Badge } from "./Badge";
import { IconButton } from "./IconButton";

/**
 * Port TypeScript de `components/media/TakeRow.jsx` (design system Doublure).
 *
 * Ligne d'une liste de prises : numéro mono, titre + date/durée, badge
 * « privé » / « non sauvegardé », actions (écouter, télécharger, partager,
 * supprimer) révélées au survol.
 *
 * Écart assumé vs la maquette : les actions restent à `opacity: 0.55` au
 * repos (et non `0`) — les boutons doivent rester perceptibles et atteignables
 * au clavier même sans survol.
 */

export interface TakeRowProps {
  /** Numéro de prise, affiché sur 2 chiffres. */
  index: number;
  title: string;
  duration: string;
  date: string;
  selected?: boolean;
  /** Sauvegardé dans l'espace privé (compte requis). */
  saved?: boolean;
  onPlay?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  style?: CSSProperties;
}

export function TakeRow({
  index,
  title,
  duration,
  date,
  selected = false,
  saved = false,
  onPlay,
  onDownload,
  onShare,
  onDelete,
  style,
}: TakeRowProps) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "34px 1fr auto auto",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-3)",
        background: selected
          ? "var(--accent-secondary-soft)"
          : hover
            ? "var(--surface-sunken)"
            : "var(--surface-card)",
        borderBottom: "var(--border-hairline)",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-caption)",
          color: "var(--text-muted)",
        }}
      >
        {String(index).padStart(2, "0")}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--text-body-sm)",
            fontWeight: "var(--weight-semibold)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-micro)",
            color: "var(--text-muted)",
          }}
        >
          {date} · {duration}
        </span>
      </div>
      {saved ? (
        <Badge tone="success" icon="lock">
          privé
        </Badge>
      ) : (
        <Badge>non sauvegardé</Badge>
      )}
      <div
        style={{
          display: "flex",
          gap: 4,
          opacity: hover ? 1 : 0.55,
          transition: "opacity var(--dur-fast) var(--ease-out)",
        }}
      >
        <IconButton icon="play" label="Écouter la prise" size="sm" variant="ghost" onClick={onPlay} />
        <IconButton
          icon="download"
          label="Télécharger"
          size="sm"
          variant="ghost"
          onClick={onDownload}
        />
        <IconButton icon="share-2" label="Partager" size="sm" variant="ghost" onClick={onShare} />
        <IconButton
          icon="trash-2"
          label="Supprimer"
          size="sm"
          variant="ghost"
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
