/**
 * Logique client-safe de l'import de vidéos personnelles — ST 5.1 « Import et
 * compression vidéo » (US 5.1 : importer un extrait vidéo personnel).
 *
 * Séparée de `lib/import.ts` (orchestration serveur : URL signée, sonde de la
 * vidéo uploadée, job de compression FFmpeg, création de l'entrée `Extrait`)
 * pour pouvoir être importée depuis un futur composant `"use client"` de
 * formulaire d'import sans faire entrer de code serveur (`node:crypto`,
 * `@prisma/client`) dans le bundle navigateur — même séparation que
 * `doublageClient.ts` vs `doublage.ts` (ST 3.1) ou `authClient.ts` vs
 * `auth.ts` (ST 4.1).
 *
 * Contient :
 *  - les limites d'import (durée ≤ 5 min, taille, formats acceptés) — source
 *    de vérité unique, réappliquée côté serveur (`lib/import.ts`) ;
 *  - `validateImportUploadRequest` : contrôle **avant** la demande d'URL signée
 *    (nom de fichier, type déclaré, taille déclarée) ;
 *  - `validateProbedVideo` : contrôle **après** upload, sur les métadonnées
 *    réelles sondées côté serveur (durée notamment — impossible à garantir
 *    depuis le client, cf. ST 5.1 « Choix techniques ») ;
 *  - `collectImportFormErrors` : validation des champs de classification de
 *    l'extrait pour la bibliothèque (titre, origine, type) ;
 *  - le contrat de statut de job partagé client/serveur et la stratégie de
 *    polling (back-off) ;
 *  - `suggestTitreFromFilename` : titre par défaut à partir du nom de fichier.
 */

import { DEFAULT_MAX_RECORDING_SECONDS } from "@/lib/voiceRecorder";
import { erreurCertificationDroits } from "@/lib/certificationDroits";
import { ORIGINE_LABELS, TYPE_LABELS, type Origine, type TypeContenu } from "@/types/extrait";

/* -------------------------------------------------------------------------- */
/*  Limites d'import                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Durée maximale d'un extrait importé : 5 minutes (cahier des charges §3,
 * ST 5.1 « Validation post-upload : durée »). Alignée sur la limite
 * d'enregistrement vocal (`DEFAULT_MAX_RECORDING_SECONDS`) — même contrainte
 * fonctionnelle, une seule constante d'origine.
 *
 * Contrôle **strict** : aucune tolérance. Contrairement à la durée audio de
 * ST 3.1 (estimée par le navigateur, d'où une marge d'imprécision), la durée
 * d'un import est mesurée côté serveur par une sonde du fichier réel
 * (`ffprobe`, cf. `UploadedVideoProbe` dans `lib/import.ts`) : la valeur est
 * fiable, un fichier de 5:01 doit être rejeté (cf. DoD ST 5.1 : « test sur un
 * fichier limite 4:59 vs 5:01 »).
 */
export const MAX_IMPORT_DURATION_SECONDS = DEFAULT_MAX_RECORDING_SECONDS;

/**
 * Taille maximale acceptée pour le fichier importé **avant** compression
 * (500 Mo). Ordre de grandeur : ~5 min de vidéo 1080p faiblement compressée
 * (smartphone) tient largement en dessous ; 500 Mo laisse de la marge sans
 * ouvrir la porte à des envois abusifs (« coût de stockage/bande passante
 * identifié comme risque moyen », points d'attention ST 5.1). À affiner avec
 * le porteur de projet — signalé en notes de dev.
 */
export const MAX_IMPORT_FILE_BYTES = 500 * 1024 * 1024;

/**
 * Types MIME vidéo acceptés à l'import. Volontairement restreint aux
 * conteneurs courants issus des appareils grand public et lisibles par
 * FFmpeg. Le paramètre `;codecs=...` est retiré avant comparaison.
 */
export const ACCEPTED_IMPORT_MIME_TYPES: readonly string[] = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
  "video/x-matroska", // .mkv
];

/** Extensions de fichier correspondantes — contrôle de cohérence secondaire. */
export const ACCEPTED_IMPORT_EXTENSIONS: readonly string[] = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
];

/** Longueur maximale du titre affiché en bibliothèque. */
export const IMPORT_TITRE_MAX_LENGTH = 120;
/** Longueur minimale du titre (après trim). */
export const IMPORT_TITRE_MIN_LENGTH = 2;

/** Retire le paramètre `;codecs=...` d'un type MIME et normalise la casse. */
export function normalizeVideoMimeType(mimeType: string): string {
  return (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Extension de fichier (avec le point, en minuscule), ou `""` si absente. */
export function fileExtension(filename: string): string {
  const match = /\.[a-z0-9]+$/i.exec((filename ?? "").trim());
  return match ? match[0].toLowerCase() : "";
}

/* -------------------------------------------------------------------------- */
/*  Validation avant demande d'URL signée                                      */
/* -------------------------------------------------------------------------- */

export interface ImportUploadRequestMetadata {
  /** Nom du fichier choisi par l'utilisateur (sert au titre par défaut + contrôle d'extension). */
  filename: string;
  /** Type MIME déclaré par le navigateur. */
  mimeType: string;
  /** Taille du fichier en octets (connue côté client avant upload). */
  sizeBytes: number;
}

/**
 * Valide les métadonnées connues **avant** l'upload (pour ne générer une URL
 * signée que si l'import a une chance d'aboutir). Ne peut pas contrôler la
 * durée : le fichier n'est pas encore disponible.
 *
 * @returns un message d'erreur utilisateur, ou `null` si la requête est valide.
 */
export function validateImportUploadRequest(
  meta: ImportUploadRequestMetadata
): string | null {
  const filename = (meta.filename ?? "").trim();
  if (!filename) {
    return "Le nom du fichier est manquant.";
  }

  const mime = normalizeVideoMimeType(meta.mimeType);
  const ext = fileExtension(filename);
  const mimeOk = ACCEPTED_IMPORT_MIME_TYPES.includes(mime);
  const extOk = ACCEPTED_IMPORT_EXTENSIONS.includes(ext);
  // On tolère un type MIME vide/générique (`application/octet-stream`) si
  // l'extension est reconnue : certains navigateurs ne typent pas les `.mkv`.
  if (!mimeOk && !extOk) {
    return "Ce format de vidéo n'est pas pris en charge (formats acceptés : MP4, MOV, WebM, MKV).";
  }

  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
    return "Le fichier est vide ou illisible.";
  }
  if (meta.sizeBytes > MAX_IMPORT_FILE_BYTES) {
    return `Le fichier dépasse la taille maximale autorisée (${formatMegabytes(MAX_IMPORT_FILE_BYTES)}).`;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Validation après upload (métadonnées sondées côté serveur)                 */
/* -------------------------------------------------------------------------- */

/** Métadonnées réelles d'un fichier uploadé, obtenues par sonde serveur (`ffprobe`). */
export interface ProbedVideoMetadata {
  /** Durée réelle en secondes. */
  durationSeconds: number;
  /** Type MIME / conteneur réellement détecté. */
  mimeType: string;
  /** Taille réelle du fichier stocké, en octets. */
  sizeBytes: number;
}

export type ProbedVideoVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verdict de validation post-upload (ST 5.1, découpage en tâches point 2 :
 * « Validation post-upload : durée, format, taille »).
 *
 * Appelée par `finalizeImport` (`lib/import.ts`) : si le verdict est négatif,
 * le fichier est **supprimé immédiatement** du stockage (point d'attention
 * ST 5.1 : « Rejeter et supprimer immédiatement tout fichier dépassant
 * 5 minutes — ne pas le laisser en stockage »).
 */
export function validateProbedVideo(meta: ProbedVideoMetadata): ProbedVideoVerdict {
  if (!Number.isFinite(meta.durationSeconds) || meta.durationSeconds <= 0) {
    return { ok: false, reason: "La durée de la vidéo n'a pas pu être déterminée." };
  }
  if (meta.durationSeconds > MAX_IMPORT_DURATION_SECONDS) {
    return {
      ok: false,
      reason: `La vidéo dépasse la durée maximale autorisée de ${Math.round(
        MAX_IMPORT_DURATION_SECONDS / 60
      )} minutes.`,
    };
  }

  if (!ACCEPTED_IMPORT_MIME_TYPES.includes(normalizeVideoMimeType(meta.mimeType))) {
    return {
      ok: false,
      reason: "Le format réel du fichier n'est pas une vidéo prise en charge.",
    };
  }

  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
    return { ok: false, reason: "Le fichier stocké est vide ou illisible." };
  }
  if (meta.sizeBytes > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      reason: `Le fichier dépasse la taille maximale autorisée (${formatMegabytes(
        MAX_IMPORT_FILE_BYTES
      )}).`,
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Validation des champs de classification de l'extrait                       */
/* -------------------------------------------------------------------------- */

export const ORIGINES_IMPORT: readonly Origine[] = ["FR", "US", "JP"];
export const TYPES_IMPORT: readonly TypeContenu[] = ["FILM", "SERIE", "DESSIN_ANIME"];

/** Champs saisis par l'utilisateur pour classer son extrait dans la bibliothèque. */
export interface ImportFormInput {
  titre: string;
  origine: string;
  type: string;
  /**
   * ST 5.2 — case « je certifie mes droits sur ce contenu » du formulaire
   * d'import. Doit valoir `true` pour que l'import soit finalisable
   * (« Blocage de la soumission d'import tant que non cochée »).
   */
  certifieDroits?: unknown;
}

export interface ImportFormErrors {
  titre?: string;
  origine?: string;
  type?: string;
  /** Case de certification des droits non cochée (ST 5.2). */
  certifieDroits?: string;
}

/**
 * Valide les champs du formulaire d'import — classification (titre, origine,
 * type) et certification des droits (ST 5.2) — source de vérité unique,
 * réappliquée par `finalizeImport` côté serveur avant toute écriture (comme
 * `collectRegistrationErrors` pour ST 4.1).
 *
 * @returns un objet d'erreurs par champ ; `{}` si l'entrée est valide.
 */
export function collectImportFormErrors(input: ImportFormInput): ImportFormErrors {
  const errors: ImportFormErrors = {};

  const titre = (input.titre ?? "").trim();
  if (titre.length < IMPORT_TITRE_MIN_LENGTH) {
    errors.titre = "Le titre est requis.";
  } else if (titre.length > IMPORT_TITRE_MAX_LENGTH) {
    errors.titre = `Le titre ne doit pas dépasser ${IMPORT_TITRE_MAX_LENGTH} caractères.`;
  }

  if (!(ORIGINES_IMPORT as readonly string[]).includes(input.origine)) {
    errors.origine = `Origine invalide (valeurs acceptées : ${Object.values(ORIGINE_LABELS).join(", ")}).`;
  }

  if (!(TYPES_IMPORT as readonly string[]).includes(input.type)) {
    errors.type = `Type invalide (valeurs acceptées : ${Object.values(TYPE_LABELS).join(", ")}).`;
  }

  // ST 5.2 — certification des droits obligatoire à chaque import.
  const certificationErreur = erreurCertificationDroits(input.certifieDroits);
  if (certificationErreur) {
    errors.certifieDroits = certificationErreur;
  }

  return errors;
}

export function isImportFormValid(input: ImportFormInput): boolean {
  return Object.keys(collectImportFormErrors(input)).length === 0;
}

/* -------------------------------------------------------------------------- */
/*  Statut de job d'import + polling                                           */
/* -------------------------------------------------------------------------- */

/**
 * Cycle de vie d'un job d'import, tel qu'exposé au frontend :
 *  - `en_attente`    : job créé (fichier validé), compression pas encore prise ;
 *  - `en_traitement` : compression/transcodage FFmpeg en cours ;
 *  - `pret`          : extrait créé en bibliothèque au statut « en attente de
 *                      modération » (`extraitId` renseigné) ;
 *  - `echec`         : la compression a échoué (`error` renseigné).
 *
 * Le rejet à la **validation post-upload** (durée > 5 min, format, taille) ne
 * crée **pas** de job : l'endpoint répond directement `422` avec la raison (le
 * fichier est supprimé du stockage dans la foulée). Il n'y a donc pas de
 * statut `rejete` ici.
 */
export type ImportJobStatus = "en_attente" | "en_traitement" | "pret" | "echec";

const TERMINAL_IMPORT_STATUSES: readonly ImportJobStatus[] = ["pret", "echec"];

export function isTerminalImportStatus(status: ImportJobStatus): boolean {
  return TERMINAL_IMPORT_STATUSES.includes(status);
}

/**
 * Représentation d'un job d'import renvoyée par `POST /api/import` et
 * `GET /api/import/:id`. Ne contient jamais la clé de stockage brute ni
 * l'identité de l'importateur — uniquement ce dont le frontend a besoin pour
 * suivre l'avancement puis rediriger vers l'extrait créé.
 */
export interface ImportJobView {
  id: string;
  status: ImportJobStatus;
  /** Progression indicative 0..1. */
  progress: number;
  /** Id de l'extrait créé en bibliothèque — présent uniquement si `status === "pret"`. */
  extraitId?: string;
  /** Message d'erreur utilisateur — présent uniquement si `status === "echec"`. */
  error?: string;
}

export const IMPORT_POLL_MIN_DELAY_MS = 1500;
export const IMPORT_POLL_MAX_DELAY_MS = 8000;

/**
 * Délai avant la prochaine interrogation de `GET /api/import/:id`, avec un
 * back-off exponentiel borné : la compression d'une vidéo est plus longue
 * qu'un mixage audio (ST 3.1), on part donc d'un intervalle plus large et on
 * plafonne plus haut.
 *
 * `attempt` est le numéro de la tentative écoulée (0 = tout premier poll).
 */
export function computeNextImportPollDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const delay = IMPORT_POLL_MIN_DELAY_MS * 2 ** safeAttempt;
  return Math.min(delay, IMPORT_POLL_MAX_DELAY_MS);
}

/* -------------------------------------------------------------------------- */
/*  Titre par défaut                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Propose un titre lisible à partir du nom de fichier : retire l'extension,
 * remplace `_`/`-`/`.` par des espaces, condense les espaces, tronque à
 * `IMPORT_TITRE_MAX_LENGTH`. Ex. : `"ma_scene_finale.v2.mp4"` → `"ma scene finale v2"`.
 * Renvoie `""` si rien d'exploitable (le formulaire redemandera un titre).
 */
export function suggestTitreFromFilename(filename: string): string {
  const base = (filename ?? "").trim().replace(/\.[a-z0-9]+$/i, "");
  return base
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, IMPORT_TITRE_MAX_LENGTH);
}

/** Formate un nombre d'octets en Mo entiers, pour les messages utilisateur. */
function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} Mo`;
}
