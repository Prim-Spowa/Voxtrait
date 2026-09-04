/**
 * Logique client-safe du signalement de contenu — ST 7.1 « Signalement de
 * contenu » (US 7.1 : signaler un extrait ou un doublage problématique).
 *
 * Séparée de `lib/signalement.ts` (orchestration serveur : store, adaptateur
 * Prisma) pour pouvoir être importée depuis un composant `"use client"` — même
 * séparation que `doublageShareClient.ts` vs `doublageShare.ts` (ST 3.2) ou
 * `doublageSauvegardeClient.ts` vs `doublageSauvegarde.ts` (ST 6.1).
 *
 * Contient : le type de contenu signalable, le catalogue de motifs proposé à
 * l'utilisateur, les bornes de validation, la forme de la vue API, et le
 * parsing/validation du corps de requête (fonction pure, testable sans runtime
 * Next — à l'image de `parseHistoriqueQuery`, ST 6.2).
 */

/** Chemin de l'endpoint de création de signalement (ST 7.1, tâche 2). */
export const SIGNALEMENTS_API_PATH = "/api/signalements";

/**
 * Type de contenu visé par un signalement. Reprend les valeurs de l'enum
 * Prisma `TypeContenuSignale`, dupliquées ici pour rester client-safe (même
 * approche que `VisibiliteDoublage` dans `doublageSauvegardeClient.ts`).
 */
export type TypeContenuSignale = "EXTRAIT" | "DOUBLAGE";

export const TYPES_CONTENU_SIGNALE: readonly TypeContenuSignale[] = [
  "EXTRAIT",
  "DOUBLAGE",
];

/**
 * Cycle de vie d'un signalement — miroir client-safe de l'enum Prisma
 * `StatutSignalement`. `EN_ATTENTE` à la création (ST 7.1) ; `RETENU` / `REJETE`
 * posés par le dashboard de modération (ST 7.2).
 */
export type StatutSignalement = "EN_ATTENTE" | "RETENU" | "REJETE";

/** Longueur maximale acceptée pour le motif (après trim). */
export const SIGNALEMENT_MOTIF_MAX_LENGTH = 2000;

/**
 * Catalogue de motifs proposé dans le formulaire de signalement. Le champ
 * `motif` transmis à l'API reste un **texte libre** (cf. schéma Prisma) : le
 * composant compose ce texte à partir du libellé de la catégorie choisie et,
 * optionnellement, de précisions saisies par l'utilisateur. L'API ne connaît
 * donc pas ces identifiants — elle valide seulement la non-vacuité et la
 * longueur.
 */
export interface MotifSignalementOption {
  id: string;
  label: string;
}

export const MOTIFS_SIGNALEMENT: readonly MotifSignalementOption[] = [
  { id: "droits_auteur", label: "Atteinte aux droits d'auteur" },
  { id: "haine_harcelement", label: "Propos haineux ou harcèlement" },
  { id: "contenu_choquant", label: "Contenu sexuel, violent ou choquant" },
  { id: "spam", label: "Spam ou contenu trompeur" },
  { id: "autre", label: "Autre" },
];

/**
 * Compose le texte de motif transmis à l'API à partir d'une catégorie et de
 * précisions optionnelles. Fonction pure partagée par le composant et ses
 * tests. Renvoie `""` si la catégorie est inconnue et qu'aucune précision
 * n'est fournie (le composant traite ce cas comme « motif manquant »).
 */
export function composeMotif(motifId: string, details?: string): string {
  const option = MOTIFS_SIGNALEMENT.find((m) => m.id === motifId);
  const precision = details?.trim() ?? "";
  const base = option ? option.label : "";
  if (base && precision) return `${base} — ${precision}`;
  return base || precision;
}

/** Projection d'un `Signalement` renvoyée par l'API après création. */
export interface SignalementView {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  statut: "EN_ATTENTE" | "RETENU" | "REJETE";
  /** Date de création, ISO 8601. */
  dateCreation: string;
}

/** Corps validé de `POST /api/signalements`. */
export interface SignalementPayload {
  contenuType: TypeContenuSignale;
  contenuId: string;
  motif: string;
}

/**
 * Levée par `parseSignalementPayload` quand le corps est absent ou invalide —
 * l'endpoint la traduit en `400` explicite (même posture que
 * `HistoriqueQueryError`, ST 6.2). `field` permet au client de cibler le
 * message.
 */
export class SignalementPayloadError extends Error {
  readonly field?: "contenuType" | "contenuId" | "motif";
  constructor(message: string, field?: SignalementPayloadError["field"]) {
    super(message);
    this.name = "SignalementPayloadError";
    this.field = field;
  }
}

function isTypeContenuSignale(value: unknown): value is TypeContenuSignale {
  return (
    typeof value === "string" &&
    (TYPES_CONTENU_SIGNALE as readonly string[]).includes(value)
  );
}

/**
 * Parse et valide le corps JSON de `POST /api/signalements`.
 *
 *  - `contenuType` : obligatoire, dans `TYPES_CONTENU_SIGNALE` ;
 *  - `contenuId` : obligatoire, chaîne non vide (après trim) ;
 *  - `motif` : **obligatoire** (ST 7.1, tâche 2 : « motif obligatoire »),
 *    chaîne non vide après trim, ≤ `SIGNALEMENT_MOTIF_MAX_LENGTH` caractères.
 *
 * Les chaînes renvoyées sont *trimées*.
 */
export function parseSignalementPayload(body: unknown): SignalementPayload {
  if (typeof body !== "object" || body === null) {
    throw new SignalementPayloadError("Corps de requête invalide.");
  }
  const { contenuType, contenuId, motif } = body as Record<string, unknown>;

  if (!isTypeContenuSignale(contenuType)) {
    throw new SignalementPayloadError(
      `Le champ « contenuType » doit valoir ${TYPES_CONTENU_SIGNALE.join(" ou ")}.`,
      "contenuType"
    );
  }

  if (typeof contenuId !== "string" || contenuId.trim().length === 0) {
    throw new SignalementPayloadError(
      "Le champ « contenuId » est requis.",
      "contenuId"
    );
  }

  if (typeof motif !== "string" || motif.trim().length === 0) {
    throw new SignalementPayloadError(
      "Merci d'indiquer un motif de signalement.",
      "motif"
    );
  }

  const motifTrimmed = motif.trim();
  if (motifTrimmed.length > SIGNALEMENT_MOTIF_MAX_LENGTH) {
    throw new SignalementPayloadError(
      `Le motif ne peut pas dépasser ${SIGNALEMENT_MOTIF_MAX_LENGTH} caractères.`,
      "motif"
    );
  }

  return {
    contenuType,
    contenuId: contenuId.trim(),
    motif: motifTrimmed,
  };
}
