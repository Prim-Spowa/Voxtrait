/**
 * Orchestration serveur de la sauvegarde privée d'un doublage — ST 6.1
 * « Sauvegarde privée d'un doublage » (US 6.1 : sauvegarder un doublage dans
 * mon espace privé).
 *
 * Découpage en tâches ST 6.1 :
 *  1. Modéliser `Doublage` avec champ `visibilite` (privé/public)
 *       → `prisma/schema.prisma` (enum `VisibiliteDoublage` + modèle `Doublage`)
 *       → `DoublageSauvegarde` + `DoublageSauvegardeStore` (ce module)
 *  2. Endpoint de sauvegarde liant le fichier généré au compte
 *       → `src/app/api/doublages/[id]/sauvegarder/route.ts` + `sauvegarderDoublage` (ce module)
 *  3. Règle d'accès : seul le propriétaire peut lire un doublage privé
 *       → `lireDoublageSauvegarde` (ce module)
 *
 * Choix techniques (ST 6.1) :
 *  - **Réutilisation du fichier déjà généré (ST 3.1), pas de re-génération** :
 *    `sauvegarderDoublage` recopie l'URL de sortie du job (`downloadUrl`) dans
 *    `fichierUrl`. Le job doit être au statut `pret`.
 *  - **Contrôle d'accès strict** : `lireDoublageSauvegarde` compare
 *    `utilisateurId` à CHAQUE lecture (ST 6.1, points d'attention : « vérifier
 *    `utilisateur_id` sur chaque lecture »). Un doublage `PUBLIC` reste
 *    lisible par un tiers ; un doublage `PRIVEE` ne l'est que par son
 *    propriétaire.
 *
 * ⚠️ Périmètre d'implémentation — même posture que ST 3.1 / ST 5.1 (cf. tête de
 * `src/lib/doublage.ts`). Ce module fournit le **contrat**
 * (`DoublageSauvegardeStore`) et la logique d'accès, testables sans base ; une
 * implémentation **en mémoire** (`createInMemoryDoublageSauvegardeStore`) sert
 * la CI et le mode `DATA_SOURCE=mock`. L'adaptateur Prisma
 * (`src/lib/mocks/doublageSauvegarde.mock.ts` → `prismaDoublageSauvegardeStore`)
 * branche `prisma.doublage` sans toucher au reste du code.
 *
 * Rappel : après ajout du modèle `Doublage` au schéma, régénérer le client
 * Prisma (`npm run prisma:generate`) — cf. note dans le README.
 */

import type {
  DoublageHistoriqueItem,
  DoublageHistoriqueResponse,
  DoublageSauvegardeView,
  VisibiliteDoublage,
} from "@/lib/doublageSauvegardeClient";
import type { DoublageJob } from "@/lib/doublage";

/* -------------------------------------------------------------------------- */
/*  Erreurs                                                                    */
/* -------------------------------------------------------------------------- */

/** Sauvegarde `:id` inexistante — mène à un `404`. */
export class DoublageSauvegardeIntrouvableError extends Error {
  constructor(id: string) {
    super(`Sauvegarde de doublage introuvable : ${id}`);
    this.name = "DoublageSauvegardeIntrouvableError";
  }
}

/**
 * Le demandeur n'est pas le propriétaire d'un doublage `PRIVEE` — ST 6.1,
 * découpage en tâches point 3.
 *
 * ⚠️ Côté endpoint on renvoie **`404`** (et non `403`) pour ne pas révéler
 * l'existence d'un doublage privé à un tiers — même choix que
 * `GET /api/import/:id` (ST 5.1). L'erreur porte tout de même une sémantique
 * distincte de `DoublageSauvegardeIntrouvableError` pour les tests et la
 * journalisation serveur.
 */
export class DoublageSauvegardeAccesRefuseError extends Error {
  constructor(id: string) {
    super(`Accès refusé à la sauvegarde de doublage : ${id}`);
    this.name = "DoublageSauvegardeAccesRefuseError";
  }
}

/**
 * Tentative de sauvegarde d'un job qui n'est pas au statut `pret` (encore en
 * traitement, ou en échec) — mène à un `409`. On ne sauvegarde pas un fichier
 * qui n'existe pas encore.
 */
export class DoublageJobPasPretError extends Error {
  constructor(id: string) {
    super(`Le doublage ${id} n'est pas encore prêt à être sauvegardé.`);
    this.name = "DoublageJobPasPretError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Entité et store                                                            */
/* -------------------------------------------------------------------------- */

/** Entrée `Doublage` telle que persistée — reflète le modèle Prisma. */
export interface DoublageSauvegarde {
  id: string;
  /** Propriétaire de la sauvegarde (`Doublage.utilisateurId`). */
  utilisateurId: string;
  /** Extrait d'origine (`Doublage.extraitId`). */
  extraitId: string;
  /** Id du job de génération dont ce doublage est issu (ST 3.1). */
  jobId: string;
  /** URL du fichier généré, recopiée du job (`Doublage.fichierUrl`). */
  fichierUrl: string;
  visibilite: VisibiliteDoublage;
  /** Date de création, ISO 8601. */
  dateCreation: string;
}

/** Données nécessaires à la création d'une entrée (issues du job + de la session). */
export interface CreerDoublageSauvegardeInput {
  utilisateurId: string;
  extraitId: string;
  jobId: string;
  fichierUrl: string;
  /** Défaut appliqué par le store si absent : `PRIVEE`. */
  visibilite?: VisibiliteDoublage;
}

/**
 * Sous-ensemble d'un store d'entrées `Doublage` — permet une implémentation en
 * mémoire (défaut / test) ou Prisma. Même approche « delegate injecté » que
 * `DoublageJobStore` (ST 3.1) ou `ExtraitLibraryWriter` (ST 5.1).
 */
export interface DoublageSauvegardeStore {
  create(input: CreerDoublageSauvegardeInput): Promise<DoublageSauvegarde>;
  get(id: string): Promise<DoublageSauvegarde | null>;
  /** Retrouve la sauvegarde d'un job pour un utilisateur donné (idempotence). */
  findByJob(utilisateurId: string, jobId: string): Promise<DoublageSauvegarde | null>;
  /** Sauvegardes d'un utilisateur, les plus récentes d'abord (ST 6.2). */
  listByUtilisateur(utilisateurId: string): Promise<DoublageSauvegarde[]>;
  /**
   * Page de sauvegardes d'un utilisateur, les plus récentes d'abord, + total
   * (ST 6.2 « Historique des doublages » — « endpoint paginé », « pagination si
   * l'historique devient volumineux »). `skip`/`take` sont appliqués côté store
   * (index `@@index([utilisateurId, dateCreation])` du schéma).
   */
  pageByUtilisateur(
    utilisateurId: string,
    pagination: { skip: number; take: number }
  ): Promise<{ items: DoublageSauvegarde[]; total: number }>;
}

/* -------------------------------------------------------------------------- */
/*  Store en mémoire                                                           */
/* -------------------------------------------------------------------------- */

function genererId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `doublage-sauv-${crypto.randomUUID()}`;
  }
  return `doublage-sauv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `DoublageSauvegardeStore` — perdue au
 * redémarrage du process. Même réserve « multi-instances » que les stores de
 * jobs (ST 3.1 / 5.1) : en production, c'est Prisma/Postgres qui persiste
 * réellement. Suffisant pour `next dev` (process unique) et les tests.
 *
 * Émule la contrainte d'unicité `(utilisateurId, jobId)` du schéma : `create`
 * sur un couple déjà présent lève une erreur `code: "P2002"`, comme Prisma —
 * `sauvegarderDoublage` s'appuie sur `findByJob` en amont, ce garde-fou ne sert
 * que de filet en cas de course.
 */
export function createInMemoryDoublageSauvegardeStore(
  now: () => Date = () => new Date()
): DoublageSauvegardeStore {
  const rows = new Map<string, DoublageSauvegarde>();

  return {
    async create(input) {
      const existing = [...rows.values()].find(
        (row) => row.utilisateurId === input.utilisateurId && row.jobId === input.jobId
      );
      if (existing) {
        throw Object.assign(
          new Error("Unique constraint failed on the fields: (`utilisateur_id`,`job_id`)"),
          { code: "P2002" }
        );
      }

      const row: DoublageSauvegarde = {
        id: genererId(),
        utilisateurId: input.utilisateurId,
        extraitId: input.extraitId,
        jobId: input.jobId,
        fichierUrl: input.fichierUrl,
        visibilite: input.visibilite ?? "PRIVEE",
        dateCreation: now().toISOString(),
      };
      rows.set(row.id, row);
      return { ...row };
    },

    async get(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },

    async findByJob(utilisateurId, jobId) {
      const row = [...rows.values()].find(
        (r) => r.utilisateurId === utilisateurId && r.jobId === jobId
      );
      return row ? { ...row } : null;
    },

    async listByUtilisateur(utilisateurId) {
      return sortedRowsFor(utilisateurId).map((row) => ({ ...row }));
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
  function sortedRowsFor(utilisateurId: string): DoublageSauvegarde[] {
    return [...rows.values()]
      .filter((row) => row.utilisateurId === utilisateurId)
      .sort(
        (a, b) =>
          b.dateCreation.localeCompare(a.dateCreation) || b.id.localeCompare(a.id)
      );
  }
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Sauvegarde un doublage **déjà généré** (ST 3.1) dans l'espace privé de
 * `utilisateurId` — ST 6.1, découpage en tâches point 2.
 *
 * Règles :
 *  - le job doit être au statut `pret` avec une `downloadUrl` → sinon
 *    `DoublageJobPasPretError` (`409`) ;
 *  - **visibilité `PRIVEE` par défaut** (ST 6.1) ;
 *  - **idempotent** : ré-appelée pour le même `(utilisateur, job)`, elle
 *    renvoie l'entrée existante sans en créer de nouvelle (garde-fou aligné sur
 *    la contrainte `@@unique` du schéma).
 *
 * @param job job de génération résolu côté endpoint (`getDoublageJobStore().get(id)`)
 */
export async function sauvegarderDoublage(
  store: DoublageSauvegardeStore,
  params: { job: DoublageJob; utilisateurId: string }
): Promise<DoublageSauvegarde> {
  const { job, utilisateurId } = params;

  const proprietaire = utilisateurId.trim();
  if (!proprietaire) {
    throw new Error("sauvegarderDoublage : identifiant utilisateur manquant.");
  }

  if (job.status !== "pret" || !job.downloadUrl) {
    throw new DoublageJobPasPretError(job.id);
  }

  const deja = await store.findByJob(proprietaire, job.id);
  if (deja) return deja;

  try {
    return await store.create({
      utilisateurId: proprietaire,
      extraitId: job.input.extraitId,
      jobId: job.id,
      fichierUrl: job.downloadUrl,
      // Défaut explicite : la sauvegarde est privée (ST 6.1). Le partage
      // public éventuel se fait par un autre geste (ST 3.2, hors périmètre ici).
      visibilite: "PRIVEE",
    });
  } catch (err) {
    // Course : une sauvegarde concurrente a créé l'entrée entre `findByJob` et
    // `create`. On relit et on renvoie l'existante (idempotence préservée).
    if (isUniqueConstraintError(err)) {
      const gagnante = await store.findByJob(proprietaire, job.id);
      if (gagnante) return gagnante;
    }
    throw err;
  }
}

/**
 * Lit une sauvegarde en appliquant le contrôle d'accès — ST 6.1, découpage en
 * tâches point 3 : « seul le propriétaire peut lire un doublage privé ».
 *
 *  - sauvegarde inexistante → `DoublageSauvegardeIntrouvableError` ;
 *  - sauvegarde `PRIVEE` d'un autre utilisateur → `DoublageSauvegardeAccesRefuseError` ;
 *  - sauvegarde `PUBLIC`, ou sauvegarde du demandeur → renvoyée.
 *
 * `demandeurId` vide/absent (visiteur non authentifié) ne peut lire qu'un
 * doublage `PUBLIC`.
 */
export async function lireDoublageSauvegarde(
  store: DoublageSauvegardeStore,
  id: string,
  demandeurId: string | null | undefined
): Promise<DoublageSauvegarde> {
  const sauvegarde = await store.get(id.trim());
  if (!sauvegarde) {
    throw new DoublageSauvegardeIntrouvableError(id);
  }

  const estProprietaire =
    typeof demandeurId === "string" &&
    demandeurId.trim().length > 0 &&
    demandeurId.trim() === sauvegarde.utilisateurId;

  if (sauvegarde.visibilite === "PRIVEE" && !estProprietaire) {
    throw new DoublageSauvegardeAccesRefuseError(id);
  }

  return sauvegarde;
}

/**
 * Liste les sauvegardes d'un utilisateur (les siennes uniquement) — base de
 * l'« historique des doublages » (ST 6.2). Le contrôle d'accès est trivial ici
 * (on ne liste jamais que `demandeurId`), mais la fonction est fournie pour
 * que ST 6.2 s'y branche sans réintroduire de requête directe au store.
 */
export async function listerDoublagesSauvegardes(
  store: DoublageSauvegardeStore,
  demandeurId: string
): Promise<DoublageSauvegarde[]> {
  const proprietaire = demandeurId.trim();
  if (!proprietaire) return [];
  return store.listByUtilisateur(proprietaire);
}

/* -------------------------------------------------------------------------- */
/*  ST 6.2 — Historique des doublages                                          */
/* -------------------------------------------------------------------------- */

/**
 * Résumé d'un extrait d'origine (ST 1.1) tel qu'affiché sur une carte
 * d'historique. `null` partout si l'extrait est introuvable (retiré depuis).
 */
export interface ExtraitResumeHistorique {
  titre: string | null;
  thumbnail: string | null;
  origine: string | null;
  type: string | null;
}

/**
 * Résout le résumé d'un extrait par son id. Injecté (plutôt qu'un import direct
 * de `prisma`/`findExtraitById`) pour garder ce module testable sans base et
 * sans dépendance Prisma — même approche « delegate injecté » que le reste.
 */
export type ResolveExtraitResume = (
  extraitId: string
) => Promise<ExtraitResumeHistorique | null>;

/**
 * Charge une page de l'historique des doublages de `utilisateurId` — ST 6.2,
 * découpage en tâches : « Endpoint `GET /api/doublages?utilisateur=me` paginé ».
 *
 *  - ne renvoie **que** les sauvegardes du demandeur (le store filtre par
 *    `utilisateurId`, aucune fuite possible) ;
 *  - les plus récentes d'abord ;
 *  - chaque entrée est enrichie des métadonnées de l'extrait d'origine, résolues
 *    une seule fois par extrait distinct (un même extrait peut avoir été doublé
 *    plusieurs fois).
 *
 * `page` est bornée à `[1, totalPages]` : une page hors limite renvoie une
 * liste vide plutôt qu'une erreur (le composant de listing peut demander une
 * page devenue invalide après suppression).
 */
export async function chargerHistoriqueDoublages(
  store: DoublageSauvegardeStore,
  params: {
    utilisateurId: string;
    page: number;
    pageSize: number;
    resolveExtrait: ResolveExtraitResume;
  }
): Promise<DoublageHistoriqueResponse> {
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
  const cache = new Map<string, ExtraitResumeHistorique | null>();
  const items: DoublageHistoriqueItem[] = [];
  for (const row of rows) {
    if (!cache.has(row.extraitId)) {
      cache.set(row.extraitId, await resolveExtrait(row.extraitId).catch(() => null));
    }
    const extrait = cache.get(row.extraitId) ?? null;
    items.push({
      ...toDoublageSauvegardeView(row),
      extraitTitre: extrait?.titre ?? null,
      extraitThumbnail: extrait?.thumbnail ?? null,
      extraitOrigine: extrait?.origine ?? null,
      extraitType: extrait?.type ?? null,
    });
  }

  return { items, pagination: { page, pageSize, total, totalPages } };
}

/* -------------------------------------------------------------------------- */
/*  Projection vers la vue client                                              */
/* -------------------------------------------------------------------------- */

/** Réduit une entrée `Doublage` à la `DoublageSauvegardeView` renvoyée par l'API. */
export function toDoublageSauvegardeView(
  sauvegarde: DoublageSauvegarde
): DoublageSauvegardeView {
  return {
    id: sauvegarde.id,
    extraitId: sauvegarde.extraitId,
    fichierUrl: sauvegarde.fichierUrl,
    visibilite: sauvegarde.visibilite,
    dateCreation: sauvegarde.dateCreation,
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
