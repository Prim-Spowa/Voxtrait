"use client";

import { useState, type CSSProperties } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ProgressBar } from "./ProgressBar";

/**
 * Port TypeScript de `components/media/UploadDropzone.jsx` (design system
 * Doublure).
 *
 * Zone de dépôt d'un extrait personnel : la contrainte de durée (5 min) et la
 * recompression à l'envoi sont annoncées dès l'état vide. Bordure rouge en cas
 * de refus (`error`).
 *
 * Écart assumé vs la maquette : `onPick` est aussi déclenché au dépôt d'un
 * fichier (`onDrop`) mais la sélection réelle du fichier passe par un
 * `<input type="file">` porté par le composant intégrateur
 * (`src/components/ImportForm.tsx`, ST 5.1/9.5) — ce port reste présentational.
 */

const STATE_ICON: Record<"empty" | "uploading" | "done", IconName> = {
  empty: "upload-cloud",
  uploading: "loader",
  done: "upload-cloud",
};

export interface UploadDropzoneProps {
  state?: "empty" | "uploading" | "done";
  filename?: string;
  /** Progression 0→100 de la compression. */
  progress?: number;
  /** Message de refus (durée, format, poids) — passe la bordure en rouge. */
  error?: string;
  onPick?: () => void;
  style?: CSSProperties;
}

export function UploadDropzone({
  state = "empty",
  filename,
  progress = 0,
  error,
  onPick,
  style,
}: UploadDropzoneProps) {
  const [over, setOver] = useState(false);
  const icon: IconName = error ? "alert-triangle" : STATE_ICON[state];

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onPick?.();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-10) var(--space-6)",
        textAlign: "center",
        background: over ? "var(--accent-secondary-soft)" : "var(--surface-card)",
        border: `2px dashed ${
          error
            ? "var(--state-danger)"
            : over
              ? "var(--accent-secondary)"
              : "var(--border-medium)"
        }`,
        borderRadius: "var(--radius-lg)",
        transition:
          "background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <Icon
        name={icon}
        size={30}
        color={error ? "var(--state-danger)" : "var(--text-secondary)"}
      />
      {state === "uploading" && !error ? (
        <div
          style={{
            width: "100%",
            maxWidth: 320,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-caption)" }}>
            {filename}
          </span>
          <ProgressBar value={progress} label="Compression" />
        </div>
      ) : (
        <>
          <h4 style={{ fontSize: "var(--text-subtitle)" }}>
            {error ? "Import refusé" : "Déposez votre extrait"}
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-body-sm)",
              color: error ? "var(--state-danger)" : "var(--text-secondary)",
              maxWidth: 380,
            }}
          >
            {error ||
              "MP4 ou MOV, vidéo et son, 5 minutes maximum. Le fichier est recompressé à l'envoi."}
          </p>
          <Button variant="secondary" icon="folder-open" onClick={onPick}>
            Choisir un fichier
          </Button>
        </>
      )}
    </div>
  );
}
