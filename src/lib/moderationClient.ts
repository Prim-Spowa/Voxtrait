/**
 * Logique client-safe du dashboard de modération — ST 7.2 « Dashboard de
 * modération » (US 7.2 : traiter les signalements par revue manuelle).
 *
 * Séparée de `lib/moderation.ts` (orchestration serveur : stores, adaptateurs
 * Prisma, mutations de contenu) pour être importable depuis le composant
 * `"use client"` du dashboard et depuis ses tests — même séparation que
 * `signalementClient.ts` vs `signalement.ts` (ST 7.1).
 *
 * Contient : les chemins, l'énumération des tris et des actions, la forme des
 * vues renvoyées par l'API, et le parsing/validation (fonctions pures) des
 * query params de la file et du corps d'une action.
 */

import type { StatutSignalement, TypeContenuSignale } from "@/lib/signalementClient";

export type { StatutSignalement, TypeContenuSignale };

/** Page d'administration (rendue côté serveur, réservée aux modérateurs). */
export const MODERATION_ADMIN_PATH = "/admin/moderation";

/** Endpoint REST du dashboard (file + actions). */
export const MODERATION_API_PATH = "/api/admin/moderation";

/** Endpoint de consultation du journal des décisions (traçabilité, ST 7.2 tâche 4). */
export const MODERATION_JOURNAL_API_PATH = "/api/admin/moderation/journal";

/* -------------------------------------------------------------------------- */
/*  File de modération — tri & pagination                                      */
/* -------------------------------------------------------------------------- */

/**
 * Tri de la file. `ANCIENNETE` (défaut) répond au point d'attention ST 7.2 :
 * « prévoir des filtres/tri par ancienneté … pour prioriser » — traiter les
 * signalements les plus vieux en premier borne le délai de traitement maximal.
 *
 * ⚠️ Le tri « par gravité » évoqué dans la story n'est **pas** implémenté :
 * aucune notion de gravité n'existe sur `Signalement` (le motif est un texte
 * libre, cf. ST 7.1). Ajouter une gravité nécessiterait soit une catégorie
 * structurée côté signalement, soit une pondération manuelle — signalé en
 * notes de dev comme évolution.
 */
export type TriFileModeration = "ANCIENNETE" | "RECENCE";

export const TRIS_FILE_MODERATION: readonly TriFileModeration[] = [
  "ANCIENNETE",
  "RECENCE",
];

export const STATUTS_SIGNALEMENT: readonly StatutSignalement[] = [
  "EN_ATTENTE",
  "RETENU",
  "REJETE",
];

export const FILE_MODERATION_PAGE_SIZE_DEFAUT = 20;
export const FILE_MODERATION_PAGE_SIZE_MAX = 100;

export interface FileModerationQuery {
  statut: StatutSignalement;
  tri: TriFileModeration;
  page: number;
  pageSize: number;
}

/** Levée par `parseFileModerationQuery` sur un paramètre fourni mais invalide. */
export class FileModerationQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileModerationQueryError";
  }
}

function parseEntierPositif(
  raw: string | null,
  nom: string,
  defaut: number
): number {
  if (raw === null || raw.trim() === "") return defaut;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new FileModerationQueryError(
      `Paramètre « ${nom} » invalide : « ${raw} ». Entier ≥ 1 attendu.`
    );
  }
  return n;
}

/**
 * Parse les query params de `GET /api/admin/moderation`.
 *  - `statut` : défaut `EN_ATTENTE` (la file de travail) ;
 *  - `tri` : défaut `ANCIENNETE` ;
 *  - `page` / `pageSize` : défaut 1 / 20, `pageSize` plafonné à 100.
 */
export function parseFileModerationQuery(
  searchParams: URLSearchParams
): FileModerationQuery {
  const statutRaw = searchParams.get("statut");
  let statut: StatutSignalement = "EN_ATTENTE";
  if (statutRaw) {
    if (!(STATUTS_SIGNALEMENT as readonly string[]).includes(statutRaw)) {
      throw new FileModerationQueryError(
        `Paramètre « statut » invalide : « ${statutRaw} ».`
      );
    }
    statut = statutRaw as StatutSignalement;
  }

  const triRaw = searchParams.get("tri");
  let tri: TriFileModeration = "ANCIENNETE";
  if (triRaw) {
    if (!(TRIS_FILE_MODERATION as readonly string[]).includes(triRaw)) {
      throw new FileModerationQueryError(`Paramètre « tri » invalide : « ${triRaw} ».`);
    }
    tri = triRaw as TriFileModeration;
  }

  const page = parseEntierPositif(searchParams.get("page"), "page", 1);
  const pageSize = Math.min(
    parseEntierPositif(
      searchParams.get("pageSize"),
      "pageSize",
      FILE_MODERATION_PAGE_SIZE_DEFAUT
    ),
    FILE_MODERATION_PAGE_SIZE_MAX
  );

  return { statut, tri, page, pageSize };
}

/* -------------------------------------------------------------------------- */
/*  Actions de modération                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Action déclenchée par un modérateur depuis le dashboard.
 *  - `REJETER` : le signalement est infondé → statut `REJETE`, aucun impact
 *    sur le contenu ni le compte ;
 *  - `RETIRER_CONTENU` : le signalement est fondé → le contenu visé passe au
 *    statut `RETRAIT_MODERATION`, le signalement passe `RETENU` ;
 *  - `SUSPENDRE_COMPTE` : sanctionne le compte visé (`compteCibleId`) →
 *    `statut = SUSPENDU` ; si un `signalementId` est fourni, il passe `RETENU`.
 */
export type ActionModeration = "REJETER" | "RETIRER_CONTENU" | "SUSPENDRE_COMPTE";

export const ACTIONS_MODERATION: readonly ActionModeration[] = [
  "REJETER",
  "RETIRER_CONTENU",
  "SUSPENDRE_COMPTE",
];

/** Longueur maximale du commentaire libre du modérateur. */
export const COMMENTAIRE_MODERATION_MAX_LENGTH = 2000;

export interface ActionModerationPayload {
  action: ActionModeration;
  /** Signalement traité — requis pour `REJETER` et `RETIRER_CONTENU`. */
  signalementId?: string;
  /** Compte sanctionné — requis pour `SUSPENDRE_COMPTE`. */
  compteCibleId?: string;
  /** Motivation de la décision (journalisée). Optionnel. */
  commentaire?: string;
}

/** Levée par `parseActionModerationPayload` — traduite en `400` par l'endpoint. */
export class ActionModerationError extends Error {
  readonly field?: "action" | "signalementId" | "compteCibleId" | "commentaire";
  constructor(message: string, field?: ActionModerationError["field"]) {
    super(message);
    this.name = "ActionModerationError";
    this.field = field;
  }
}

/**
 * Parse et valide le corps de `POST /api/admin/moderation`.
 *
 *  - `action` obligatoire, dans `ACTIONS_MODERATION` ;
 *  - `signalementId` obligatoire pour `REJETER` / `RETIRER_CONTENU` ;
 *  - `compteCibleId` obligatoire pour `SUSPENDRE_COMPTE` ;
 *  - `commentaire` optionnel, ≤ `COMMENTAIRE_MODERATION_MAX_LENGTH` (trimé).
 */
export function parseActionModerationPayload(body: unknown): ActionModerationPayload {
  if (typeof body !== "object" || body === null) {
    throw new ActionModerationError("Corps de requête invalide.");
  }
  const { action, signalementId, compteCibleId, commentaire } = body as Record<
    string,
    unknown
  >;

  if (
    typeof action !== "string" ||
    !(ACTIONS_MODERATION as readonly string[]).includes(action)
  ) {
    throw new ActionModerationError(
      `Le champ « action » doit valoir ${ACTIONS_MODERATION.join(", ")}.`,
      "action"
    );
  }
  const actionValide = action as ActionModeration;

  const besoinSignalement =
    actionValide === "REJETER" || actionValide === "RETIRER_CONTENU";
  let signalementIdValide: string | undefined;
  if (besoinSignalement) {
    if (typeof signalementId !== "string" || signalementId.trim() === "") {
      throw new ActionModerationError(
        "Le champ « signalementId » est requis pour cette action.",
        "signalementId"
      );
    }
    signalementIdValide = signalementId.trim();
  } else if (typeof signalementId === "string" && signalementId.trim() !== "") {
    signalementIdValide = signalementId.trim();
  }

  let compteCibleIdValide: string | undefined;
  if (actionValide === "SUSPENDRE_COMPTE") {
    if (typeof compteCibleId !== "string" || compteCibleId.trim() === "") {
      throw new ActionModerationError(
        "Le champ « compteCibleId » est requis pour suspendre un compte.",
        "compteCibleId"
      );
    }
    compteCibleIdValide = compteCibleId.trim();
  }

  let commentaireValide: string | undefined;
  if (commentaire !== undefined && commentaire !== null) {
    if (typeof commentaire !== "string") {
      throw new ActionModerationError(
        "Le champ « commentaire » doit être une chaîne.",
        "commentaire"
      );
    }
    const trimmed = commentaire.trim();
    if (trimmed.length > COMMENTAIRE_MODERATION_MAX_LENGTH) {
      throw new ActionModerationError(
        `Le commentaire ne peut pas dépasser ${COMMENTAIRE_MODERATION_MAX_LENGTH} caractères.`,
        "commentaire"
      );
    }
    if (trimmed !== "") commentaireValide = trimmed;
  }

  return {
    action: actionValide,
    signalementId: signalementIdValide,
    compteCibleId: compteCibleIdValide,
    commentaire: commentaireValide,
  };
}

/* -------------------------------------------------------------------------- */
/*  Vues renvoyées par l'API                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Signalement tel qu'affiché dans la file — **contrairement** à la
 * `SignalementView` de ST 7.1, elle expose le `motif` et l'`auteurId` : ce
 * sont les informations dont le modérateur a besoin pour décider. Endpoint
 * réservé aux modérateurs.
 */
export interface SignalementModereView {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  motif: string;
  auteurId: string | null;
  statut: StatutSignalement;
  dateCreation: string;
  /** Nb total de signalements visant ce contenu (regroupement, ST 7.2). */
  nombreSignalementsContenu: number;
}

export interface PaginationModeration {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FileModerationResponse {
  items: SignalementModereView[];
  pagination: PaginationModeration;
}

/** Entrée du journal des décisions (traçabilité). */
export interface DecisionModerationView {
  id: string;
  action: "REJET_SIGNALEMENT" | "RETRAIT_CONTENU" | "SUSPENSION_COMPTE";
  moderateurId: string | null;
  signalementId: string | null;
  contenuType: TypeContenuSignale | null;
  contenuId: string | null;
  compteCibleId: string | null;
  commentaire: string | null;
  dateCreation: string;
}

export interface JournalModerationResponse {
  items: DecisionModerationView[];
  pagination: PaginationModeration;
}

/** Réponse de `POST /api/admin/moderation` : la décision + l'état du signalement. */
export interface ActionModerationResponse {
  decision: DecisionModerationView;
  signalement: SignalementModereView | null;
}
