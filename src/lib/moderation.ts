/**
 * Orchestration serveur du dashboard de modération — ST 7.2 « Dashboard de
 * modération » (US 7.2 : traiter les signalements par revue manuelle).
 *
 * Découpage en tâches ST 7.2 :
 *  1. Rôle utilisateur (`utilisateur` / `moderateur` / `admin`)
 *       → `prisma/schema.prisma` (enum `RoleUtilisateur`) + `src/lib/authz.ts`
 *  2. Endpoint de listing des signalements en attente (protégé par rôle)
 *       → `listerFileModeration` (ce module) + `GET /api/admin/moderation`
 *  3. Actions : rejeter, retirer le contenu, suspendre le compte
 *       → `rejeterSignalement` / `retirerContenuSignale` / `suspendreCompte`
 *         (ce module) + `POST /api/admin/moderation`
 *  4. Journalisation des décisions (traçabilité)
 *       → `DecisionModerationStore` + une écriture systématique dans chaque
 *         cas d'usage ci-dessous
 *
 * Choix techniques (ST 7.2) :
 *  - **Pattern « delegate injecté »** comme le reste du projet : ce module ne
 *    dépend ni de Prisma ni de Next. Il reçoit un `SignalementStore` (étendu en
 *    ST 7.2, cf. `src/lib/signalement.ts`), un `DecisionModerationStore` et un
 *    `ContenuModerationGateway` (mutations de contenu / compte). Les adaptateurs
 *    Prisma vivent dans `src/lib/mocks/moderation.mock.ts`.
 *  - **Une action = une transition + une décision journalisée**, dans cet
 *    ordre : on n'écrit la décision qu'après la mutation réussie, pour ne pas
 *    laisser de trace d'une action qui a échoué.
 *  - **Seul un signalement `EN_ATTENTE` est actionnable** : re-traiter un
 *    signalement déjà `RETENU` / `REJETE` lève `SignalementDejaTraiteError`
 *    (évite les doubles retraits sur un rafraîchissement de page tardif).
 *
 * ⚠️ Périmètre — la **suppression** de compte évoquée dans la story n'est pas
 * implémentée (geste destructif et irréversible : cf. notes de dev). Seule la
 * **suspension** (`statut = SUSPENDU`, réversible) l'est.
 */

import type { RoleUtilisateur } from "@/lib/authz";
import type {
  DecisionModerationView,
  FileModerationResponse,
  SignalementModereView,
  TriFileModeration,
} from "@/lib/moderationClient";

import type { StatutSignalement, TypeContenuSignale } from "@/lib/signalementClient";
import type { Signalement, SignalementStore } from "@/lib/signalement";

/**
 * Type d'action journalisée — miroir de l'enum Prisma `ActionModeration`
 * (distinct de l'`ActionModeration` *UI* de `moderationClient.ts`, qui décrit
 * le geste du modérateur : `REJETER` / `RETIRER_CONTENU` / `SUSPENDRE_COMPTE`).
 */
export type ActionJournalisee = DecisionModerationView["action"];

/* -------------------------------------------------------------------------- */
/*  Erreurs                                                                    */
/* -------------------------------------------------------------------------- */

/** Signalement `:id` inexistant — mène à un `404`. */
export class SignalementIntrouvableError extends Error {
  constructor(id: string) {
    super(`Signalement introuvable : ${id}`);
    this.name = "SignalementIntrouvableError";
  }
}

/** Le signalement a déjà été traité (`RETENU` / `REJETE`) — mène à un `409`. */
export class SignalementDejaTraiteError extends Error {
  readonly statut: StatutSignalement;
  constructor(id: string, statut: StatutSignalement) {
    super(`Le signalement ${id} a déjà été traité (statut ${statut}).`);
    this.name = "SignalementDejaTraiteError";
    this.statut = statut;
  }
}

/** Le contenu visé par un retrait n'existe pas / plus — mène à un `404`. */
export class ContenuModereIntrouvableError extends Error {
  constructor(type: TypeContenuSignale, id: string) {
    super(`Contenu ${type} introuvable : ${id}`);
    this.name = "ContenuModereIntrouvableError";
  }
}

/** Le compte visé par une suspension n'existe pas — mène à un `404`. */
export class CompteModereIntrouvableError extends Error {
  constructor(id: string) {
    super(`Compte introuvable : ${id}`);
    this.name = "CompteModereIntrouvableError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Stores & gateway (delegates injectés)                                      */
/* -------------------------------------------------------------------------- */

/** Décision de modération telle que persistée — reflète le modèle Prisma. */
export interface DecisionModeration {
  id: string;
  action: ActionJournalisee;
  moderateurId: string | null;
  signalementId: string | null;
  contenuType: TypeContenuSignale | null;
  contenuId: string | null;
  compteCibleId: string | null;
  /** Demande de retrait à l'origine (ST 7.3, action `RETRAIT_AYANT_DROIT`). */
  demandeRetraitId: string | null;
  commentaire: string | null;
  /** Date de création, ISO 8601. */
  dateCreation: string;
}

export interface CreerDecisionInput {
  action: ActionJournalisee;
  moderateurId: string | null;
  signalementId?: string | null;
  contenuType?: TypeContenuSignale | null;
  contenuId?: string | null;
  compteCibleId?: string | null;
  demandeRetraitId?: string | null;
  commentaire?: string | null;
}

/** Journal append-only des décisions de modération (ST 7.2, tâche 4). */
export interface DecisionModerationStore {
  create(input: CreerDecisionInput): Promise<DecisionModeration>;
  /** Page du journal, les plus récentes d'abord, + total. */
  page(pagination: {
    skip: number;
    take: number;
  }): Promise<{ items: DecisionModeration[]; total: number }>;
}

/**
 * Statut de retrait appliqué à un contenu.
 *  - `RETRAIT_MODERATION` : retrait décidé par la modération (ST 7.2) ;
 *  - `RETRAIT_AYANT_DROIT` : retrait sur demande d'un ayant droit (ST 7.3).
 * Les deux valeurs existent dans l'enum Prisma `StatutModeration`.
 */
export type StatutRetraitContenu = "RETRAIT_MODERATION" | "RETRAIT_AYANT_DROIT";

/**
 * Mutations de contenu / compte déclenchées par une décision de modération.
 * Chaque méthode renvoie `false` si la cible n'existe pas (→ `404` côté
 * endpoint), `true` si l'état a été appliqué (idempotent : retirer un contenu
 * déjà retiré renvoie `true`).
 *
 * `statutCible` (ST 7.3) précise le motif du retrait ; il vaut
 * `RETRAIT_MODERATION` par défaut, ce qui préserve le comportement de ST 7.2.
 */
export interface ContenuModerationGateway {
  retirerExtrait(
    id: string,
    statutCible?: StatutRetraitContenu
  ): Promise<boolean>;
  retirerDoublage(
    id: string,
    statutCible?: StatutRetraitContenu
  ): Promise<boolean>;
  suspendreCompte(id: string): Promise<boolean>;
}

/**
 * Retire un contenu (`EXTRAIT` ou `DOUBLAGE`) via le gateway, en routant sur la
 * bonne méthode selon le type. Partagé par le retrait de modération (ST 7.2) et
 * le retrait ayant droit (ST 7.3).
 */
export function retirerContenuViaGateway(
  gateway: ContenuModerationGateway,
  contenuType: TypeContenuSignale,
  contenuId: string,
  statutCible: StatutRetraitContenu
): Promise<boolean> {
  return contenuType === "EXTRAIT"
    ? gateway.retirerExtrait(contenuId, statutCible)
    : gateway.retirerDoublage(contenuId, statutCible);
}

/* -------------------------------------------------------------------------- */
/*  Journal — store en mémoire                                                 */
/* -------------------------------------------------------------------------- */

function genererId(prefixe: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefixe}-${crypto.randomUUID()}`;
  }
  return `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `DecisionModerationStore` en mémoire — perdu au redémarrage du process (même
 * réserve « multi-instances » que les autres stores in-memory du projet).
 * Suffisant pour `next dev` et les tests.
 */
export function createInMemoryDecisionModerationStore(
  now: () => Date = () => new Date()
): DecisionModerationStore {
  const rows: DecisionModeration[] = [];

  return {
    async create(input) {
      const row: DecisionModeration = {
        id: genererId("decision"),
        action: input.action,
        moderateurId: input.moderateurId ?? null,
        signalementId: input.signalementId ?? null,
        contenuType: input.contenuType ?? null,
        contenuId: input.contenuId ?? null,
        compteCibleId: input.compteCibleId ?? null,
        demandeRetraitId: input.demandeRetraitId ?? null,
        commentaire: input.commentaire ?? null,
        dateCreation: now().toISOString(),
      };
      rows.push(row);
      return { ...row };
    },
    async page({ skip, take }) {
      const tries = [...rows].sort(
        (a, b) =>
          b.dateCreation.localeCompare(a.dateCreation) || b.id.localeCompare(a.id)
      );
      return { items: tries.slice(skip, skip + take).map((r) => ({ ...r })), total: rows.length };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 2 : lecture de la file                                 */
/* -------------------------------------------------------------------------- */

const TRI_VERS_ORDRE: Record<TriFileModeration, "asc" | "desc"> = {
  ANCIENNETE: "asc",
  RECENCE: "desc",
};

/**
 * Charge une page de la file de modération — ST 7.2, tâche 2.
 *
 *  - filtre par `statut` (défaut appliqué par le parseur : `EN_ATTENTE`) ;
 *  - tri par ancienneté (défaut) ou récence ;
 *  - chaque entrée est enrichie du **nombre total de signalements visant le
 *    même contenu** (regroupement, ST 7.2 : « regrouper les signalements
 *    visant un même contenu »), résolu une fois par contenu distinct de la page.
 *
 * `page` est bornée à `[1, totalPages]` : une page hors limite renvoie une
 * liste vide (le dashboard peut demander une page devenue invalide).
 */
export async function listerFileModeration(
  store: SignalementStore,
  params: {
    statut: StatutSignalement;
    tri: TriFileModeration;
    page: number;
    pageSize: number;
  }
): Promise<FileModerationResponse> {
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const ordre = TRI_VERS_ORDRE[params.tri];

  const { total } = await store.page({ statut: params.statut, ordre, skip: 0, take: 0 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(params.page)), totalPages);

  const { items: rows } = await store.page({
    statut: params.statut,
    ordre,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const compteParContenu = new Map<string, number>();
  const items: SignalementModereView[] = [];
  for (const row of rows) {
    const cle = `${row.contenuType}:${row.contenuId}`;
    if (!compteParContenu.has(cle)) {
      compteParContenu.set(
        cle,
        await store.countPourContenu(row.contenuType, row.contenuId)
      );
    }
    items.push(toSignalementModereView(row, compteParContenu.get(cle) ?? 1));
  }

  return { items, pagination: { page, pageSize, total, totalPages } };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 3 : actions de modération                              */
/* -------------------------------------------------------------------------- */

interface ContexteDecision {
  moderateurId: string | null;
  commentaire?: string | null;
}

/** Charge un signalement `EN_ATTENTE` ou lève l'erreur adaptée. */
async function chargerSignalementActionnable(
  store: SignalementStore,
  signalementId: string
): Promise<Signalement> {
  const signalement = await store.get(signalementId);
  if (!signalement) throw new SignalementIntrouvableError(signalementId);
  if (signalement.statut !== "EN_ATTENTE") {
    throw new SignalementDejaTraiteError(signalementId, signalement.statut);
  }
  return signalement;
}

export interface ResultatAction {
  decision: DecisionModeration;
  signalement: SignalementModereView | null;
}

/**
 * Rejette un signalement infondé — ST 7.2, tâche 3 (« rejeter signalement »).
 * Statut `EN_ATTENTE` → `REJETE`, aucun impact sur le contenu / le compte, une
 * décision `REJET_SIGNALEMENT` est journalisée.
 */
export async function rejeterSignalement(
  stores: { signalements: SignalementStore; decisions: DecisionModerationStore },
  params: { signalementId: string } & ContexteDecision
): Promise<ResultatAction> {
  const signalement = await chargerSignalementActionnable(
    stores.signalements,
    params.signalementId
  );

  const misAJour = await stores.signalements.setStatut(signalement.id, "REJETE");
  const decision = await stores.decisions.create({
    action: "REJET_SIGNALEMENT",
    moderateurId: params.moderateurId,
    signalementId: signalement.id,
    contenuType: signalement.contenuType,
    contenuId: signalement.contenuId,
    commentaire: params.commentaire,
  });

  return { decision, signalement: toSignalementModereView(misAJour, 0) };
}

/**
 * Retire le contenu visé par un signalement fondé — ST 7.2, tâche 3
 * (« retirer contenu (changement de statut `Extrait`/`Doublage`) »).
 *
 * Le contenu passe à `RETRAIT_MODERATION` via le `ContenuModerationGateway`
 * (selon `contenuType`), le signalement passe `RETENU`, une décision
 * `RETRAIT_CONTENU` est journalisée.
 *
 * @throws {ContenuModereIntrouvableError} si la cible n'existe pas (le
 *         signalement **reste `EN_ATTENTE`** : on n'a rien retiré).
 */
export async function retirerContenuSignale(
  stores: { signalements: SignalementStore; decisions: DecisionModerationStore },
  gateway: ContenuModerationGateway,
  params: { signalementId: string } & ContexteDecision
): Promise<ResultatAction> {
  const signalement = await chargerSignalementActionnable(
    stores.signalements,
    params.signalementId
  );

  const retire = await retirerContenuViaGateway(
    gateway,
    signalement.contenuType,
    signalement.contenuId,
    "RETRAIT_MODERATION"
  );
  if (!retire) {
    throw new ContenuModereIntrouvableError(
      signalement.contenuType,
      signalement.contenuId
    );
  }

  const misAJour = await stores.signalements.setStatut(signalement.id, "RETENU");
  const decision = await stores.decisions.create({
    action: "RETRAIT_CONTENU",
    moderateurId: params.moderateurId,
    signalementId: signalement.id,
    contenuType: signalement.contenuType,
    contenuId: signalement.contenuId,
    commentaire: params.commentaire,
  });

  return { decision, signalement: toSignalementModereView(misAJour, 0) };
}

/**
 * Suspend un compte — ST 7.2, tâche 3 (« suspendre/supprimer compte » ; seule
 * la suspension est implémentée, cf. tête de fichier).
 *
 * `statut = SUSPENDU` via le gateway. Si `signalementId` est fourni et que le
 * signalement est `EN_ATTENTE`, il passe `RETENU` (le geste vaut traitement).
 * Une décision `SUSPENSION_COMPTE` est journalisée dans tous les cas.
 *
 * @throws {CompteModereIntrouvableError} si le compte n'existe pas.
 */
export async function suspendreCompte(
  stores: { signalements: SignalementStore; decisions: DecisionModerationStore },
  gateway: ContenuModerationGateway,
  params: { compteCibleId: string; signalementId?: string | null } & ContexteDecision
): Promise<ResultatAction> {
  const suspendu = await gateway.suspendreCompte(params.compteCibleId);
  if (!suspendu) {
    throw new CompteModereIntrouvableError(params.compteCibleId);
  }

  let signalementView: SignalementModereView | null = null;
  const signalementId = params.signalementId?.trim() || null;
  if (signalementId) {
    const signalement = await stores.signalements.get(signalementId);
    if (!signalement) throw new SignalementIntrouvableError(signalementId);
    if (signalement.statut === "EN_ATTENTE") {
      signalementView = toSignalementModereView(
        await stores.signalements.setStatut(signalementId, "RETENU"),
        0
      );
    } else {
      signalementView = toSignalementModereView(signalement, 0);
    }
  }

  const decision = await stores.decisions.create({
    action: "SUSPENSION_COMPTE",
    moderateurId: params.moderateurId,
    signalementId,
    compteCibleId: params.compteCibleId,
    commentaire: params.commentaire,
  });

  return { decision, signalement: signalementView };
}

/* -------------------------------------------------------------------------- */
/*  Cas d'usage — tâche 4 : journal des décisions                              */
/* -------------------------------------------------------------------------- */

export interface JournalModerationResult {
  items: DecisionModerationView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/** Charge une page du journal des décisions, les plus récentes d'abord. */
export async function chargerJournalModeration(
  store: DecisionModerationStore,
  params: { page: number; pageSize: number }
): Promise<JournalModerationResult> {
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const { total } = await store.page({ skip: 0, take: 0 });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(params.page)), totalPages);

  const { items } = await store.page({ skip: (page - 1) * pageSize, take: pageSize });
  return {
    items: items.map(toDecisionModerationView),
    pagination: { page, pageSize, total, totalPages },
  };
}

/* -------------------------------------------------------------------------- */
/*  Projections vers les vues client                                           */
/* -------------------------------------------------------------------------- */

export function toSignalementModereView(
  signalement: Signalement,
  nombreSignalementsContenu: number
): SignalementModereView {
  return {
    id: signalement.id,
    contenuType: signalement.contenuType,
    contenuId: signalement.contenuId,
    motif: signalement.motif,
    auteurId: signalement.auteurId,
    statut: signalement.statut,
    dateCreation: signalement.dateCreation,
    nombreSignalementsContenu,
  };
}

export function toDecisionModerationView(
  decision: DecisionModeration
): DecisionModerationView {
  return {
    id: decision.id,
    action: decision.action,
    moderateurId: decision.moderateurId,
    signalementId: decision.signalementId,
    contenuType: decision.contenuType,
    contenuId: decision.contenuId,
    compteCibleId: decision.compteCibleId,
    demandeRetraitId: decision.demandeRetraitId,
    commentaire: decision.commentaire,
    dateCreation: decision.dateCreation,
  };
}

/** Ré-export pratique pour les consommateurs serveur. */
export type { RoleUtilisateur };
