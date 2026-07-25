"use client";

import { useEffect, useState } from "react";
import { buildExtraitsApiUrl } from "@/lib/extraitsClient";
import {
  ExtraitDTO,
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
 */
export default function BibliothequeListing() {
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

  return (
    <div>
      <form
        role="search"
        aria-label="Filtrer la bibliothèque d'extraits"
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="recherche">Rechercher</label>
        <input
          id="recherche"
          type="search"
          value={q}
          placeholder="Titre d'un extrait…"
          onChange={(e) => updateQ(e.target.value)}
        />

        <label htmlFor="origine">Origine</label>
        <select
          id="origine"
          value={origine}
          onChange={(e) => updateOrigine(e.target.value as Origine | "")}
        >
          <option value="">Toutes</option>
          {Object.entries(ORIGINE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label htmlFor="type">Type</label>
        <select
          id="type"
          value={type}
          onChange={(e) => updateType(e.target.value as TypeContenu | "")}
        >
          <option value="">Tous</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </form>

      {error && (
        <p role="alert">
          Impossible de charger la bibliothèque pour le moment. ({error})
        </p>
      )}

      {isLoading && !data && <p>Chargement des extraits…</p>}

      {data && data.items.length === 0 && !isLoading && (
        <p>Aucun extrait ne correspond à votre recherche.</p>
      )}

      {data && data.items.length > 0 && (
        <ul aria-label="Résultats de la bibliothèque" data-testid="extraits-grid">
          {data.items.map((extrait) => (
            <ExtraitCard key={extrait.id} extrait={extrait} />
          ))}
        </ul>
      )}

      {data && data.pagination.totalPages > 1 && (
        <nav aria-label="Pagination de la bibliothèque">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Précédent
          </button>
          <span>
            Page {data.pagination.page} / {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
          >
            Suivant
          </button>
        </nav>
      )}
    </div>
  );
}

function ExtraitCard({ extrait }: { extrait: ExtraitDTO }) {
  return (
    <li>
      {extrait.thumbnail && (
        // Vignette informative pour un contenu déjà décrit par le titre :
        // alt vide volontaire, cf. WAI (image décorative/redondante).
        <img src={extrait.thumbnail} alt="" loading="lazy" />
      )}
      <h3>{extrait.titre}</h3>
      <p>
        {ORIGINE_LABELS[extrait.origine]} · {TYPE_LABELS[extrait.type]}
      </p>
    </li>
  );
}
