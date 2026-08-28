"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import {
  buildShareLinks,
  buildWebSharePayload,
  canUseWebShare,
  isShareAbortError,
  type WebShareNavigator,
} from "@/lib/doublageShareClient";

/**
 * Boutons de partage d'un doublage — ST 3.2, découpage en tâches point 2 :
 * « Intégration Web Share API + fallback boutons de partage par réseau ».
 *
 * - Si la Web Share API native est disponible (mobile en général), un bouton
 *   « Partager » ouvre la feuille de partage système (`navigator.share`).
 * - Dans tous les cas, une rangée de liens d'intent par réseau
 *   (`SHARE_NETWORKS`) est proposée en repli, plus un bouton « Copier le lien ».
 *
 * Points d'injection pour les tests (mêmes conventions que `VoiceRecorder` /
 * `DoublageExport`) : `navigatorImpl`, `clipboardImpl`, `openUrl`.
 */
export interface DoublageShareButtonsProps {
  /** URL publique absolue de la page de partage. */
  shareUrl: string;
  extraitTitre: string | null;
  style?: CSSProperties;
  /** `navigator` injectable (Web Share API). Défaut : `window.navigator`. */
  navigatorImpl?: WebShareNavigator;
  /** Écriture presse-papiers injectable. Défaut : `navigator.clipboard.writeText`. */
  clipboardImpl?: (text: string) => Promise<void>;
  /** Ouverture d'une URL d'intent. Défaut : `window.open(url, "_blank", "noopener")`. */
  openUrl?: (url: string) => void;
}

const ROW_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  alignItems: "center",
};

function defaultOpenUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function DoublageShareButtons({
  shareUrl,
  extraitTitre,
  style,
  navigatorImpl,
  clipboardImpl,
  openUrl,
}: DoublageShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nav =
    navigatorImpl ??
    (typeof navigator !== "undefined" ? (navigator as WebShareNavigator) : undefined);

  const payload = useMemo(
    () => buildWebSharePayload({ extraitTitre, shareUrl }),
    [extraitTitre, shareUrl]
  );
  const links = useMemo(
    () => buildShareLinks({ shareUrl, extraitTitre }),
    [shareUrl, extraitTitre]
  );

  const webShareAvailable = canUseWebShare(nav, payload);
  const open = openUrl ?? defaultOpenUrl;

  const handleWebShare = useCallback(async () => {
    if (!nav?.share) return;
    setError(null);
    try {
      await nav.share(payload);
    } catch (err) {
      if (!isShareAbortError(err)) {
        setError("Le partage n'a pas pu aboutir. Utilisez les boutons ci-dessous.");
      }
    }
  }, [nav, payload]);

  const handleCopy = useCallback(async () => {
    setError(null);
    const write =
      clipboardImpl ??
      (typeof navigator !== "undefined" && navigator.clipboard
        ? (text: string) => navigator.clipboard.writeText(text)
        : undefined);

    if (!write) {
      setError("Copie impossible : copiez le lien manuellement.");
      return;
    }
    try {
      await write(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copie impossible : copiez le lien manuellement.");
    }
  }, [clipboardImpl, shareUrl]);

  return (
    <div
      data-testid="doublage-share-buttons"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", ...style }}
    >
      {webShareAvailable && (
        <Button type="button" icon="share-2" onClick={() => void handleWebShare()}>
          Partager
        </Button>
      )}

      <div style={ROW_STYLE}>
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              // `mailto:` : on laisse le navigateur gérer. Les autres :
              // ouverture contrôlée dans un onglet (`window.open` par défaut,
              // injectable en test).
              if (link.id === "email") return;
              event.preventDefault();
              open(link.url);
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-body-sm)",
              fontWeight: "var(--weight-semibold)",
              padding: "6px 10px",
              border: "var(--border-hard)",
              borderRadius: "var(--radius-control)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            {link.label}
          </a>
        ))}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={copied ? "check" : "link"}
          onClick={() => void handleCopy()}
        >
          {copied ? "Lien copié" : "Copier le lien"}
        </Button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export default DoublageShareButtons;
