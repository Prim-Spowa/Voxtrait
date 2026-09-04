"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { VideoPlayer } from "@/components/VideoPlayer";
import { DoublageShareButtons } from "@/components/DoublageShareButtons";
import {
  buildHistoriqueApiUrl,
  type DoublageHistoriqueItem,
  type DoublageHistoriqueResponse,
} from "@/lib/doublageSauvegardeClient";

/**
 * Listing de l'historique des doublages sauvegardés — ST 6.2 « Historique des
 * doublages », découpage en tâches point 2 : « Page frontend listant les
 * doublages avec actions associées (réutilise ST 1.2, ST 3.1, ST 3.2) ».
 *
 * Consomme `GET /api/doublages?utilisateur=me` (paginé). Pour chaque doublage :
 *  - **Rejouer** : lecteur vidéo inline réutilisant `VideoPlayer` (ST 1.2) ;
 *  - **Télécharger** : lien `download` direct vers le fichier généré (ST 3.1) —
 *    aucune re-génération, on pointe l'URL déjà stockée dans la sauvegarde ;
 *  - **Partager** : boutons de partage réutilisant `DoublageShareButtons`
 *    (ST 3.2), avec l'URL du fichier comme lien partagé.
 *
 * Habillage : mêmes conventions que `BibliothequeListing` (design system
 * « Doublure arcade ») — cartes à bordure dure, compteur en `Badge` mono,
 * pagination Précédent / Suivant. Les assertions de test portent sur les
 * rôles/libellés, pas sur les styles inline.
 *
 * Point d'injection pour les tests : `fetchImpl` (défaut `window.fetch`).
 */
export interface DoublageHistoriqueListingProps {
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

/** Date de sauvegarde en français long (« 4 septembre 2026 »). */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type OpenAction = "rejouer" | "partager" | null;

function HistoriqueCard({ item }: { item: DoublageHistoriqueItem }) {
  const [open, setOpen] = useState<OpenAction>(null);
  const titre = item.extraitTitre ?? "Extrait retiré";
  const shareUrl =
    typeof window !== "undefined"
      ? new URL(item.fichierUrl, window.location.origin).toString()
      : item.fichierUrl;

  return (
    <li style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "var(--text-title)" }}>{titre}</h3>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-caption)",
            color: "var(--text-secondary)",
          }}
        >
          Sauvegardé le {formatDate(item.dateCreation)}
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button
          type="button"
          size="sm"
          icon="play"
          variant={open === "rejouer" ? "primary" : "secondary"}
          aria-pressed={open === "rejouer"}
          onClick={() => setOpen((v) => (v === "rejouer" ? null : "rejouer"))}
        >
          Rejouer
        </Button>

        {/* Téléchargement direct du fichier déjà généré (ST 3.1) — pas de
            re-génération. `<a download>` plutôt qu'un Button : c'est une
            navigation vers une ressource. */}
        <a
          href={item.fichierUrl}
          download
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
          <Icon name="download" size={16} />
          Télécharger
        </a>

        <Button
          type="button"
          size="sm"
          icon="share-2"
          variant={open === "partager" ? "primary" : "secondary"}
          aria-pressed={open === "partager"}
          onClick={() => setOpen((v) => (v === "partager" ? null : "partager"))}
        >
          Partager
        </Button>
      </div>

      {open === "rejouer" && (
        <VideoPlayer
          source="UPLOAD"
          url={item.fichierUrl}
          title={`Doublage — ${titre}`}
          poster={item.extraitThumbnail}
        />
      )}

      {open === "partager" && (
        <DoublageShareButtons shareUrl={shareUrl} extraitTitre={item.extraitTitre} />
      )}
    </li>
  );
}

export default function DoublageHistoriqueListing({
  fetchImpl,
}: DoublageHistoriqueListingProps = {}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DoublageHistoriqueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!doFetch) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await doFetch(buildHistoriqueApiUrl({ page }), { signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Erreur ${res.status}`);
        }
        setData((await res.json()) as DoublageHistoriqueResponse);
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
        <h1 style={{ margin: 0, fontSize: "var(--text-display-md)" }}>Mon historique</h1>
        {data ? <Badge>{total} {total > 1 ? "doublages" : "doublage"}</Badge> : null}
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
          Votre historique n&apos;a pas pu être chargé. ({error})
        </p>
      )}

      {isLoading && !data && (
        <p style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: 0, color: "var(--text-secondary)" }}>
          <Icon name="loader" size={16} />
          Chargement de votre historique…
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
          <h2 style={{ margin: 0, fontSize: "var(--text-title)" }}>Aucun doublage sauvegardé</h2>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Vos doublages sauvegardés depuis un extrait apparaîtront ici. Choisissez une scène
            dans la bibliothèque pour commencer.
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
          aria-label="Historique de mes doublages"
          data-testid="historique-list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--gap-grid)",
            opacity: isLoading ? 0.55 : 1,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        >
          {data.items.map((item) => (
            <HistoriqueCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {data && totalPages > 1 && (
        <nav
          aria-label="Pagination de l'historique"
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
