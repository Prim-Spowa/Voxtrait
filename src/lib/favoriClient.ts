/**
 * Logique client-safe des favoris — ST 8.1 « Marquer une scène en favori »
 * (US 8.1 : marquer une scène en favori pour la retrouver facilement).
 *
 * Séparée de `lib/favori.ts` (orchestration serveur : store, `node:crypto`
 * indirect) pour pouvoir être importée depuis un composant `"use client"` —
 * même séparation que `doublageSauvegardeClient.ts` vs `doublageSauvegarde.ts`
 * (ST 6.1).
 *
 * Contient : la forme des vues API (`FavoriView`, `FavoriItem`), le chemin de
 * l'espace privé, et le parsing/validation des query params + la construction
 * des URLs d'appel (fonctions pures, testables sans runtime Next ni React —
 * même approche que `lib/extraitsClient.ts` pour ST 1.1).
 */

/**
 * Chemin de l'espace privé où l'utilisateur retrouve ses extraits favoris
 * (ST 8.1). Aligné sur les préfixes protégés du middleware
 * (`src/lib/authGuard.ts` : `/mon-espace`).
 */
export const MON_ESPACE_FAVORIS_PATH = "/mon-espace/favoris";

/**
 * Projection d'une entrée `Favori` renvoyée par l'API au client. On expose
 * l'id du favori, l'extrait favorisé et la date d'ajout — pas l'`utilisateurId`
 * (implicite : toujours celui de la session), même choix que
 * `DoublageSauvegardeView` (ST 6.1).
 */
export interface FavoriView {
  id: string;
  extraitId: string;
  /** Date d'ajout, ISO 8601. */
  dateAjout: string;
}

/* -------------------------------------------------------------------------- */
/*  Construction de l'URL de bascule (ajout / retrait)                       */
/* -------------------------------------------------------------------------- */

/**
 * URL commune à `POST /api/extraits/:id/favori` (ajout) et
 * `DELETE /api/extraits/:id/favori` (retrait) — le verbe HTTP porte
 * l'intention, l'URL ne change pas.
 */
export function buildFavoriToggleApiUrl(extraitId: string): string {
  return `/api/extraits/${encodeURIComponent(extraitId)}/favori`;
}

/* -------------------------------------------------------------------------- */
/*  ST 8.1 — Listing paginé des favoris (`GET /api/favoris`)                 */
/* -------------------------------------------------------------------------- */

/** Taille de page par défaut du listing des favoris — reprend celle de la
 * bibliothèque (ST 1.1, `PAGE_SIZE_DEFAUT`) : la story demande de réutiliser
 * sa structure de listing. */
export const FAVORIS_PAGE_SIZE_DEFAUT = 20;
/** Plafond de taille de page — protège d'une requête volontairement coûteuse. */
export const FAVORIS_PAGE_SIZE_MAX = 50;

/**
 * Entrée de listing renvoyée par l'API : la vue du favori (ST 8.1) enrichie
 * des métadonnées de l'extrait favorisé (ST 1.1) nécessaires à l'affichage
 * d'une carte. Les champs `extrait*` sont `null` si l'extrait est introuvable
 * (supprimé) ; `extraitStatut` reste renseigné pour un extrait retiré par
 * modération (`RETRAIT_MODERATION` / `RETRAIT_AYANT_DROIT` / `REJETE`), ce qui
 * permet au listing d'afficher « contenu retiré » plutôt que de le faire
 * disparaître silencieusement — cf. `src/lib/favori.ts` pour la décision
 * prise sur ce point d'attention de la story.
 */
export interface FavoriItem extends FavoriView {
  extraitTitre: string | null;
  extraitThumbnail: string | null;
  extraitOrigine: string | null;
  extraitType: string | null;
  extraitSource: string | null;
  extraitStatut: string | null;
}

/** Réponse de `GET /api/favoris` — même forme que `ExtraitsResponse` / `DoublageHistoriqueResponse`. */
export interface FavorisResponse {
  items: FavoriItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Query params validés de `GET /api/favoris`. */
export interface FavorisQuery {
  page: number;
  pageSize: number;
}

/**
 * Levée par `parseFavorisQuery` quand un paramètre est fourni mais invalide —
 * la route la traduit en `400` explicite plutôt qu'en filtrage silencieux
 * (même posture que `HistoriqueQueryError`, ST 6.2).
 */
export class FavorisQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FavorisQueryError";
  }
}

/**
 * Parse et valide les query params de `GET /api/favoris`.
 *
 * Contrairement à `GET /api/doublages?utilisateur=me` (ST 6.2), aucun
 * paramètre `utilisateur` n'est nécessaire ici : ce endpoint n'a de sens que
 * pour le compte connecté (la session le détermine côté serveur), il n'existe
 * pas de variante « favoris d'un tiers ».
 *
 *  - `page` : entier ≥ 1 (défaut 1) ;
 *  - `pageSize` : entier ≥ 1, plafonné à `FAVORIS_PAGE_SIZE_MAX` (défaut
 *    `FAVORIS_PAGE_SIZE_DEFAUT`).
 */
export function parseFavorisQuery(searchParams: URLSearchParams): FavorisQuery {
  let page = 1;
  const pageRaw = searchParams.get("page");
  if (pageRaw !== null) {
    const parsed = Number(pageRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new FavorisQueryError(
        `Paramètre "page" invalide : "${pageRaw}". Doit être un entier >= 1.`
      );
    }
    page = parsed;
  }

  let pageSize = FAVORIS_PAGE_SIZE_DEFAUT;
  const pageSizeRaw = searchParams.get("pageSize");
  if (pageSizeRaw !== null) {
    const parsed = Number(pageSizeRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new FavorisQueryError(
        `Paramètre "pageSize" invalide : "${pageSizeRaw}". Doit être un entier >= 1.`
      );
    }
    pageSize = Math.min(parsed, FAVORIS_PAGE_SIZE_MAX);
  }

  return { page, pageSize };
}

/**
 * Construit l'URL d'appel à `GET /api/favoris` depuis l'état de pagination du
 * composant de listing. Fonction pure — cf. `buildHistoriqueApiUrl` (ST 6.2).
 *
 * `pageSize` est exposé (au-delà du seul `page`) pour l'usage fait par
 * `BibliothequeListing` : connaître en un seul appel les ids déjà favorisés du
 * compte connecté, avec le plafond `FAVORIS_PAGE_SIZE_MAX` plutôt que le
 * défaut du listing paginé.
 */
export function buildFavorisApiUrl(
  { page, pageSize }: { page?: number; pageSize?: number } = {}
): string {
  const params = new URLSearchParams();
  if (page && page > 1) params.set("page", String(page));
  if (pageSize) params.set("pageSize", String(pageSize));
  const query = params.toString();
  return query ? `/api/favoris?${query}` : "/api/favoris";
}
