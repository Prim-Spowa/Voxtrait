/**
 * Logique client-safe de la sauvegarde privée d'un doublage — ST 6.1
 * « Sauvegarde privée d'un doublage » (US 6.1 : sauvegarder un doublage dans
 * mon espace privé).
 *
 * Séparée de `lib/doublageSauvegarde.ts` (orchestration serveur : store,
 * contrôle d'accès, `node:crypto` indirect) pour pouvoir être importée depuis
 * un composant `"use client"` — même séparation que `doublageClient.ts` vs
 * `doublage.ts` (ST 3.1) ou `doublageShareClient.ts` vs `doublageShare.ts`
 * (ST 3.2).
 *
 * Contient : le type de visibilité, la forme de la vue API (`DoublageSauvegardeView`),
 * le libellé de la route de l'espace privé, et — pour ST 6.2 « Historique des
 * doublages » — la forme de la réponse du listing, le parsing/validation des
 * query params et la construction de l'URL d'appel (fonctions pures, testables
 * sans runtime Next ni React, à l'image de `lib/extraitsClient.ts` pour ST 1.1).
 */

/**
 * Visibilité d'une entrée `Doublage` sauvegardée. Reprend les valeurs de l'enum
 * Prisma `VisibiliteDoublage`, dupliquées ici pour rester client-safe (même
 * approche que `DoublageVisibilite` dans `doublageShareClient.ts`).
 *
 *  - `PRIVEE` (défaut à la sauvegarde) : lisible uniquement par le propriétaire ;
 *  - `PUBLIC` : réservé à un usage ultérieur (partage depuis l'espace privé).
 *
 * ⚠️ À ne pas confondre avec `DoublageVisibilite` (`privee` / `lien_public`,
 * ST 3.2) qui gouverne la page de partage anonyme `/doublage/:id`.
 */
export type VisibiliteDoublage = "PRIVEE" | "PUBLIC";

/**
 * Chemin de l'espace privé où l'utilisateur retrouve l'historique de ses
 * doublages (ST 6.2). Aligné sur les préfixes protégés du middleware
 * (`src/lib/authGuard.ts` : `/mon-espace`).
 */
export const MON_ESPACE_HISTORIQUE_PATH = "/mon-espace/historique";

/**
 * Projection d'une entrée `Doublage` renvoyée par l'API au client. On expose
 * l'id de la sauvegarde, l'extrait d'origine, l'URL du fichier, la visibilité
 * et la date de création — pas l'`utilisateurId` (implicite : c'est toujours
 * celui de la session) ni le `jobId` (détail d'implémentation ST 3.1).
 */
export interface DoublageSauvegardeView {
  id: string;
  extraitId: string;
  fichierUrl: string;
  visibilite: VisibiliteDoublage;
  /** Date de création, ISO 8601. */
  dateCreation: string;
}

/* -------------------------------------------------------------------------- */
/*  ST 6.2 — Historique des doublages                                          */
/* -------------------------------------------------------------------------- */

/**
 * Valeur attendue du query param `utilisateur` de `GET /api/doublages` : on
 * n'expose que « ses propres » doublages. Le mot-clé `me` évite de divulguer un
 * identifiant de compte dans l'URL (le serveur résout `me` avec la session).
 */
export const HISTORIQUE_UTILISATEUR_COURANT = "me";

/** Taille de page par défaut de l'historique (cf. `PAGE_SIZE_DEFAUT`, ST 1.1). */
export const HISTORIQUE_PAGE_SIZE_DEFAUT = 12;
/** Plafond de taille de page — protège d'une requête volontairement coûteuse. */
export const HISTORIQUE_PAGE_SIZE_MAX = 50;

/**
 * Entrée d'historique renvoyée par l'API : la vue de la sauvegarde (ST 6.1)
 * enrichie des métadonnées de l'extrait d'origine (ST 1.1) nécessaires à
 * l'affichage d'une carte. Les champs `extrait*` sont `null` si l'extrait a
 * depuis été retiré (modération) ou est introuvable.
 */
export interface DoublageHistoriqueItem extends DoublageSauvegardeView {
  extraitTitre: string | null;
  extraitThumbnail: string | null;
  extraitOrigine: string | null;
  extraitType: string | null;
}

/** Réponse de `GET /api/doublages?utilisateur=me` — même forme que `ExtraitsResponse`. */
export interface DoublageHistoriqueResponse {
  items: DoublageHistoriqueItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Query params validés de `GET /api/doublages` (branche historique). */
export interface HistoriqueQuery {
  page: number;
  pageSize: number;
}

/**
 * Levée par `parseHistoriqueQuery` quand un paramètre est fourni mais invalide
 * — la route la traduit en `400` explicite plutôt qu'en filtrage silencieux
 * (même posture que `InvalidQueryParamError`, ST 1.1).
 */
export class HistoriqueQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoriqueQueryError";
  }
}

/**
 * Parse et valide les query params de la branche « historique » de
 * `GET /api/doublages`.
 *
 *  - `utilisateur` : **obligatoire** et égal à `me` (`HISTORIQUE_UTILISATEUR_COURANT`).
 *    Toute autre valeur est refusée : on ne consulte jamais l'historique d'un
 *    tiers via ce endpoint.
 *  - `page` : entier ≥ 1 (défaut 1) ;
 *  - `pageSize` : entier ≥ 1, plafonné à `HISTORIQUE_PAGE_SIZE_MAX` (défaut
 *    `HISTORIQUE_PAGE_SIZE_DEFAUT`).
 */
export function parseHistoriqueQuery(searchParams: URLSearchParams): HistoriqueQuery {
  const utilisateur = searchParams.get("utilisateur");
  if (utilisateur !== HISTORIQUE_UTILISATEUR_COURANT) {
    throw new HistoriqueQueryError(
      `Paramètre "utilisateur" invalide : seul "${HISTORIQUE_UTILISATEUR_COURANT}" est accepté.`
    );
  }

  let page = 1;
  const pageRaw = searchParams.get("page");
  if (pageRaw !== null) {
    const parsed = Number(pageRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new HistoriqueQueryError(
        `Paramètre "page" invalide : "${pageRaw}". Doit être un entier >= 1.`
      );
    }
    page = parsed;
  }

  let pageSize = HISTORIQUE_PAGE_SIZE_DEFAUT;
  const pageSizeRaw = searchParams.get("pageSize");
  if (pageSizeRaw !== null) {
    const parsed = Number(pageSizeRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new HistoriqueQueryError(
        `Paramètre "pageSize" invalide : "${pageSizeRaw}". Doit être un entier >= 1.`
      );
    }
    pageSize = Math.min(parsed, HISTORIQUE_PAGE_SIZE_MAX);
  }

  return { page, pageSize };
}

/**
 * Construit l'URL d'appel à `GET /api/doublages?utilisateur=me` depuis l'état de
 * pagination du composant de listing. Fonction pure — cf. `buildExtraitsApiUrl`.
 */
export function buildHistoriqueApiUrl({ page }: { page?: number } = {}): string {
  const params = new URLSearchParams({ utilisateur: HISTORIQUE_UTILISATEUR_COURANT });
  if (page && page > 1) params.set("page", String(page));
  return `/api/doublages?${params.toString()}`;
}
