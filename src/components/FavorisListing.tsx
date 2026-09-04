"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ClipCard } from "@/components/ui/ClipCard";
import { FavoriButton } from "@/components/FavoriButton";
import { Icon } from "@/components/ui/Icon";
import {
  buildFavorisApiUrl,
  type FavoriItem,
  type FavorisResponse,
} from "@/lib/favoriClient";
import { TYPE_LABELS, type Origine, type TypeContenu } from "@/types/extrait";

/**
 * Listing des extraits favoris — ST 8.1 « Marquer une scène en favori »,
 * découpage en tâches point 5 : « Page `/mon-espace/favoris` réutilisant le
 * composant de listing de la bibliothèque (ST 1.1) ».
 *
 * Consomme `GET /api/favoris` (paginé). Réutilise directement `ClipCard`
 * (ST 1.1) pour chaque favori — même carte, même habillage que la
 * bibliothèque — avec un `FavoriButton` toujours à l'état « favori » : le
 * retirer ici fait disparaître l'entrée de la liste (retrait optimiste, sans
 * re-fetch de la page).
 *
 * **Extrait retiré (point d'attention ST 8.1).** Si l'extrait favorisé a été
 * retiré depuis (modération ST 7.2 ou notice-and-takedown ST 7.3),
 * `extraitStatut` (renvoyé par l'API) diffère de `VALIDE` : la carte reste
 * affichée (titre/vignette encore connus) mais porte un badge « Contenu
 * retiré » — décision prise pour ce point d'attention laissé ouvert par la
 * story (cf. `src/lib/favori.ts`, tête de fichier). Si l'extrait est
 * introuvable (`extraitTitre` `null` — suppression complète), une carte de
 * repli minimale remplace `ClipCard` (même stratégie que `HistoriqueCard`,
 * ST 6.2, pour un doublage dont l'extrait a disparu).
 *
 * Point d'injection pour les tests (même convention que
 * `DoublageHistoriqueListing`) : `fetchImpl`.
 */
export interface FavorisListingProps {
  /** `fetch` injectable (indisponible / à mocker en test). */
  fetchImpl?: typeof fetch;
}

const CARD_STYLE = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  boxShadow: "var(--shadow-hard-sm)",
  borderRadius: "var(--radius-card)",
};

/** `true` si l'extrait n'est plus au statut public (`VALIDE`). */
function estRetire(statut: string | null): boolean {
  return statut !== null && statut !== "VALIDE";
}

function FavoriCard({
  item,
  onRetire,
  fetchImpl,
}: {
  item: FavoriItem;
  onRetire: (extraitId: string) => void;
  /** Propagé au `FavoriButton` (mutation de bascule) — même `fetch` injecté
   * que celui qui a chargé la page (cf. `FavorisListingProps.fetchImpl`). */
  fetchImpl?: typeof fetch;
}) {
  // Extrait introuvable (supprimé) : pas assez de données pour un `ClipCard`
  // (origine/type manquants) — carte de repli minimale, même stratégie que
  // `HistoriqueCard` (ST 6.2) pour un doublage dont l'extrait a disparu.
  if (!item.extraitTitre || !item.extraitOrigine || !item.extraitType) {
    return (
      <li style={CARD_STYLE}>
        <h3 style={{ margin: 0, fontSize: "var(--text-title)" }}>Extrait introuvable</h3>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body-sm)" }}>
          Cet extrait a été supprimé de la bibliothèque.
        </p>
        <FavoriButton
          extraitId={item.extraitId}
          initialFavori
          fetchImpl={fetchImpl}
          onChange={(favori) => {
            if (!favori) onRetire(item.extraitId);
          }}
        />
      </li>
    );
  }

  return (
    <li style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {estRetire(item.extraitStatut) ? (
        <Badge tone="warning">Contenu retiré</Badge>
      ) : null}
      <ClipCard
        title={item.extraitTitre}
        origin={item.extraitOrigine as Origine}
        kind={TYPE_LABELS[item.extraitType as TypeContenu] ?? item.extraitType}
        thumb={item.extraitThumbnail}
        source={item.extraitSource === "UPLOAD" ? "import" : "embed"}
        actions={
          <FavoriButton
            extraitId={item.extraitId}
            initialFavori
            fetchImpl={fetchImpl}
            onChange={(favori) => {
              if (!favori) onRetire(item.extraitId);
            }}
          />
        }
      />
    </li>
  );
}

export default function FavorisListing({ fetchImpl }: FavorisListingProps = {}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FavorisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!doFetch) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await doFetch(buildFavorisApiUrl({ page }), { signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Erreur ${res.status}`);
        }
        setData((await res.json()) as FavorisResponse);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        setIsLoading(false);
      }
    },
    [doFetch, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Retrait optimiste : un favori retiré depuis sa propre carte disparaît
  // immédiatement de la liste affichée, sans re-fetch de la page (même geste
  // que `HistoriqueCard` n'en a pas besoin : ici on modifie `data.items`
  // directement, le total du badge suit).
  function handleRetire(extraitId: string) {
    setData((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((item) => item.extraitId !== extraitId);
      return {
        items,
        pagination: { ...prev.pagination, total: Math.max(0, prev.pagination.total - 1) },
      };
    });
  }

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <main
      style={{
        flex: 1,
        width: "100%",
        maxWidth: "var(--page-max)",
        margin: "0 auto",
        padding: "var(--space-6) var(--gutter-page) var(--space-10)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-display-md)" }}>Mes favoris</h1>
        {data ? <Badge>{total} {total > 1 ? "favoris" : "favori"}</Badge> : null}
      </header>

      {error && (
        <p
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            margin: 0,
            padding: "var(--space-3) var(--space-4)",
            background: "var(--surface-card)",
            border: "2px solid var(--state-danger)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-primary)",
          }}
        >
          <Icon name="alert-triangle" size={16} color="var(--state-danger)" />
          Vos favoris n&apos;ont pas pu être chargés. ({error})
        </p>
      )}

      {isLoading && !data && (
        <p style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: 0, color: "var(--text-secondary)" }}>
          <Icon name="loader" size={16} />
          Chargement de vos favoris…
        </p>
      )}

      {data && data.items.length === 0 && !isLoading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "var(--space-3)",
            padding: "var(--space-10) var(--space-6)",
            background: "var(--surface-card)",
            border: "var(--border-hard)",
            boxShadow: "var(--shadow-hard-sm)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--text-title)" }}>Aucun favori pour le moment</h2>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Marquez une scène en favori depuis la bibliothèque pour la retrouver ici.
          </p>
          <a
            href="/bibliotheque"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
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
            Parcourir la bibliothèque
          </a>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul
          role="list"
          aria-label="Mes extraits favoris"
          data-testid="favoris-grid"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
            gap: "var(--gap-grid)",
            opacity: isLoading ? 0.55 : 1,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        >
          {data.items.map((item) => (
            <FavoriCard key={item.id} item={item} onRetire={handleRetire} fetchImpl={doFetch} />
          ))}
        </ul>
      )}

      {data && totalPages > 1 && (
        <nav
          aria-label="Pagination des favoris"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", paddingTop: "var(--space-2)" }}
        >
          <Button
            variant="secondary"
            size="sm"
            icon="chevron-left"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Précédent
          </Button>
          <span
            aria-live="polite"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-body-sm)",
              color: "var(--text-secondary)",
            }}
          >
            Page {data.pagination.page} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            iconEnd="chevron-right"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Suivant
          </Button>
        </nav>
      )}
    </main>
  );
}
