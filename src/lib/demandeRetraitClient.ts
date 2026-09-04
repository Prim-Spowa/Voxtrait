/**
 * Logique client-safe de la procédure notice-and-takedown — ST 7.3 « Procédure
 * notice-and-takedown » (US 7.3 : retirer un contenu sur demande d'un ayant
 * droit).
 *
 * Séparée de `lib/demandeRetrait.ts` (orchestration serveur : store, adaptateur
 * Prisma, jonction avec le workflow de retrait de ST 7.2) pour être importable
 * depuis les composants `"use client"` (formulaire public, tableau de bord des
 * demandes) et depuis leurs tests — même séparation que `signalementClient.ts`
 * vs `signalement.ts` (ST 7.1) ou `moderationClient.ts` vs `moderation.ts`
 * (ST 7.2).
 *
 * Contient : les chemins d'API, les énumérations, les bornes de validation, la
 * forme des vues renvoyées par l'API, le parsing/validation (fonctions pures) du
 * corps de `POST /api/demandes-retrait` et du corps d'une action modérateur, et
 * le calcul (pur) du rapport de délais de traitement.
 */

import type { TypeContenuSignale } from "@/lib/signalementClient";
import { TYPES_CONTENU_SIGNALE } from "@/lib/signalementClient";

export type { TypeContenuSignale };
export { TYPES_CONTENU_SIGNALE };

/* -------------------------------------------------------------------------- */
/*  Chemins                                                                    */
/* -------------------------------------------------------------------------- */

/** Endpoint public de dépôt d'une demande de retrait (ST 7.3, tâche 2). */
export const DEMANDES_RETRAIT_API_PATH = "/api/demandes-retrait";

/** Page publique portant le formulaire de demande de retrait. */
export const DEMANDE_RETRAIT_PUBLIC_PATH = "/demande-retrait";

/** Endpoint modérateur : file des demandes + actions (traiter / rejeter). */
export const DEMANDES_RETRAIT_ADMIN_API_PATH = "/api/admin/demandes-retrait";

/** Endpoint modérateur : rapport des délais de traitement. */
export const DEMANDES_RETRAIT_RAPPORT_API_PATH = "/api/admin/demandes-retrait/rapport";

/** Page d'administration de la file des demandes de retrait. */
export const DEMANDES_RETRAIT_ADMIN_PATH = "/admin/demandes-retrait";

/* -------------------------------------------------------------------------- */
/*  Énumérations & bornes                                                      */
/* -------------------------------------------------------------------------- */

/** Cycle de vie d'une demande — miroir client-safe de `StatutDemandeRetrait`. */
export type StatutDemandeRetrait = "EN_ATTENTE" | "TRAITEE" | "REJETEE";

export const STATUTS_DEMANDE_RETRAIT: readonly StatutDemandeRetrait[] = [
  "EN_ATTENTE",
  "TRAITEE",
  "REJETEE",
];

/**
 * Action d'un modérateur sur une demande depuis le tableau de bord.
 *  - `TRAITER` : la demande est fondée → le contenu visé passe au statut
 *    `RETRAIT_AYANT_DROIT`, la demande passe `TRAITEE`, une décision
 *    `RETRAIT_AYANT_DROIT` est journalisée ;
 *  - `REJETER` : la demande est écartée (contenu déjà absent, hors périmètre,
 *    manifestement infondée) → la demande passe `REJETEE`, sans impact sur le
 *    contenu. Un commentaire de motivation est alors vivement recommandé.
 */
export type ActionDemandeRetrait = "TRAITER" | "REJETER";

export const ACTIONS_DEMANDE_RETRAIT: readonly ActionDemandeRetrait[] = [
  "TRAITER",
  "REJETER",
];

export const OEUVRE_MAX_LENGTH = 300;
export const DEMANDEUR_NOM_MAX_LENGTH = 200;
export const DEMANDEUR_EMAIL_MAX_LENGTH = 320;
export const DEMANDEUR_ORGANISATION_MAX_LENGTH = 200;
export const DEMANDE_RETRAIT_MOTIF_MAX_LENGTH = 5000;
export const COMMENTAIRE_TRAITEMENT_MAX_LENGTH = 2000;

export const DEMANDES_RETRAIT_PAGE_SIZE_DEFAUT = 20;
export const DEMANDES_RETRAIT_PAGE_SIZE_MAX = 100;

/**
 * Délai cible de traitement d'une demande, en heures. La procédure
 * notice-and-takedown s'engage sur un retrait « rapide » (cahier des charges
 * §5). 72 h (3 jours ouvrés au pire) est la cible de référence du rapport ;
 * elle n'est pas contraignante côté code (aucune demande n'est bloquée), elle
 * sert à mesurer et justifier les délais (obligation potentielle, ST 7.3).
 */
export const DELAI_CIBLE_TRAITEMENT_HEURES = 72;

/** Tri de la file des demandes (défaut `ANCIENNETE` : borne le délai maximal). */
export type TriDemandesRetrait = "ANCIENNETE" | "RECENCE";

export const TRIS_DEMANDES_RETRAIT: readonly TriDemandesRetrait[] = [
  "ANCIENNETE",
  "RECENCE",
];

export interface FileDemandesRetraitQuery {
  statut: StatutDemandeRetrait;
  tri: TriDemandesRetrait;
  page: number;
  pageSize: number;
}

/** Levée par `parseFileDemandesRetraitQuery` sur un paramètre fourni mais invalide. */
export class FileDemandesRetraitQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileDemandesRetraitQueryError";
  }
}

function parseEntierPositif(raw: string | null, nom: string, defaut: number): number {
  if (raw === null || raw.trim() === "") return defaut;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new FileDemandesRetraitQueryError(
      `Paramètre « ${nom} » invalide : « ${raw} ». Entier ≥ 1 attendu.`
    );
  }
  return n;
}

/**
 * Parse les query params de `GET /api/admin/demandes-retrait`.
 *  - `statut` : défaut `EN_ATTENTE` (la file de travail) ;
 *  - `tri` : défaut `ANCIENNETE` ;
 *  - `page` / `pageSize` : défaut 1 / 20, `pageSize` plafonné à 100.
 */
export function parseFileDemandesRetraitQuery(
  searchParams: URLSearchParams
): FileDemandesRetraitQuery {
  const statutRaw = searchParams.get("statut");
  let statut: StatutDemandeRetrait = "EN_ATTENTE";
  if (statutRaw) {
    if (!(STATUTS_DEMANDE_RETRAIT as readonly string[]).includes(statutRaw)) {
      throw new FileDemandesRetraitQueryError(
        `Paramètre « statut » invalide : « ${statutRaw} ».`
      );
    }
    statut = statutRaw as StatutDemandeRetrait;
  }

  const triRaw = searchParams.get("tri");
  let tri: TriDemandesRetrait = "ANCIENNETE";
  if (triRaw) {
    if (!(TRIS_DEMANDES_RETRAIT as readonly string[]).includes(triRaw)) {
      throw new FileDemandesRetraitQueryError(
        `Paramètre « tri » invalide : « ${triRaw} ».`
      );
    }
    tri = triRaw as TriDemandesRetrait;
  }

  const page = parseEntierPositif(searchParams.get("page"), "page", 1);
  const pageSize = Math.min(
    parseEntierPositif(
      searchParams.get("pageSize"),
      "pageSize",
      DEMANDES_RETRAIT_PAGE_SIZE_DEFAUT
    ),
    DEMANDES_RETRAIT_PAGE_SIZE_MAX
  );

  return { statut, tri, page, pageSize };
}

/* -------------------------------------------------------------------------- */
/*  Validation du corps public                                                 */
/* -------------------------------------------------------------------------- */

/** Corps validé de `POST /api/demandes-retrait`. */
export interface DemandeRetraitPayload {
  contenuType: TypeContenuSignale;
  contenuId: string;
  oeuvre: string;
  demandeurNom: string;
  demandeurEmail: string;
  demandeurOrganisation: string | null;
  motif: string;
  declarationBonneFoi: true;
}

/**
 * Levée par `parseDemandeRetraitPayload` — l'endpoint la traduit en `400`
 * explicite (même posture que `SignalementPayloadError`, ST 7.1). `field` cible
 * le message côté formulaire.
 */
export class DemandeRetraitPayloadError extends Error {
  readonly field?:
    | "contenuType"
    | "contenuId"
    | "oeuvre"
    | "demandeurNom"
    | "demandeurEmail"
    | "demandeurOrganisation"
    | "motif"
    | "declarationBonneFoi";
  constructor(message: string, field?: DemandeRetraitPayloadError["field"]) {
    super(message);
    this.name = "DemandeRetraitPayloadError";
    this.field = field;
  }
}

/**
 * Validation d'email volontairement permissive : présence d'un `@` entouré de
 * caractères non-espace, un `.` après le `@`. On ne cherche pas la conformité
 * RFC 5322 — l'email n'est utilisé que comme canal de réponse humain, sa
 * validité réelle est vérifiée en répondant.
 */
function estEmailPlausible(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function exigerChaine(
  value: unknown,
  field: DemandeRetraitPayloadError["field"],
  label: string,
  max: number
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DemandeRetraitPayloadError(`Le champ « ${label} » est requis.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DemandeRetraitPayloadError(
      `Le champ « ${label} » ne peut pas dépasser ${max} caractères.`,
      field
    );
  }
  return trimmed;
}

function isTypeContenuSignale(value: unknown): value is TypeContenuSignale {
  return (
    typeof value === "string" &&
    (TYPES_CONTENU_SIGNALE as readonly string[]).includes(value)
  );
}

/**
 * Parse et valide le corps JSON de `POST /api/demandes-retrait`.
 *
 *  - `contenuType` / `contenuId` : contenu visé (obligatoires) ;
 *  - `oeuvre`, `demandeurNom`, `demandeurEmail`, `motif` : obligatoires, bornés ;
 *  - `demandeurEmail` : format plausible exigé ;
 *  - `demandeurOrganisation` : optionnel ;
 *  - `declarationBonneFoi` : doit valoir **exactement `true`** — sans la
 *    déclaration, la demande n'est pas recevable (ST 7.3, tâche 2).
 *
 * Les chaînes renvoyées sont *trimées* ; l'organisation vide devient `null`.
 */
export function parseDemandeRetraitPayload(body: unknown): DemandeRetraitPayload {
  if (typeof body !== "object" || body === null) {
    throw new DemandeRetraitPayloadError("Corps de requête invalide.");
  }
  const {
    contenuType,
    contenuId,
    oeuvre,
    demandeurNom,
    demandeurEmail,
    demandeurOrganisation,
    motif,
    declarationBonneFoi,
  } = body as Record<string, unknown>;

  if (!isTypeContenuSignale(contenuType)) {
    throw new DemandeRetraitPayloadError(
      `Le champ « contenuType » doit valoir ${TYPES_CONTENU_SIGNALE.join(" ou ")}.`,
      "contenuType"
    );
  }

  if (typeof contenuId !== "string" || contenuId.trim().length === 0) {
    throw new DemandeRetraitPayloadError("Le champ « contenuId » est requis.", "contenuId");
  }

  const oeuvreValide = exigerChaine(oeuvre, "oeuvre", "œuvre concernée", OEUVRE_MAX_LENGTH);
  const nomValide = exigerChaine(
    demandeurNom,
    "demandeurNom",
    "nom du demandeur",
    DEMANDEUR_NOM_MAX_LENGTH
  );
  const emailValide = exigerChaine(
    demandeurEmail,
    "demandeurEmail",
    "email de contact",
    DEMANDEUR_EMAIL_MAX_LENGTH
  );
  if (!estEmailPlausible(emailValide)) {
    throw new DemandeRetraitPayloadError(
      "L'email de contact ne paraît pas valide.",
      "demandeurEmail"
    );
  }

  let organisationValide: string | null = null;
  if (demandeurOrganisation !== undefined && demandeurOrganisation !== null) {
    if (typeof demandeurOrganisation !== "string") {
      throw new DemandeRetraitPayloadError(
        "Le champ « organisation » doit être une chaîne.",
        "demandeurOrganisation"
      );
    }
    const trimmed = demandeurOrganisation.trim();
    if (trimmed.length > DEMANDEUR_ORGANISATION_MAX_LENGTH) {
      throw new DemandeRetraitPayloadError(
        `Le champ « organisation » ne peut pas dépasser ${DEMANDEUR_ORGANISATION_MAX_LENGTH} caractères.`,
        "demandeurOrganisation"
      );
    }
    organisationValide = trimmed === "" ? null : trimmed;
  }

  const motifValide = exigerChaine(
    motif,
    "motif",
    "exposé de la demande",
    DEMANDE_RETRAIT_MOTIF_MAX_LENGTH
  );

  if (declarationBonneFoi !== true) {
    throw new DemandeRetraitPayloadError(
      "La déclaration de bonne foi est obligatoire pour déposer une demande.",
      "declarationBonneFoi"
    );
  }

  return {
    contenuType,
    contenuId: contenuId.trim(),
    oeuvre: oeuvreValide,
    demandeurNom: nomValide,
    demandeurEmail: emailValide,
    demandeurOrganisation: organisationValide,
    motif: motifValide,
    declarationBonneFoi: true,
  };
}

/* -------------------------------------------------------------------------- */
/*  Validation du corps d'action modérateur                                    */
/* -------------------------------------------------------------------------- */

export interface ActionDemandeRetraitPayload {
  action: ActionDemandeRetrait;
  demandeId: string;
  commentaire?: string;
}

/** Levée par `parseActionDemandeRetraitPayload` — traduite en `400`. */
export class ActionDemandeRetraitError extends Error {
  readonly field?: "action" | "demandeId" | "commentaire";
  constructor(message: string, field?: ActionDemandeRetraitError["field"]) {
    super(message);
    this.name = "ActionDemandeRetraitError";
    this.field = field;
  }
}

/**
 * Parse et valide le corps de `POST /api/admin/demandes-retrait`.
 *  - `action` obligatoire, dans `ACTIONS_DEMANDE_RETRAIT` ;
 *  - `demandeId` obligatoire, chaîne non vide ;
 *  - `commentaire` optionnel, ≤ `COMMENTAIRE_TRAITEMENT_MAX_LENGTH` (trimé).
 */
export function parseActionDemandeRetraitPayload(
  body: unknown
): ActionDemandeRetraitPayload {
  if (typeof body !== "object" || body === null) {
    throw new ActionDemandeRetraitError("Corps de requête invalide.");
  }
  const { action, demandeId, commentaire } = body as Record<string, unknown>;

  if (
    typeof action !== "string" ||
    !(ACTIONS_DEMANDE_RETRAIT as readonly string[]).includes(action)
  ) {
    throw new ActionDemandeRetraitError(
      `Le champ « action » doit valoir ${ACTIONS_DEMANDE_RETRAIT.join(" ou ")}.`,
      "action"
    );
  }

  if (typeof demandeId !== "string" || demandeId.trim() === "") {
    throw new ActionDemandeRetraitError(
      "Le champ « demandeId » est requis.",
      "demandeId"
    );
  }

  let commentaireValide: string | undefined;
  if (commentaire !== undefined && commentaire !== null) {
    if (typeof commentaire !== "string") {
      throw new ActionDemandeRetraitError(
        "Le champ « commentaire » doit être une chaîne.",
        "commentaire"
      );
    }
    const trimmed = commentaire.trim();
    if (trimmed.length > COMMENTAIRE_TRAITEMENT_MAX_LENGTH) {
      throw new ActionDemandeRetraitError(
        `Le commentaire ne peut pas dépasser ${COMMENTAIRE_TRAITEMENT_MAX_LENGTH} caractères.`,
        "commentaire"
      );
    }
    if (trimmed !== "") commentaireValide = trimmed;
  }

  return {
    action: action as ActionDemandeRetrait,
    demandeId: demandeId.trim(),
    commentaire: commentaireValide,
  };
}

/* -------------------------------------------------------------------------- */
/*  Vues renvoyées par l'API                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Demande de retrait telle que renvoyée au **demandeur** après dépôt : accusé
 * de réception minimal. On n'y expose ni les coordonnées ni le motif (le
 * demandeur les a saisis) — seulement de quoi identifier la demande dans un
 * futur échange.
 */
export interface DemandeRetraitRecuView {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  statut: StatutDemandeRetrait;
  dateCreation: string;
}

/**
 * Demande de retrait telle qu'affichée dans la file de modération — expose
 * toutes les données nécessaires à la décision. Endpoint réservé aux
 * modérateurs.
 */
export interface DemandeRetraitModereView {
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
  dateCreation: string;
  dateTraitement: string | null;
  /** Délai de traitement en heures (`null` tant que `EN_ATTENTE`). */
  delaiTraitementHeures: number | null;
}

export interface PaginationDemandesRetrait {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FileDemandesRetraitResponse {
  items: DemandeRetraitModereView[];
  pagination: PaginationDemandesRetrait;
}

/** Réponse de `POST /api/admin/demandes-retrait`. */
export interface ActionDemandeRetraitResponse {
  demande: DemandeRetraitModereView;
  /** Décision journalisée (uniquement pour `TRAITER`). */
  decisionId: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Rapport des délais de traitement                                           */
/* -------------------------------------------------------------------------- */

/** Entrée minimale nécessaire au calcul du rapport (sous-ensemble d'une demande). */
export interface DemandePourRapport {
  statut: StatutDemandeRetrait;
  dateCreation: string;
  dateTraitement: string | null;
}

export interface RapportDelaisTraitement {
  /** Nombre total de demandes reçues sur le périmètre. */
  total: number;
  enAttente: number;
  traitees: number;
  rejetees: number;
  /** Délai de traitement moyen (heures, 1 décimale), demandes closes uniquement. */
  delaiMoyenHeures: number | null;
  /** Délai médian (heures, 1 décimale). */
  delaiMedianHeures: number | null;
  /** Délai maximal observé (heures, 1 décimale). */
  delaiMaxHeures: number | null;
  /** Demandes closes dans le délai cible (`DELAI_CIBLE_TRAITEMENT_HEURES`). */
  closesDansDelaiCible: number;
  /** Demandes closes hors délai cible. */
  closesHorsDelaiCible: number;
  /** Demandes encore en attente au-delà du délai cible (à la date `maintenant`). */
  enAttenteHorsDelaiCible: number;
  delaiCibleHeures: number;
}

const MS_PAR_HEURE = 3_600_000;

function arrondi1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Calcule le rapport des délais de traitement des demandes de retrait —
 * fonction **pure** (mêmes entrées → mêmes sorties), testable sans base.
 *
 * `delaiTraitementHeures` d'une demande close = `dateTraitement − dateCreation`.
 * Le délai médian utilise la moyenne des deux valeurs centrales pour un nombre
 * pair de demandes closes. Une demande dont `dateTraitement` précède
 * `dateCreation` (horloge incohérente) est bornée à `0`.
 *
 * @param demandes  demandes du périmètre voulu (déjà filtrées par l'appelant)
 * @param maintenant  référence pour l'âge des demandes encore en attente
 */
export function calculerRapportDelais(
  demandes: readonly DemandePourRapport[],
  maintenant: Date = new Date()
): RapportDelaisTraitement {
  const cibleMs = DELAI_CIBLE_TRAITEMENT_HEURES * MS_PAR_HEURE;
  const maintenantMs = maintenant.getTime();

  let enAttente = 0;
  let traitees = 0;
  let rejetees = 0;
  let closesDansDelaiCible = 0;
  let closesHorsDelaiCible = 0;
  let enAttenteHorsDelaiCible = 0;
  const delaisMs: number[] = [];

  for (const d of demandes) {
    if (d.statut === "TRAITEE") traitees += 1;
    else if (d.statut === "REJETEE") rejetees += 1;
    else enAttente += 1;

    const creeMs = Date.parse(d.dateCreation);

    if (d.statut === "EN_ATTENTE" || d.dateTraitement === null) {
      if (Number.isFinite(creeMs) && maintenantMs - creeMs > cibleMs) {
        enAttenteHorsDelaiCible += 1;
      }
      continue;
    }

    const traiteMs = Date.parse(d.dateTraitement);
    if (!Number.isFinite(creeMs) || !Number.isFinite(traiteMs)) continue;
    const delaiMs = Math.max(0, traiteMs - creeMs);
    delaisMs.push(delaiMs);
    if (delaiMs <= cibleMs) closesDansDelaiCible += 1;
    else closesHorsDelaiCible += 1;
  }

  let delaiMoyenHeures: number | null = null;
  let delaiMedianHeures: number | null = null;
  let delaiMaxHeures: number | null = null;
  if (delaisMs.length > 0) {
    const tries = [...delaisMs].sort((a, b) => a - b);
    const somme = tries.reduce((acc, v) => acc + v, 0);
    delaiMoyenHeures = arrondi1(somme / tries.length / MS_PAR_HEURE);
    delaiMaxHeures = arrondi1(tries[tries.length - 1]! / MS_PAR_HEURE);
    const milieu = Math.floor(tries.length / 2);
    const medianeMs =
      tries.length % 2 === 0
        ? (tries[milieu - 1]! + tries[milieu]!) / 2
        : tries[milieu]!;
    delaiMedianHeures = arrondi1(medianeMs / MS_PAR_HEURE);
  }

  return {
    total: demandes.length,
    enAttente,
    traitees,
    rejetees,
    delaiMoyenHeures,
    delaiMedianHeures,
    delaiMaxHeures,
    closesDansDelaiCible,
    closesHorsDelaiCible,
    enAttenteHorsDelaiCible,
    delaiCibleHeures: DELAI_CIBLE_TRAITEMENT_HEURES,
  };
}
