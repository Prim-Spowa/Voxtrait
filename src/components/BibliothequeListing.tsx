"use client";

import { useEffect, useState, type ReactNode } from "react";
import { buildExtraitsApiUrl } from "@/lib/extraitsClient";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ClipCard } from "@/components/ui/ClipCard";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Tag } from "@/components/ui/Tag";
import {
  ExtraitsResponse,
  ORIGINE_LABELS,
  Origine,
  TYPE_LABELS,
  TypeContenu,
} from "@/types/extrait";

/**
 * Composant de listing de la bibliothèque d'extraits (ST 1.1, tâche
 * "Construire le composant de listing (grille + filtres) côté frontend").
 *
 * Grille de vignettes + filtres origine/type + recherche texte + pagination.
 * Consomme `GET /api/extraits`.
 *
 * ---
 * **Habillage : design system « Doublure arcade ».**
 *
 * Écart assumé sur les filtres : le design system présente les filtres du
 * catalogue comme des `Tag` à bascule (multi-sélection) dans la `SideNav`.
 * L'API d'US 1.1 n'accepte qu'une seule origine et un seul type à la fois ; des
 * tags multi-sélection promettraient un filtrage que le serveur ne sait pas
 * exécuter. On garde donc des `Select` (choix unique, sémantique correcte,
 * clavier natif) dans la colonne de 232 px du design system, et les filtres
 * actifs sont rappelés en `Tag` supprimables au-dessus de la grille. À revoir si
 * le filtrage multiple entre au périmètre.
 */
export interface BibliothequeListingProps {
  /**
   * Contenu éditorial rendu en tête de la colonne de résultats (encart d'appel).
   * Injecté par la page plutôt que codé ici : la mise en page du design system
   * place la colonne de filtres à gauche sur toute la hauteur, donc l'encart
   * doit vivre dans le `<main>` de ce composant, mais son texte relève de la
   * page.
   */
  hero?: ReactNode;
}

export default function BibliothequeListing({ hero }: BibliothequeListingProps = {}) {
  const [origine, setOrigine] = useState<Origine | "">("");
  const [type, setType] = useState<TypeContenu | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ExtraitsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Revenir à la page 1 à chaque changement de filtre pour éviter une page
  // hors-limite (ex: page 5 alors que le nouveau filtre n'a que 2 pages).
  // Fait dans les handlers ci-dessous (pas dans un useEffect séparé) pour que
  // le changement de filtre et la remise à page 1 soient appliqués dans le
  // même rendu — un useEffect dédié déclencherait un fetch intermédiaire
  // avec l'ancienne page avant correction.
  function updateOrigine(value: Origine | "") {
    setOrigine(value);
    setPage(1);
  }

  function updateType(value: TypeContenu | "") {
    setType(value);
    setPage(1);
  }

  function updateQ(value: string) {
    setQ(value);
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function fetchExtraits() {
      setIsLoading(true);
      setError(null);
      try {
        const url = buildExtraitsApiUrl({ origine, type, q, page });
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Erreur ${res.status}`);
        }
        const json: ExtraitsResponse = await res.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        setIsLoading(false);
      }
    }

    fetchExtraits();
    return () => controller.abort();
  }, [origine, type, q, page]);

  const activeFilters = [
    origine ? { key: "origine", label: ORIGINE_LABELS[origine], clear: () => updateOrigine("") } : null,
    type ? { key: "type", label: TYPE_LABELS[type], clear: () => updateType("") } : null,
    q ? { key: "q", label: `« ${q} »`, clear: () => updateQ("") } : null,
  ].filter((f): f is { key: string; label: string; clear: () => void } => f !== null);

  return (
    <div style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0 }}>
      {/* Colonne de filtres — 232 px, filet 1 px (mise en page du design system). */}
      <aside
        style={{
          width: "var(--sidebar-w)",
          flex: "0 0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          padding: "var(--space-5) var(--space-4)",
          borderRight: "var(--border-hairline)",
          background: "var(--surface-card)",
        }}
      >
        <form
          role="search"
          aria-label="Filtrer la bibliothèque d'extraits"
          onSubmit={(e) => e.preventDefault()}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}
        >
          <Input
            id="recherche"
            type="search"
            label="Rechercher"
            icon="search"
            value={q}
            placeholder="Titre d'un extrait…"
            onChange={(e) => updateQ(e.target.value)}
          />

          <Select
            id="origine"
            label="Origine"
            value={origine}
            onChange={(e) => updateOrigine(e.target.value as Origine | "")}
            options={[
              { value: "", label: "Toutes" },
              ...Object.entries(ORIGINE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />

          <Select
            id="type"
            label="Type"
            value={type}
            onChange={(e) => updateType(e.target.value as TypeContenu | "")}
            options={[
              { value: "", label: "Tous" },
              ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </form>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          // Plafond de largeur du design system appliqué au contenu seul : la
          // colonne de filtres reste collée à gauche.
          maxWidth: "var(--page-max)",
          padding: "var(--space-6) var(--gutter-page)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {hero}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ fontSize: "var(--text-display-md)" }}>Bibliothèque</h2>
          {data ? (
            // Tout ce qui se compte s'écrit en mono → composant Badge.
            <Badge>
              {data.pagination.total} {data.pagination.total > 1 ? "extraits" : "extrait"}
            </Badge>
          ) : null}

          {activeFilters.length > 0 ? (
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
                marginLeft: "auto",
                flexWrap: "wrap",
              }}
            >
              {activeFilters.map((f) => (
                <Tag key={f.key} selected onClick={f.clear} onRemove={f.clear}>
                  {f.label}
                </Tag>
              ))}
            </div>
          ) : null}
        </div>

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
              fontSize: "var(--text-body)",
            }}
          >
            <Icon name="alert-triangle" size={16} color="var(--state-danger)" />
            La bibliothèque n&apos;a pas pu être chargée. ({error})
          </p>
        )}

        {isLoading && !data && (
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              margin: 0,
              color: "var(--text-secondary)",
            }}
          >
            <Icon name="loader" size={16} />
            Chargement des extraits…
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
            <h3 style={{ fontSize: "var(--text-title)" }}>Aucun résultat</h3>
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              Aucun extrait ne correspond à votre recherche. Élargissez les filtres pour
              retrouver le catalogue.
            </p>
            {activeFilters.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOrigine("");
                  setType("");
                  setQ("");
                  setPage(1);
                }}
              >
                Effacer les filtres
              </Button>
            ) : null}
          </div>
        )}

        {data && data.items.length > 0 && (
          <ul
            // `role="list"` explicite : un `list-style: none` retire les
            // sémantiques de liste dans certains navigateurs (WebKit).
            role="list"
            aria-label="Résultats de la bibliothèque"
            data-testid="extraits-grid"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
              gap: "var(--gap-grid)",
              // La grille pâlit pendant un rechargement de filtre plutôt que de
              // disparaître : pas de saut de mise en page entre deux requêtes.
              opacity: isLoading ? 0.55 : 1,
              transition: "opacity var(--dur-fast) var(--ease-out)",
            }}
          >
            {data.items.map((extrait) => (
              <li key={extrait.id} style={{ display: "flex" }}>
                <ClipCard
                  title={extrait.titre}
                  origin={extrait.origine}
                  kind={TYPE_LABELS[extrait.type]}
                  thumb={extrait.thumbnail}
                  source={extrait.source === "UPLOAD" ? "import" : "embed"}
                  style={{ flex: 1 }}
                />
              </li>
            ))}
          </ul>
        )}

        {data && data.pagination.totalPages > 1 && (
          <nav
            aria-label="Pagination de la bibliothèque"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              paddingTop: "var(--space-2)",
            }}
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
                letterSpacing: "var(--tracking-mono-caps)",
                color: "var(--text-secondary)",
              }}
            >
              Page {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              iconEnd="chevron-right"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
            >
              Suivant
            </Button>
          </nav>
        )}
      </main>
    </div>
  );
}
