"use client";

import { useEffect, useState, type ReactNode } from "react";
import { buildExtraitsApiUrl } from "@/lib/extraitsClient";
import {
  buildFavorisApiUrl,
  FAVORIS_PAGE_SIZE_MAX,
  type FavorisResponse,
} from "@/lib/favoriClient";
import { FavoriButton } from "@/components/FavoriButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ClipCard } from "@/components/ui/ClipCard";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { SideNav, type SideNavGroup } from "@/components/ui/SideNav";
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
 * Filtres (ST 11.1) : colonne `SideNav` du design system (232 px), un groupe
 * de `Tag` à bascule par facette. L'API d'US 1.1 n'accepte qu'une origine et
 * qu'un type à la fois → `SideNav` est utilisé en mode `single` (radio par
 * groupe : cliquer un tag remplace la sélection du groupe, le recliquer
 * l'efface). Le champ de recherche vit dans l'en-tête (`header`) de la
 * colonne — un seul champ de recherche par écran. Les filtres actifs sont
 * aussi rappelés en `Tag` supprimables au-dessus de la grille. À faire évoluer
 * en multi-sélection si le filtrage multiple entre au périmètre serveur.
 *
 * **Bouton favori (ST 8.1, "Bouton favori (état rempli/vide) sur le composant
 * carte d'extrait").** Réservé aux comptes connectés : au montage, un appel
 * séparé (indépendant des filtres, ne se relance jamais) à
 * `GET /api/favoris?pageSize={FAVORIS_PAGE_SIZE_MAX}` révèle à la fois l'état
 * de connexion (`401` = visiteur anonyme, aucun bouton affiché — la
 * sauvegarde d'un favori exige un compte) et les ids déjà favorisés. Chaque
 * `FavoriButton` gère ensuite lui-même sa bascule ; `handleFavoriChange` tient
 * juste la liste locale à jour pour qu'un aller-retour entre deux pages de
 * résultats affiche le bon état sans nouvel appel réseau.
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

  // ST 8.1 — ids des extraits déjà favorisés par le compte connecté, et
  // disponibilité du bouton favori (`false` tant que le compte n'est pas
  // confirmé connecté, cf. effet ci-dessous).
  const [favoriIds, setFavoriIds] = useState<Set<string>>(new Set());
  const [favorisDisponibles, setFavorisDisponibles] = useState(false);

  function handleFavoriChange(extraitId: string, favori: boolean) {
    setFavoriIds((prev) => {
      const next = new Set(prev);
      if (favori) next.add(extraitId);
      else next.delete(extraitId);
      return next;
    });
  }

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

  // ST 8.1 — connaît, une fois au montage, les extraits déjà favorisés par le
  // compte connecté. Indépendant des filtres/pagination de la bibliothèque :
  // ne se relance jamais après un changement d'`origine`/`type`/`q`/`page`.
  //
  // Un visiteur non connecté reçoit un `401` (cf. `GET /api/favoris`) : le
  // bouton favori reste alors masqué sur toutes les cartes, sans message
  // d'erreur — les favoris sont une fonctionnalité secondaire de cette page
  // publique, leur indisponibilité ne doit jamais empêcher la consultation de
  // la bibliothèque.
  //
  // ⚠️ Limite connue : `pageSize` est plafonné à `FAVORIS_PAGE_SIZE_MAX` (50).
  // Au-delà, les favoris les plus anciens d'un compte n'apparaîtront pas
  // "déjà favorisés" au premier affichage (mais restent bascule-ables
  // normalement) — cf. notes de dev ST 8.1.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(buildFavorisApiUrl({ pageSize: FAVORIS_PAGE_SIZE_MAX }), {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body: FavorisResponse = await res.json();
        setFavoriIds(new Set(body.items.map((item) => item.extraitId)));
        setFavorisDisponibles(true);
      } catch {
        // AbortError au démontage, ou échec réseau : dégrade silencieusement.
      }
    })();

    return () => controller.abort();
  }, []);

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

  // Facettes de la colonne `SideNav` (mode radio par groupe, cf. tête de
  // fichier). L'API ne renvoie pas de comptes par facette → pas de `count`.
  const GROUP_ORIGINE = "Origine";
  const GROUP_TYPE = "Type";
  const filterGroups: SideNavGroup[] = [
    {
      label: GROUP_ORIGINE,
      items: (Object.keys(ORIGINE_LABELS) as Origine[]).map((value) => ({
        label: ORIGINE_LABELS[value],
      })),
    },
    {
      label: GROUP_TYPE,
      items: (Object.keys(TYPE_LABELS) as TypeContenu[]).map((value) => ({
        label: TYPE_LABELS[value],
      })),
    },
  ];
  const selectedLabels = [
    origine ? ORIGINE_LABELS[origine] : null,
    type ? TYPE_LABELS[type] : null,
  ].filter((l): l is string => l !== null);

  function handleFilterToggle(label: string, group: SideNavGroup) {
    if (group.label === GROUP_ORIGINE) {
      const value = (Object.keys(ORIGINE_LABELS) as Origine[]).find(
        (key) => ORIGINE_LABELS[key] === label
      );
      updateOrigine(origine === value ? "" : value ?? "");
    } else if (group.label === GROUP_TYPE) {
      const value = (Object.keys(TYPE_LABELS) as TypeContenu[]).find(
        (key) => TYPE_LABELS[key] === label
      );
      updateType(type === value ? "" : value ?? "");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0 }}>
      {/* Colonne de filtres — `SideNav` du design system (232 px, filet 1 px).
          Le champ de recherche est rendu dans l'en-tête de la colonne. */}
      <SideNav
        aria-label="Filtrer la bibliothèque d'extraits"
        groups={filterGroups}
        selected={selectedLabels}
        onToggle={handleFilterToggle}
        header={
          <form
            role="search"
            aria-label="Rechercher un extrait"
            onSubmit={(e) => e.preventDefault()}
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
          </form>
        }
      />

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
            <ul
              role="list"
              aria-label="Filtres actifs"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                gap: "var(--space-2)",
                marginLeft: "auto",
                flexWrap: "wrap",
              }}
            >
              {activeFilters.map((f) => (
                <li key={f.key} style={{ display: "flex" }}>
                  <Tag selected onClick={f.clear} onRemove={f.clear}>
                    {f.label}
                  </Tag>
                </li>
              ))}
            </ul>
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
                  href={`/extraits/${extrait.id}`}
                  actions={
                    favorisDisponibles ? (
                      <FavoriButton
                        extraitId={extrait.id}
                        initialFavori={favoriIds.has(extrait.id)}
                        onChange={(favori) => handleFavoriChange(extrait.id, favori)}
                      />
                    ) : undefined
                  }
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
