"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button, type ButtonSize } from "@/components/ui/Button";
import { buildFavoriToggleApiUrl } from "@/lib/favoriClient";

/**
 * Bouton favori (bascule ajout/retrait) — ST 8.1 « Marquer une scène en
 * favori », découpage en tâches point 4 : « Bouton favori (état rempli/vide)
 * sur le composant carte d'extrait et sur le lecteur ».
 *
 * Composant autonome (même posture que `SignalerButton`, ST 7.1) : gère lui-même
 * l'appel réseau (`POST`/`DELETE /api/extraits/:id/favori`) et son état,
 * l'appelant n'a qu'à lui fournir l'état initial connu (`initialFavori`) — il
 * n'existe pas d'endpoint pour qu'un bouton isolé « redécouvre » seul s'il est
 * déjà favori (cf. notes de dev ST 8.1).
 *
 * Bascule optimiste : l'icône change immédiatement au clic, puis se rétablit
 * en cas d'échec réseau (erreur affichée sous le bouton).
 *
 * ---
 * **Habillage : design system « Doublure arcade ».**
 *
 * Écart assumé : le design system exprime l'état « favori » d'un signet en le
 * remplissant (icône pleine). La règle globale d'icônes du design system
 * (`components/core/Icon.jsx` : « trait 2 px, jamais rempli ») l'interdit —
 * l'état est donc porté par la variante du bouton (`primary` = favori,
 * `ghost` = non favori) et par `aria-pressed`, pas par le remplissage de
 * l'icône. Même stratégie que `HistoriqueCard` (ST 6.2) pour ses boutons à
 * bascule « Rejouer » / « Partager ».
 */
export interface FavoriButtonProps {
  /** Id de l'extrait favorisé/à favoriser. */
  extraitId: string;
  /**
   * État initial connu par l'appelant (déjà favori ou non). Le composant ne
   * vérifie pas lui-même l'état côté serveur au montage.
   */
  initialFavori: boolean;
  /** Notifié à chaque bascule réussie — permet au parent de tenir sa propre
   * liste de favoris à jour sans re-fetch (cf. `BibliothequeListing`). */
  onChange?: (favori: boolean) => void;
  size?: ButtonSize;
  style?: CSSProperties;
  /** `fetch` injectable — défaut : `window.fetch`. */
  fetchImpl?: typeof fetch;
}

export function FavoriButton({
  extraitId,
  initialFavori,
  onChange,
  size = "sm",
  style,
  fetchImpl,
}: FavoriButtonProps) {
  const [favori, setFavori] = useState(initialFavori);
  const [pending, setPending] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Resynchronise si l'appelant recalcule l'état initial pour cet extrait
  // (ex. nouvelle page de résultats, ou favoris chargés après le premier rendu).
  useEffect(() => {
    setFavori(initialFavori);
  }, [initialFavori, extraitId]);

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

  async function toggle() {
    if (!doFetch || pending) return;

    const next = !favori;
    setErreur(null);
    setFavori(next); // optimiste
    setPending(true);
    try {
      const res = await doFetch(buildFavoriToggleApiUrl(extraitId), {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      onChange?.(next);
    } catch (err) {
      setFavori(!next); // rétablissement
      setErreur(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <Button
        type="button"
        variant={favori ? "primary" : "ghost"}
        size={size}
        icon="bookmark"
        disabled={pending}
        aria-pressed={favori}
        aria-label={favori ? "Retirer des favoris" : "Ajouter aux favoris"}
        onClick={() => void toggle()}
        style={style}
      />
      {erreur ? (
        <span role="alert" style={{ fontSize: "var(--text-micro)", color: "var(--state-danger)" }}>
          {erreur}
        </span>
      ) : null}
    </span>
  );
}

export default FavoriButton;
