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

/**
 * Sous-ensemble d'un store d'entrées `Signalement`. Volontairement réduit à ce
 * dont ST 7.1 a besoin (`create`) ; la lecture de la file relève du dashboard
 * de modération (ST 7.2).
 */
export interface SignalementStore {
  create(input: CreerSignalementInput): Promise<Signalement>;
  /** Total d'entrées — utilisé par les tests. */
  count(): Promise<number>;
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
