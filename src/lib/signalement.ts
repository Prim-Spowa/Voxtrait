/**
 * Orchestration serveur du signalement de contenu — ST 7.1 « Signalement de
 * contenu » (US 7.1 : signaler un extrait ou un doublage problématique).
 *
 * Découpage en tâches ST 7.1 :
 *  1. Modéliser `Signalement`
 *       → `prisma/schema.prisma` (enums `TypeContenuSignale` / `StatutSignalement`
 *         + modèle `Signalement`)
 *       → `Signalement` + `SignalementStore` (ce module)
 *  2. Endpoint de création de signalement avec motif obligatoire
 *       → `src/app/api/signalements/route.ts` + `creerSignalement` (ce module) ;
 *         la validation du motif est faite par `parseSignalementPayload`
 *         (`src/lib/signalementClient.ts`), ré-appliquée ici en garde-fou.
 *  3. Bouton/action « signaler » sur les composants de lecture
 *       → `src/components/SignalerButton.tsx`
 *
 * Choix techniques (ST 7.1) :
 *  - **Signalement ouvert aux visiteurs non connectés** (cf. cahier des charges
 *    §3-4) : `auteurId` optionnel. Le rate limiting par IP (côté endpoint,
 *    `src/lib/rateLimit.ts`) remplace l'authentification comme garde-fou
 *    anti-abus.
 *  - **Pattern « delegate injecté »** comme le reste du projet
 *    (`DoublageSauvegardeStore`, ST 6.1) : ce module fournit le contrat et la
 *    logique, testables sans base ; une implémentation en mémoire sert la CI et
 *    le mode `DATA_SOURCE=mock`, l'adaptateur Prisma
 *    (`src/lib/mocks/signalement.mock.ts`) branche `prisma.signalement`.
 *
 * Rappel : après ajout du modèle `Signalement` au schéma, régénérer le client
 * Prisma (`npm run prisma:generate`) — cf. note dans le README.
 */

import {
  parseSignalementPayload,
  type SignalementPayload,
  type SignalementView,
  type TypeContenuSignale,
} from "@/lib/signalementClient";

/* -------------------------------------------------------------------------- */
/*  Entité et store                                                            */
/* -------------------------------------------------------------------------- */

/** Statut d'un signalement — reflète l'enum Prisma `StatutSignalement`. */
export type StatutSignalement = "EN_ATTENTE" | "RETENU" | "REJETE";

/** Entrée `Signalement` telle que persistée — reflète le modèle Prisma. */
export interface Signalement {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  motif: string;
  /** Compte à l'origine du signalement, ou `null` (visiteur non connecté). */
  auteurId: string | null;
  statut: StatutSignalement;
  /** Date de création, ISO 8601. */
  dateCreation: string;
}

/** Données nécessaires à la création d'une entrée. */
export interface CreerSignalementInput {
  contenuType: TypeContenuSignale;
  contenuId: string;
  motif: string;
  auteurId?: string | null;
}

/** Critères de lecture de la file de modération (ST 7.2). */
export interface ListerSignalementsOptions {
  /** Filtre par statut (`EN_ATTENTE` par défaut côté dashboard). */
  statut?: StatutSignalement;
  /** Ordre sur `dateCreation` : `asc` = les plus anciens d'abord (défaut file). */
  ordre?: "asc" | "desc";
  skip?: number;
  take?: number;
}

/**
 * Sous-ensemble d'un store d'entrées `Signalement`.
 *
 * ST 7.1 n'utilisait que `create` / `count` (« la lecture de la file relève du
 * dashboard de modération, ST 7.2 »). ST 7.2 ajoute la lecture paginée
 * (`page`), l'accès unitaire (`get`), la transition de statut (`setStatut`) et
 * le regroupement par contenu (`countPourContenu`) — toutes implémentées à la
 * fois par le store en mémoire (ci-dessous) et par l'adaptateur Prisma
 * (`src/lib/mocks/signalement.mock.ts`).
 */
export interface SignalementStore {
  create(input: CreerSignalementInput): Promise<Signalement>;
  /** Total d'entrées — utilisé par les tests. */
  count(): Promise<number>;
  /** Page de signalements filtrée/triée + total correspondant au filtre (ST 7.2). */
  page(
    options: ListerSignalementsOptions
  ): Promise<{ items: Signalement[]; total: number }>;
  /** Signalement par id, ou `null` (ST 7.2). */
  get(id: string): Promise<Signalement | null>;
  /** Applique un nouveau statut et renvoie l'entrée mise à jour (ST 7.2). */
  setStatut(id: string, statut: StatutSignalement): Promise<Signalement>;
  /** Nombre de signalements visant un contenu donné, filtrable par statut (ST 7.2). */
  countPourContenu(
    contenuType: TypeContenuSignale,
    contenuId: string,
    statut?: StatutSignalement
  ): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/*  Store en mémoire                                                           */
/* -------------------------------------------------------------------------- */

function genererId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `signalement-${crypto.randomUUID()}`;
  }
  return `signalement-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `SignalementStore` — perdue au redémarrage du
 * process. Même réserve « multi-instances » que les autres stores in-memory du
 * projet (ST 3.1 / 6.1). Suffisant pour `next dev` et les tests.
 */
export function createInMemorySignalementStore(
  now: () => Date = () => new Date()
): SignalementStore {
  const rows: Signalement[] = [];

  return {
    async create(input) {
      const row: Signalement = {
        id: genererId(),
        contenuType: input.contenuType,
        contenuId: input.contenuId,
        motif: input.motif,
        auteurId: input.auteurId ?? null,
        statut: "EN_ATTENTE",
        dateCreation: now().toISOString(),
      };
      rows.push(row);
      return { ...row };
    },

    async count() {
      return rows.length;
    },

    async page({ statut, ordre = "asc", skip = 0, take }) {
      const filtres = rows.filter((row) => !statut || row.statut === statut);
      const tries = [...filtres].sort((a, b) => {
        const cmp = a.dateCreation.localeCompare(b.dateCreation) || a.id.localeCompare(b.id);
        return ordre === "asc" ? cmp : -cmp;
      });
      const fin = take === undefined ? tries.length : skip + take;
      return { items: tries.slice(skip, fin).map((row) => ({ ...row })), total: filtres.length };
    },

    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },

    async setStatut(id, statut) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        throw Object.assign(new Error(`Signalement introuvable : ${id}`), { code: "P2025" });
      }
      row.statut = statut;
      return { ...row };
    },

    async countPourContenu(contenuType, contenuId, statut) {
      return rows.filter(
        (row) =>
          row.contenuType === contenuType &&
          row.contenuId === contenuId &&
          (!statut || row.statut === statut)
      ).length;
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre un signalement — ST 7.1, tâche 2.
 *
 * `payload` est soit déjà validé (`SignalementPayload`), soit un corps brut
 * (`unknown`) qui sera passé à `parseSignalementPayload` : dans les deux cas le
 * motif obligatoire et les bornes sont garantis avant l'écriture (garde-fou si
 * un appelant contourne la validation de l'endpoint).
 *
 * Le signalement est créé au statut `EN_ATTENTE` (ST 7.1). Le traitement
 * (retrait / rejet) relève de ST 7.2.
 *
 * @throws SignalementPayloadError si `payload` est un corps brut invalide.
 */
export async function creerSignalement(
  store: SignalementStore,
  payload: SignalementPayload | unknown,
  options: { auteurId?: string | null } = {}
): Promise<Signalement> {
  const valide = looksLikePayload(payload)
    ? normaliserPayload(payload)
    : parseSignalementPayload(payload);

  const auteurId = options.auteurId?.trim() || null;

  return store.create({
    contenuType: valide.contenuType,
    contenuId: valide.contenuId,
    motif: valide.motif,
    auteurId,
  });
}

/**
 * `true` si l'objet a la forme d'un `SignalementPayload` déjà validé. On
 * revalide malgré tout via `normaliserPayload` (trim + bornes) : le typage ne
 * garantit rien à l'exécution.
 */
function looksLikePayload(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "contenuType" in value &&
    "contenuId" in value &&
    "motif" in value
  );
}

/** Re-passe un objet de forme `SignalementPayload` par la validation stricte. */
function normaliserPayload(value: Record<string, unknown>): SignalementPayload {
  return parseSignalementPayload(value);
}

/* -------------------------------------------------------------------------- */
/*  Projection vers la vue client                                              */
/* -------------------------------------------------------------------------- */

/**
 * Réduit une entrée `Signalement` à la `SignalementView` renvoyée par l'API.
 * On n'expose **ni le motif ni l'auteur** : ce sont des données internes à la
 * modération (ST 7.2), inutiles au client qui vient de soumettre.
 */
export function toSignalementView(signalement: Signalement): SignalementView {
  return {
    id: signalement.id,
    contenuType: signalement.contenuType,
    contenuId: signalement.contenuId,
    statut: signalement.statut,
    dateCreation: signalement.dateCreation,
  };
}
