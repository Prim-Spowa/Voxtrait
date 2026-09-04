/**
 * Orchestration serveur des favoris — ST 8.1 « Marquer une scène en favori »
 * (US 8.1 : marquer une scène en favori pour la retrouver facilement).
 *
 * Découpage en tâches ST 8.1 :
 *  1. Modéliser `Favori` (utilisateur_id, extrait_id, date_ajout, contrainte
 *     d'unicité sur le couple)
 *       → `prisma/schema.prisma` (modèle `Favori`)
 *       → `Favori` + `FavoriStore` (ce module)
 *  2. Endpoints `POST`/`DELETE /api/extraits/:id/favori` (ajout/retrait)
 *       → `src/app/api/extraits/[id]/favori/route.ts`
 *       → `ajouterFavori` / `retirerFavori` (ce module)
 *  3. Endpoint `GET /api/favoris` paginé
 *       → `src/app/api/favoris/route.ts`
 *       → `chargerFavoris` (ce module)
 *
 * Choix techniques (ST 8.1) : même architecture « store injecté » que
 * `lib/doublageSauvegarde.ts` (ST 6.1) — logique métier testable sans base,
 * store en mémoire pour `DATA_SOURCE=mock` et la CI, adaptateur Prisma isolé
 * dans `src/lib/mocks/favori.mock.ts`.
 *
 * ⚠️ Périmètre : après ajout du modèle `Favori` au schéma, régénérer le client
 * Prisma (`npm run prisma:generate`) — cf. note dans le README.
 */

import type {
  FavoriItem,
  FavorisResponse,
  FavoriView,
} from "@/lib/favoriClient";

/* -------------------------------------------------------------------------- */
/*  Entité et store                                                           */
/* -------------------------------------------------------------------------- */

/** Entrée `Favori` telle que persistée — reflète le modèle Prisma. */
export interface Favori {
  id: string;
  /** Propriétaire du favori (`Favori.utilisateurId`). */
  utilisateurId: string;
  /** Extrait favorisé (`Favori.extraitId`). */
  extraitId: string;
  /** Date d'ajout, ISO 8601. */
  dateAjout: string;
}

/** Données nécessaires à la création d'une entrée. */
export interface CreerFavoriInput {
  utilisateurId: string;
  extraitId: string;
}

/**
 * Sous-ensemble d'un store d'entrées `Favori` — permet une implémentation en
 * mémoire (défaut / test) ou Prisma. Même approche « delegate injecté » que
 * `DoublageSauvegardeStore` (ST 6.1).
 */
export interface FavoriStore {
  /**
   * Crée une entrée. Lève une erreur `code: "P2002"` (même convention que
   * Prisma) si le couple `(utilisateurId, extraitId)` existe déjà — capturée
   * par `ajouterFavori` pour l'idempotence.
   */
  create(input: CreerFavoriInput): Promise<Favori>;
  /**
   * Retire le favori du couple `(utilisateurId, extraitId)` s'il existe.
   * Renvoie `true` si une ligne a été supprimée, `false` si elle n'existait
   * déjà pas — jamais d'erreur (le retrait est intrinsèquement idempotent).
   */
  delete(utilisateurId: string, extraitId: string): Promise<boolean>;
  /** Retrouve le favori d'un couple donné, ou `null`. */
  find(utilisateurId: string, extraitId: string): Promise<Favori | null>;
  /**
   * Page de favoris d'un utilisateur, les plus récents d'abord, + total
   * (ST 8.1, « Endpoint `GET /api/favoris` paginé »). `skip`/`take` sont
   * appliqués côté store (index `@@index([utilisateurId, dateAjout])`).
   */
  pageByUtilisateur(
    utilisateurId: string,
    pagination: { skip: number; take: number }
  ): Promise<{ items: Favori[]; total: number }>;
}

/* -------------------------------------------------------------------------- */
/*  Store en mémoire                                                          */
/* -------------------------------------------------------------------------- */

function genererId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `favori-${crypto.randomUUID()}`;
  }
  return `favori-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `FavoriStore` — perdue au redémarrage du
 * process. Même réserve « multi-instances » que les autres stores en mémoire
 * (ST 3.1, 5.1, 6.1) : en production, c'est Prisma/Postgres qui persiste
 * réellement. Suffisant pour `next dev` (process unique) et les tests.
 *
 * Émule la contrainte d'unicité `(utilisateurId, extraitId)` du schéma :
 * `create` sur un couple déjà présent lève une erreur `code: "P2002"`, comme
 * Prisma — `ajouterFavori` s'appuie sur `find` en amont, ce garde-fou ne sert
 * que de filet en cas de course.
 */
export function createInMemoryFavoriStore(
  now: () => Date = () => new Date()
): FavoriStore {
  const rows = new Map<string, Favori>();

  return {
    async create(input) {
      const existing = [...rows.values()].find(
        (row) => row.utilisateurId === input.utilisateurId && row.extraitId === input.extraitId
      );
      if (existing) {
        throw Object.assign(
          new Error("Unique constraint failed on the fields: (`utilisateur_id`,`extrait_id`)"),
          { code: "P2002" }
        );
      }

      const row: Favori = {
        id: genererId(),
        utilisateurId: input.utilisateurId,
        extraitId: input.extraitId,
        dateAjout: now().toISOString(),
      };
      rows.set(row.id, row);
      return { ...row };
    },

    async delete(utilisateurId, extraitId) {
      const found = [...rows.entries()].find(
        ([, row]) => row.utilisateurId === utilisateurId && row.extraitId === extraitId
      );
      if (!found) return false;
      rows.delete(found[0]);
      return true;
    },

    async find(utilisateurId, extraitId) {
      const row = [...rows.values()].find(
        (r) => r.utilisateurId === utilisateurId && r.extraitId === extraitId
      );
      return row ? { ...row } : null;
    },

    async pageByUtilisateur(utilisateurId, { skip, take }) {
      const all = sortedRowsFor(utilisateurId);
      return {
        items: all.slice(skip, skip + take).map((row) => ({ ...row })),
        total: all.length,
      };
    },
  };

  /** Lignes d'un utilisateur, les plus récentes d'abord (tri stable sur `id`). */
  function sortedRowsFor(utilisateurId: string): Favori[] {
    return [...rows.values()]
      .filter((row) => row.utilisateurId === utilisateurId)
      .sort((a, b) => b.dateAjout.localeCompare(a.dateAjout) || b.id.localeCompare(a.id));
  }
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — toggle (ajout / retrait)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ajoute un extrait aux favoris de `utilisateurId` — ST 8.1, découpage en
 * tâches point 2. **Idempotent** : ré-appelée pour le même couple, renvoie
 * l'entrée existante sans en créer de nouvelle (garde-fou aligné sur la
 * contrainte `@@unique` du schéma).
 *
 * Aucune vérification de l'existence de l'extrait ici : c'est la
 * responsabilité de l'appelant (endpoint), comme pour `sauvegarderDoublage`
 * vs `findExtraitById` (ST 6.1/3.1) — ce module reste sans dépendance à
 * `lib/extraits.ts`.
 */
export async function ajouterFavori(
  store: FavoriStore,
  params: { utilisateurId: string; extraitId: string }
): Promise<Favori> {
  const utilisateurId = params.utilisateurId.trim();
  const extraitId = params.extraitId.trim();
  if (!utilisateurId) {
    throw new Error("ajouterFavori : identifiant utilisateur manquant.");
  }
  if (!extraitId) {
    throw new Error("ajouterFavori : identifiant extrait manquant.");
  }

  const existant = await store.find(utilisateurId, extraitId);
  if (existant) return existant;

  try {
    return await store.create({ utilisateurId, extraitId });
  } catch (err) {
    // Course : un ajout concurrent a créé l'entrée entre `find` et `create`.
    // On relit et on renvoie l'existante (idempotence préservée) — même
    // traitement que `sauvegarderDoublage` (ST 6.1).
    if (isUniqueConstraintError(err)) {
      const gagnant = await store.find(utilisateurId, extraitId);
      if (gagnant) return gagnant;
    }
    throw err;
  }
}

/**
 * Retire un extrait des favoris de `utilisateurId` — ST 8.1, découpage en
 * tâches point 2. **Idempotent** : retirer un favori déjà absent ne lève
 * jamais d'erreur, renvoie simplement `false`.
 *
 * Un identifiant utilisateur ou extrait vide renvoie `false` sans appeler le
 * store (même garde-fou défensif que `listerDoublagesSauvegardes`).
 */
export async function retirerFavori(
  store: FavoriStore,
  params: { utilisateurId: string; extraitId: string }
): Promise<boolean> {
  const utilisateurId = params.utilisateurId.trim();
  const extraitId = params.extraitId.trim();
  if (!utilisateurId || !extraitId) return false;
  return store.delete(utilisateurId, extraitId);
}

/* -------------------------------------------------------------------------- */
/*  ST 8.1 — Listing paginé des favoris                                       */
/* -------------------------------------------------------------------------- */

/**
 * Résumé d'un extrait favorisé (ST 1.1) tel qu'affiché sur une carte de
 * l'espace « favoris ». `null` partout si l'extrait est introuvable (supprimé
 * depuis) ; `statut` reste renseigné même pour un extrait retiré par
 * modération — c'est ce qui permet à l'affichage de distinguer un extrait
 * simplement absent d'un extrait retiré (cf. tête de fichier, décision
 * ST 8.1 sur le point d'attention « favori dont l'extrait est retiré »).
 */
export interface ExtraitResumeFavori {
  titre: string | null;
  thumbnail: string | null;
  origine: string | null;
  type: string | null;
  source: string | null;
  /** Statut de modération de l'extrait (`VALIDE`, `RETRAIT_MODERATION`, …). */
  statut: string | null;
}

/**
 * Résout le résumé d'un extrait par son id. Injecté (plutôt qu'un import
 * direct de `prisma`/`findExtraitById`) pour garder ce module testable sans
 * base ni dépendance Prisma — même approche que `ResolveExtraitResume`
 * (ST 6.2, `lib/doublageSauvegarde.ts`).
 *
 * ⚠️ Volontairement **sans filtre de statut** : contrairement au endpoint
 * public `GET /api/extraits` (ST 1.1), un favori doit pouvoir résoudre un
 * extrait qui n'est plus `VALIDE` — c'est justement ce qui permet d'afficher
 * « contenu retiré » plutôt que d'en perdre la trace (cf. décision ST 8.1 en
 * tête de fichier).
 */
export type ResolveExtraitResumeFavori = (
  extraitId: string
) => Promise<ExtraitResumeFavori | null>;

/**
 * Charge une page des favoris de `utilisateurId` — ST 8.1, découpage en
 * tâches point 3 : « Endpoint `GET /api/favoris` paginé (favoris du compte
 * connecté), réutilisant la structure de listing de ST 1.1 ».
 *
 *  - ne renvoie **que** les favoris du demandeur (le store filtre par
 *    `utilisateurId`, aucune fuite possible — ST 8.1, « Contrôle d'accès
 *    strict ») ;
 *  - les plus récents d'abord ;
 *  - chaque entrée est enrichie des métadonnées de l'extrait favorisé,
 *    résolues une seule fois par extrait distinct.
 *
 * `page` est bornée à `[1, totalPages]` : une page hors limite renvoie une
 * liste vide plutôt qu'une erreur (même comportement que
 * `chargerHistoriqueDoublages`, ST 6.2).
 */
export async function chargerFavoris(
  store: FavoriStore,
  params: {
    utilisateurId: string;
    page: number;
    pageSize: number;
    resolveExtrait: ResolveExtraitResumeFavori;
  }
): Promise<FavorisResponse> {
  const { utilisateurId, resolveExtrait } = params;
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const proprietaire = utilisateurId.trim();

  if (!proprietaire) {
    return { items: [], pagination: { page: 1, pageSize, total: 0, totalPages: 1 } };
  }

  // 1er passage : connaître le total pour borner `page` avant de re-slicer.
  const { total } = await store.pageByUtilisateur(proprietaire, { skip: 0, take: 0 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(params.page)), totalPages);

  const { items: rows } = await store.pageByUtilisateur(proprietaire, {
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Résolution des extraits : une requête par extrait distinct de la page.
  const cache = new Map<string, ExtraitResumeFavori | null>();
  const items: FavoriItem[] = [];
  for (const row of rows) {
    if (!cache.has(row.extraitId)) {
      cache.set(row.extraitId, await resolveExtrait(row.extraitId).catch(() => null));
    }
    const extrait = cache.get(row.extraitId) ?? null;
    items.push({
      ...toFavoriView(row),
      extraitTitre: extrait?.titre ?? null,
      extraitThumbnail: extrait?.thumbnail ?? null,
      extraitOrigine: extrait?.origine ?? null,
      extraitType: extrait?.type ?? null,
      extraitSource: extrait?.source ?? null,
      extraitStatut: extrait?.statut ?? null,
    });
  }

  return { items, pagination: { page, pageSize, total, totalPages } };
}

/* -------------------------------------------------------------------------- */
/*  Projection vers la vue client                                            */
/* -------------------------------------------------------------------------- */

/** Réduit une entrée `Favori` à la `FavoriView` renvoyée par l'API. */
export function toFavoriView(favori: Favori): FavoriView {
  return {
    id: favori.id,
    extraitId: favori.extraitId,
    dateAjout: favori.dateAjout,
  };
}

/** `true` si l'erreur est une violation de contrainte d'unicité Prisma (`P2002`). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}
