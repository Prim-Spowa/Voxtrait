/**
 * Orchestration serveur de la procédure notice-and-takedown — ST 7.3
 * « Procédure notice-and-takedown » (US 7.3 : retirer un contenu sur demande
 * d'un ayant droit).
 *
 * Découpage en tâches ST 7.3 :
 *  1. Formulaire / point de contact « demande de retrait »
 *       → `prisma/schema.prisma` (modèle `DemandeRetrait` + enum
 *         `StatutDemandeRetrait`), `DemandeRetraitStore` (ce module),
 *         `creerDemandeRetrait` (ce module), `POST /api/demandes-retrait`,
 *         page `/demande-retrait` + `DemandeRetraitForm`.
 *  2. Statut `retrait_ayant_droit` distinct de `retrait_moderation`
 *       → valeur `RETRAIT_AYANT_DROIT` de `StatutModeration` (déjà au schéma,
 *         appliquée ici via `retirerContenuViaGateway(..., "RETRAIT_AYANT_DROIT")`)
 *         + valeur `RETRAIT_AYANT_DROIT` de `ActionModeration` (journal).
 *  3. Procédure documentée de traitement
 *       → `Claude output/procedure-notice-and-takedown.md` (livrable process)
 *         + rapport de délais (`genererRapportDelais` ici, endpoint
 *         `/api/admin/demandes-retrait/rapport`).
 *
 * Choix techniques (ST 7.3) :
 *  - **Réutilisation du workflow de retrait de ST 7.2** avec un statut distinct
 *    (story, « Choix techniques ») : `traiterDemandeRetrait` s'appuie sur le
 *    `ContenuModerationGateway` et le `DecisionModerationStore` de
 *    `src/lib/moderation.ts`, en passant `RETRAIT_AYANT_DROIT`. Aucune copie du
 *    code de mutation.
 *  - **Pattern « delegate injecté »** comme le reste du projet : ce module ne
 *    dépend ni de Prisma ni de Next. Adaptateurs dans
 *    `src/lib/mocks/demandeRetrait.mock.ts`.
 *  - **Une action = mutation puis journalisation** (même règle que ST 7.2) :
 *    pour `TRAITER`, on ne journalise la décision et on ne clôt la demande
 *    qu'après le retrait effectif du contenu.
 *  - **Seule une demande `EN_ATTENTE` est actionnable** : re-traiter une demande
 *    déjà close lève `DemandeRetraitDejaTraiteeError` (`409`).
 */

import {
  retirerContenuViaGateway,
  type ContenuModerationGateway,
  type DecisionModeration,
  type DecisionModerationStore,
} from "@/lib/moderation";
import {
  calculerRapportDelais,
  parseDemandeRetraitPayload,
  type ActionDemandeRetrait,
  type DemandeRetraitModereView,
  type DemandeRetraitPayload,
  type DemandeRetraitRecuView,
  type RapportDelaisTraitement,
  type StatutDemandeRetrait,
  type TriDemandesRetrait,
} from "@/lib/demandeRetraitClient";
import type { TypeContenuSignale } from "@/lib/signalementClient";

/* -------------------------------------------------------------------------- */
/*  Entité et store                                                            */
/* -------------------------------------------------------------------------- */

/** Entrée `DemandeRetrait` telle que persistée — reflète le modèle Prisma. */
export interface DemandeRetrait {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  oeuvre: string;
  demandeurNom: string;
  demandeurEmail: string;
  demandeurOrganisation: string | null;
  motif: string;
  declarationBonneFoi: boolean;
  statut: StatutDemandeRetrait;
  commentaireTraitement: string | null;
  traiteeParId: string | null;
  /** Date de création, ISO 8601. */
  dateCreation: string;
  /** Date de passage hors `EN_ATTENTE`, ISO 8601, ou `null`. */
  dateTraitement: string | null;
}

export interface CreerDemandeRetraitInput {
  contenuType: TypeContenuSignale;
  contenuId: string;
  oeuvre: string;
  demandeurNom: string;
  demandeurEmail: string;
  demandeurOrganisation?: string | null;
  motif: string;
  declarationBonneFoi: boolean;
}

export interface CloreDemandeRetraitInput {
  statut: Exclude<StatutDemandeRetrait, "EN_ATTENTE">;
  traiteeParId: string | null;
  commentaireTraitement: string | null;
  /** Horodatage de clôture (ISO 8601) — injecté pour des tests déterministes. */
  dateTraitement: string;
}

export interface ListerDemandesRetraitOptions {
  statut?: StatutDemandeRetrait;
  /** Ordre sur `dateCreation` : `asc` = les plus anciennes d'abord (défaut file). */
  ordre?: "asc" | "desc";
  skip?: number;
  take?: number;
}

/** Sous-ensemble d'un store d'entrées `DemandeRetrait`. */
export interface DemandeRetraitStore {
  create(input: CreerDemandeRetraitInput): Promise<DemandeRetrait>;
  count(): Promise<number>;
  /** Page filtrée/triée + total correspondant au filtre. */
  page(
    options: ListerDemandesRetraitOptions
  ): Promise<{ items: DemandeRetrait[]; total: number }>;
  /** Demande par id, ou `null`. */
  get(id: string): Promise<DemandeRetrait | null>;
  /** Clôt une demande (`TRAITEE` / `REJETEE`) et renvoie l'entrée mise à jour. */
  clore(id: string, input: CloreDemandeRetraitInput): Promise<DemandeRetrait>;
  /** Toutes les demandes (pour le rapport de délais). */
  all(): Promise<DemandeRetrait[]>;
}

/* -------------------------------------------------------------------------- */
/*  Erreurs                                                                    */
/* -------------------------------------------------------------------------- */

/** Demande `:id` inexistante — mène à un `404`. */
export class DemandeRetraitIntrouvableError extends Error {
  constructor(id: string) {
    super(`Demande de retrait introuvable : ${id}`);
    this.name = "DemandeRetraitIntrouvableError";
  }
}

/** La demande a déjà été close — mène à un `409`. */
export class DemandeRetraitDejaTraiteeError extends Error {
  readonly statut: StatutDemandeRetrait;
  constructor(id: string, statut: StatutDemandeRetrait) {
    super(`La demande ${id} a déjà été traitée (statut ${statut}).`);
    this.name = "DemandeRetraitDejaTraiteeError";
    this.statut = statut;
  }
}

/** Le contenu visé n'existe pas / plus — mène à un `404`. La demande reste ouverte. */
export class ContenuDemandeIntrouvableError extends Error {
  constructor(type: TypeContenuSignale, id: string) {
    super(`Contenu ${type} introuvable : ${id}`);
    this.name = "ContenuDemandeIntrouvableError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Store en mémoire                                                           */
/* -------------------------------------------------------------------------- */

function genererId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `demande-retrait-${crypto.randomUUID()}`;
  }
  return `demande-retrait-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `DemandeRetraitStore` — perdue au redémarrage du
 * process. Même réserve « multi-instances » que les autres stores in-memory du
 * projet (ST 3.1 / 6.1 / 7.1 / 7.2).
 */
export function createInMemoryDemandeRetraitStore(
  now: () => Date = () => new Date()
): DemandeRetraitStore {
  const rows: DemandeRetrait[] = [];

  return {
    async create(input) {
      const row: DemandeRetrait = {
        id: genererId(),
        contenuType: input.contenuType,
        contenuId: input.contenuId,
        oeuvre: input.oeuvre,
        demandeurNom: input.demandeurNom,
        demandeurEmail: input.demandeurEmail,
        demandeurOrganisation: input.demandeurOrganisation ?? null,
        motif: input.motif,
        declarationBonneFoi: input.declarationBonneFoi,
        statut: "EN_ATTENTE",
        commentaireTraitement: null,
        traiteeParId: null,
        dateCreation: now().toISOString(),
        dateTraitement: null,
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
        const cmp =
          a.dateCreation.localeCompare(b.dateCreation) || a.id.localeCompare(b.id);
        return ordre === "asc" ? cmp : -cmp;
      });
      const fin = take === undefined ? tries.length : skip + take;
      return {
        items: tries.slice(skip, fin).map((row) => ({ ...row })),
        total: filtres.length,
      };
    },

    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },

    async clore(id, input) {
      const row = rows.find((r) => r.id === id);
      if (!row) {
        throw Object.assign(new Error(`Demande de retrait introuvable : ${id}`), {
          code: "P2025",
        });
      }
      row.statut = input.statut;
      row.traiteeParId = input.traiteeParId;
      row.commentaireTraitement = input.commentaireTraitement;
      row.dateTraitement = input.dateTraitement;
      return { ...row };
    },

    async all() {
      return rows.map((row) => ({ ...row }));
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 1 : dépôt d'une demande                                */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre une demande de retrait — ST 7.3, tâche 1.
 *
 * `payload` est soit déjà validé (`DemandeRetraitPayload`), soit un corps brut
 * (`unknown`) repassé par `parseDemandeRetraitPayload` : dans les deux cas les
 * champs obligatoires, les bornes et la déclaration de bonne foi sont garantis
 * avant l'écriture.
 *
 * La demande est créée au statut `EN_ATTENTE`. Le traitement relève du
 * modérateur (`traiterDemandeRetrait` / `rejeterDemandeRetrait`).
 *
 * @throws {DemandeRetraitPayloadError} si `payload` est un corps brut invalide.
 */
export async function creerDemandeRetrait(
  store: DemandeRetraitStore,
  payload: DemandeRetraitPayload | unknown
): Promise<DemandeRetrait> {
  const valide = parseDemandeRetraitPayload(payload);
  return store.create({
    contenuType: valide.contenuType,
    contenuId: valide.contenuId,
    oeuvre: valide.oeuvre,
    demandeurNom: valide.demandeurNom,
    demandeurEmail: valide.demandeurEmail,
    demandeurOrganisation: valide.demandeurOrganisation,
    motif: valide.motif,
    declarationBonneFoi: valide.declarationBonneFoi,
  });
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — file de traitement                                           */
/* -------------------------------------------------------------------------- */

const ORDRE_PAR_TRI: Record<TriDemandesRetrait, "asc" | "desc"> = {
  ANCIENNETE: "asc",
  RECENCE: "desc",
};

export interface FileDemandesRetraitResult {
  items: DemandeRetraitModereView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/** Charge une page de la file des demandes de retrait — ST 7.3, tâche 1 (revue). */
export async function listerDemandesRetrait(
  store: DemandeRetraitStore,
  params: {
    statut: StatutDemandeRetrait;
    tri: TriDemandesRetrait;
    page: number;
    pageSize: number;
  }
): Promise<FileDemandesRetraitResult> {
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const ordre = ORDRE_PAR_TRI[params.tri];

  const { total } = await store.page({ statut: params.statut, ordre, skip: 0, take: 0 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(params.page)), totalPages);

  const { items } = await store.page({
    statut: params.statut,
    ordre,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    items: items.map(toDemandeRetraitModereView),
    pagination: { page, pageSize, total, totalPages },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 2 : traitement (statut dédié)                          */
/* -------------------------------------------------------------------------- */

interface ContexteTraitement {
  moderateurId: string | null;
  commentaire?: string | null;
  /** Horloge injectable — cohérence avec le reste du projet (tests). */
  now?: () => Date;
}

export interface ResultatActionDemande {
  demande: DemandeRetraitModereView;
  decision: DecisionModeration | null;
}

/** Charge une demande `EN_ATTENTE` ou lève l'erreur adaptée. */
async function chargerDemandeActionnable(
  store: DemandeRetraitStore,
  demandeId: string
): Promise<DemandeRetrait> {
  const demande = await store.get(demandeId);
  if (!demande) throw new DemandeRetraitIntrouvableError(demandeId);
  if (demande.statut !== "EN_ATTENTE") {
    throw new DemandeRetraitDejaTraiteeError(demandeId, demande.statut);
  }
  return demande;
}

/**
 * Traite une demande fondée — ST 7.3, tâche 2 (« statut `retrait_ayant_droit`
 * distinct de `retrait_moderation` »).
 *
 * Le contenu visé passe au statut `RETRAIT_AYANT_DROIT` via le
 * `ContenuModerationGateway` (workflow de ST 7.2, statut distinct), la demande
 * passe `TRAITEE` (horodatée), une décision `RETRAIT_AYANT_DROIT` est journalisée
 * dans le **même** journal que les décisions de ST 7.2 — rattachée à la demande
 * (`demandeRetraitId`) pour le reporting séparé des délais.
 *
 * @throws {ContenuDemandeIntrouvableError} si la cible n'existe pas (la demande
 *         **reste `EN_ATTENTE`** : rien n'a été retiré, rien n'a été journalisé).
 */
export async function traiterDemandeRetrait(
  stores: { demandes: DemandeRetraitStore; decisions: DecisionModerationStore },
  gateway: ContenuModerationGateway,
  params: { demandeId: string } & ContexteTraitement
): Promise<ResultatActionDemande> {
  const demande = await chargerDemandeActionnable(stores.demandes, params.demandeId);
  const now = params.now ?? (() => new Date());

  const retire = await retirerContenuViaGateway(
    gateway,
    demande.contenuType,
    demande.contenuId,
    "RETRAIT_AYANT_DROIT"
  );
  if (!retire) {
    throw new ContenuDemandeIntrouvableError(demande.contenuType, demande.contenuId);
  }

  const decision = await stores.decisions.create({
    action: "RETRAIT_AYANT_DROIT",
    moderateurId: params.moderateurId,
    contenuType: demande.contenuType,
    contenuId: demande.contenuId,
    demandeRetraitId: demande.id,
    commentaire: params.commentaire ?? null,
  });

  const close = await stores.demandes.clore(demande.id, {
    statut: "TRAITEE",
    traiteeParId: params.moderateurId,
    commentaireTraitement: params.commentaire?.trim() || null,
    dateTraitement: now().toISOString(),
  });

  return { demande: toDemandeRetraitModereView(close), decision };
}

/**
 * Rejette une demande — ST 7.3, tâche 2 (autre issue : contenu déjà absent,
 * demande hors périmètre ou manifestement infondée).
 *
 * La demande passe `REJETEE` (horodatée) ; **aucun** contenu n'est retiré et
 * **aucune** décision de modération n'est journalisée (le journal ne trace que
 * les actions sur le contenu). La motivation est portée par
 * `commentaireTraitement` de la demande — vivement recommandée ici.
 */
export async function rejeterDemandeRetrait(
  store: DemandeRetraitStore,
  params: { demandeId: string } & ContexteTraitement
): Promise<ResultatActionDemande> {
  const demande = await chargerDemandeActionnable(store, params.demandeId);
  const now = params.now ?? (() => new Date());

  const close = await store.clore(demande.id, {
    statut: "REJETEE",
    traiteeParId: params.moderateurId,
    commentaireTraitement: params.commentaire?.trim() || null,
    dateTraitement: now().toISOString(),
  });

  return { demande: toDemandeRetraitModereView(close), decision: null };
}

/** Applique l'action `TRAITER` / `REJETER` — aiguillage pour l'endpoint. */
export async function appliquerActionDemandeRetrait(
  stores: { demandes: DemandeRetraitStore; decisions: DecisionModerationStore },
  gateway: ContenuModerationGateway,
  params: { action: ActionDemandeRetrait; demandeId: string } & ContexteTraitement
): Promise<ResultatActionDemande> {
  if (params.action === "TRAITER") {
    return traiterDemandeRetrait(stores, gateway, params);
  }
  return rejeterDemandeRetrait(stores.demandes, params);
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 3 : rapport des délais de traitement                   */
/* -------------------------------------------------------------------------- */

/**
 * Produit le rapport des délais de traitement des demandes de retrait — base du
 * suivi exigé par la procédure notice-and-takedown (ST 7.3, « Points
 * d'attention » : justifier les délais de traitement).
 */
export async function genererRapportDelais(
  store: DemandeRetraitStore,
  maintenant: Date = new Date()
): Promise<RapportDelaisTraitement> {
  const demandes = await store.all();
  return calculerRapportDelais(
    demandes.map((d) => ({
      statut: d.statut,
      dateCreation: d.dateCreation,
      dateTraitement: d.dateTraitement,
    })),
    maintenant
  );
}

/* -------------------------------------------------------------------------- */
/*  Projections vers les vues client                                           */
/* -------------------------------------------------------------------------- */

const MS_PAR_HEURE = 3_600_000;

/** Vue « demandeur » : accusé de réception, sans données personnelles réexposées. */
export function toDemandeRetraitRecuView(
  demande: DemandeRetrait
): DemandeRetraitRecuView {
  return {
    id: demande.id,
    contenuType: demande.contenuType,
    contenuId: demande.contenuId,
    statut: demande.statut,
    dateCreation: demande.dateCreation,
  };
}

/** Vue « modérateur » : tout ce qui est nécessaire à la décision + délai calculé. */
export function toDemandeRetraitModereView(
  demande: DemandeRetrait
): DemandeRetraitModereView {
  let delaiTraitementHeures: number | null = null;
  if (demande.dateTraitement) {
    const creeMs = Date.parse(demande.dateCreation);
    const traiteMs = Date.parse(demande.dateTraitement);
    if (Number.isFinite(creeMs) && Number.isFinite(traiteMs)) {
      delaiTraitementHeures =
        Math.round((Math.max(0, traiteMs - creeMs) / MS_PAR_HEURE) * 10) / 10;
    }
  }

  return {
    id: demande.id,
    contenuType: demande.contenuType,
    contenuId: demande.contenuId,
    oeuvre: demande.oeuvre,
    demandeurNom: demande.demandeurNom,
    demandeurEmail: demande.demandeurEmail,
    demandeurOrganisation: demande.demandeurOrganisation,
    motif: demande.motif,
    declarationBonneFoi: demande.declarationBonneFoi,
    statut: demande.statut,
    commentaireTraitement: demande.commentaireTraitement,
    traiteeParId: demande.traiteeParId,
    dateCreation: demande.dateCreation,
    dateTraitement: demande.dateTraitement,
    delaiTraitementHeures,
  };
}
