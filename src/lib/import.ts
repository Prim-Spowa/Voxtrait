/**
 * Orchestration serveur de l'import de vidéos personnelles — ST 5.1 « Import et
 * compression vidéo » (US 5.1 : importer un extrait vidéo personnel).
 *
 * Découpage en tâches ST 5.1 :
 *  1. Endpoint de génération d'URL signée d'upload   → `src/app/api/import/upload-url/route.ts` + `createSignedUpload` (ce module)
 *  2. Validation post-upload : durée, format, taille → `finalizeImport` (ce module) + `validateProbedVideo` (`lib/importClient.ts`)
 *  3. Job de compression/transcodage FFmpeg          → `runImportJob` + `VideoCompressor` (ce module), args via `lib/importFfmpegCommand.ts`
 *  4. Création de l'entrée `Extrait` (statut EN_ATTENTE) → `finishImportJob` via `ExtraitLibraryWriter` (ce module)
 *
 * ⚠️ Périmètre d'implémentation — même posture que ST 3.1 (cf. tête de
 * `src/lib/doublage.ts`). La story cite un stockage objet S3 + URLs signées,
 * `ffprobe`/FFmpeg pour la sonde et la compression, une file de jobs
 * (BullMQ + Redis). Aucune de ces dépendances n'est installée. Ce module
 * fournit donc :
 *  - le **contrat** (`SignedUploadUrlIssuer`, `UploadedVideoProbe`,
 *    `VideoCompressor`, `ObjectStorageCleaner`, `ExtraitLibraryWriter`,
 *    `ImportJobStore`) et la **machine à états** du job, entièrement testables ;
 *  - une implémentation **en mémoire** par défaut (`createInMemoryImportJobStore`)
 *    et des adaptateurs **mock** (`src/lib/mocks/import.mock.ts`) pour la CI et
 *    la QA `DATA_SOURCE=mock`.
 * Le branchement des vraies briques (client S3, spawn `ffprobe`/`ffmpeg`,
 * worker BullMQ, `prisma.extrait.create`) se fait en fournissant d'autres
 * implémentations de ces interfaces, sans toucher au reste du code — signalé
 * comme point en suspens dans les notes de dev ST 5.1.
 */

import type { Origine, TypeContenu } from "@/types/extrait";
import { CERTIFICATION_DROITS_VERSION } from "@/lib/certificationDroits";
import { buildImportCompressionFfmpegArgs } from "@/lib/importFfmpegCommand";
import {
  collectImportFormErrors,
  MAX_IMPORT_DURATION_SECONDS,
  validateImportUploadRequest,
  validateProbedVideo,
  type ImportJobStatus,
  type ImportJobView,
  type ImportUploadRequestMetadata,
  type ProbedVideoMetadata,
} from "@/lib/importClient";

/** Durée de validité d'une URL d'upload signée (15 min) — cf. `DOUBLAGE_URL_TTL_SECONDS` (ST 3.1). */
export const IMPORT_UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Durée de rétention d'un job d'import terminé, avant purge
 * (`pruneExpiredImportJobs`). Le job ne sert qu'au suivi de progression puis à
 * la redirection vers l'extrait créé ; passé ce délai, l'extrait (persistant)
 * prend le relais. 1 h laisse le temps à un polling qui traîne.
 */
export const IMPORT_JOB_RETENTION_SECONDS = 60 * 60;

/* -------------------------------------------------------------------------- */
/*  Erreurs                                                                    */
/* -------------------------------------------------------------------------- */

/** Métadonnées d'upload invalides (format/taille déclarés) — mène à un `400`. */
export class ImportUploadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportUploadRequestError";
  }
}

/** Champs de classification (titre/origine/type) invalides — mène à un `400`. */
export class ImportFormValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super("Les informations de l'extrait importé sont invalides.");
    this.name = "ImportFormValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** Le fichier annoncé n'a pas été trouvé dans le stockage (upload jamais fait / clé inconnue) — `404`. */
export class UploadIntrouvableError extends Error {
  constructor() {
    super("Aucun fichier uploadé n'a été trouvé pour cette référence.");
    this.name = "UploadIntrouvableError";
  }
}

/**
 * La vidéo uploadée ne respecte pas les contraintes (durée > 5 min, format,
 * taille) — mène à un `422`. Le fichier a été **supprimé du stockage** avant
 * que cette erreur ne soit levée (cf. `finalizeImport`).
 */
export class ImportRejeteError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "ImportRejeteError";
    this.reason = reason;
  }
}

export class ImportJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job d'import introuvable : ${id}`);
    this.name = "ImportJobNotFoundError";
  }
}

/* -------------------------------------------------------------------------- */
/*  Contrats des briques externes (injectées)                                  */
/* -------------------------------------------------------------------------- */

export interface SignedUploadTarget {
  /** URL vers laquelle le client PUT/POST le fichier. */
  uploadUrl: string;
  /** Méthode HTTP à utiliser (S3 pré-signé = `PUT`). */
  method: "PUT" | "POST";
  /** En-têtes à renvoyer tels quels lors de l'upload (ex. `Content-Type`). */
  headers: Record<string, string>;
  /** Référence opaque de l'objet créé (clé S3), à renvoyer à `finalizeImport`. */
  objectRef: string;
  /** Expiration ISO de l'URL. */
  expiresAt: string;
}

export interface SignedUploadUrlIssuer {
  issue(args: {
    objectRef: string;
    contentType: string;
    ttlSeconds: number;
  }): Promise<Omit<SignedUploadTarget, "objectRef" | "expiresAt"> & { expiresAt: string }>;
}

/** Sonde les métadonnées réelles d'un objet uploadé (implémentée via `ffprobe`). */
export interface UploadedVideoProbe {
  /** `null` si l'objet n'existe pas / n'est pas lisible. */
  probe(objectRef: string): Promise<ProbedVideoMetadata | null>;
}

/** Compression/transcodage réel — implémenté par un worker qui spawn FFmpeg. */
export interface VideoCompressor {
  compress(
    job: ImportJob,
    onProgress?: (progress: number) => void
  ): Promise<{ outputRef: string; playbackUrl: string; mimeType?: string }>;
}

/** Suppression d'un objet du stockage (fichier rejeté, nettoyage). */
export interface ObjectStorageCleaner {
  delete(objectRef: string): Promise<void>;
}

/** Écriture de l'entrée bibliothèque — adaptateur vers `prisma.extrait.create` (ou le mock). */
export interface ExtraitLibraryWriter {
  create(input: {
    titre: string;
    origine: Origine;
    type: TypeContenu;
    /** URL de lecture de la vidéo compressée (sert `Extrait.urlSource`, `source = UPLOAD`). */
    urlSource: string;
    dureeSecondes: number;
    /** Id de l'utilisateur importateur (`Extrait.importeParId`). */
    importeParId: string;
    /**
     * ST 5.2 — horodatage de la certification des droits (`Extrait.certificationDroitsLe`).
     * Preuve individuelle, par extrait, exigée à chaque import.
     */
    certificationDroitsLe: Date;
    /** ST 5.2 — version du texte certifié (`Extrait.certificationDroitsVersion`). */
    certificationDroitsVersion: string;
  }): Promise<{ id: string }>;
}

/* -------------------------------------------------------------------------- */
/*  Job d'import                                                               */
/* -------------------------------------------------------------------------- */

export interface ImportJobInput {
  /** Clé de stockage du fichier source uploadé. */
  objectRef: string;
  /** Utilisateur qui importe (session vérifiée côté endpoint). */
  utilisateurId: string;
  titre: string;
  origine: Origine;
  type: TypeContenu;
  /** Durée réelle sondée (secondes) — déjà validée ≤ `MAX_IMPORT_DURATION_SECONDS`. */
  dureeSecondes: number;
  /** Type MIME réel sondé. */
  mimeType: string;
  /** Taille réelle du fichier source, en octets. */
  sizeBytes: number;
  /**
   * ST 5.2 — trace de la certification des droits faite à la soumission de
   * l'import (case à cocher obligatoire). Figée ici puis recopiée sur
   * l'`Extrait` créé par `runImportJob`.
   */
  certificationDroitsLe: string;
  certificationDroitsVersion: string;
}

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  input: ImportJobInput;
  /** Clé de la vidéo compressée produite par le `VideoCompressor`. */
  outputRef?: string;
  /** Id de l'extrait créé en bibliothèque (statut EN_ATTENTE) une fois `pret`. */
  extraitId?: string;
  /** Message d'erreur utilisateur — renseigné si `status === "echec"`. */
  error?: string;
  /** Instant à partir duquel le job peut être purgé (`pruneExpiredImportJobs`). */
  expiresAt?: string;
}

export interface ImportJobStore {
  create(input: ImportJobInput): Promise<ImportJob>;
  get(id: string): Promise<ImportJob | null>;
  update(id: string, patch: Partial<ImportJob>): Promise<ImportJob>;
  list(): Promise<ImportJob[]>;
  delete(id: string): Promise<void>;
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `ImportJobStore` — perdue au redémarrage du
 * process. Même réserve « multi-instances » que `createInMemoryDoublageJobStore`
 * (ST 3.1) : en déploiement serverless, chaque instance aurait sa propre `Map`
 * et le polling pourrait tomber sur une instance qui ne connaît pas le job.
 * C'est le rôle de Redis dans la story technique — signalé en notes de dev.
 */
export function createInMemoryImportJobStore(
  now: () => Date = () => new Date()
): ImportJobStore {
  const jobs = new Map<string, ImportJob>();

  return {
    async create(input) {
      const ts = now().toISOString();
      const job: ImportJob = {
        id: generateId("import"),
        status: "en_attente",
        progress: 0,
        createdAt: ts,
        updatedAt: ts,
        input,
      };
      jobs.set(job.id, job);
      return { ...job };
    },
    async get(id) {
      const job = jobs.get(id);
      return job ? { ...job } : null;
    },
    async update(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new ImportJobNotFoundError(id);
      const updated: ImportJob = {
        ...job,
        ...patch,
        id: job.id,
        updatedAt: now().toISOString(),
      };
      jobs.set(id, updated);
      return { ...updated };
    },
    async list() {
      return Array.from(jobs.values(), (job) => ({ ...job }));
    },
    async delete(id) {
      jobs.delete(id);
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  1. URL signée d'upload                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Prépare un upload direct vers le stockage objet — ST 5.1, découpage en
 * tâches point 1.
 *
 * Valide d'abord les métadonnées connues côté client
 * (`validateImportUploadRequest` : format/taille déclarés) : on ne génère une
 * URL signée que si l'import a une chance d'aboutir. La **durée** n'est pas
 * contrôlable ici (fichier pas encore uploadé) — elle le sera par
 * `finalizeImport`.
 *
 * L'upload passe **directement** du navigateur au stockage objet, pas par
 * l'API applicative (ST 5.1 « Choix techniques » : « éviter de saturer l'API
 * avec des transferts volumineux »).
 *
 * @throws {ImportUploadRequestError} métadonnées invalides
 */
export async function createSignedUpload(
  issuer: SignedUploadUrlIssuer,
  meta: ImportUploadRequestMetadata & { utilisateurId: string },
  ttlSeconds: number = IMPORT_UPLOAD_URL_TTL_SECONDS
): Promise<SignedUploadTarget> {
  const validationError = validateImportUploadRequest(meta);
  if (validationError) {
    throw new ImportUploadRequestError(validationError);
  }

  const objectRef = `imports/${meta.utilisateurId}/${generateId("src")}`;
  const contentType = meta.mimeType?.trim() || "application/octet-stream";

  const issued = await issuer.issue({ objectRef, contentType, ttlSeconds });

  return {
    uploadUrl: issued.uploadUrl,
    method: issued.method,
    headers: issued.headers,
    objectRef,
    expiresAt: issued.expiresAt,
  };
}

/* -------------------------------------------------------------------------- */
/*  2. Finalisation : validation post-upload + création du job                 */
/* -------------------------------------------------------------------------- */

export interface FinalizeImportDeps {
  store: ImportJobStore;
  probe: UploadedVideoProbe;
  cleaner: ObjectStorageCleaner;
  /** Horloge injectable — fige l'horodatage de la certification des droits (ST 5.2). */
  now?: () => Date;
}

export interface FinalizeImportInput {
  objectRef: string;
  utilisateurId: string;
  titre: string;
  origine: Origine;
  type: TypeContenu;
  /**
   * ST 5.2 — valeur de la case « je certifie mes droits » du formulaire
   * d'import. L'import n'est finalisé que si elle vaut `true`
   * (`collectImportFormErrors` → `ImportFormValidationError`).
   */
  certifieDroits?: unknown;
}

/**
 * Valide la vidéo réellement uploadée et crée le job de compression — ST 5.1,
 * découpage en tâches point 2.
 *
 * Séquence :
 *  1. sonde des métadonnées réelles (`probe.probe`) → `404` si introuvable ;
 *  2. `validateProbedVideo` (durée ≤ 5 min, format, taille). **En cas de
 *     rejet, le fichier est supprimé immédiatement du stockage**
 *     (`cleaner.delete`) puis `ImportRejeteError` est levée (→ `422`) — point
 *     d'attention ST 5.1 : « ne pas le laisser en stockage » ;
 *  3. re-validation des champs de classification (titre/origine/type) — le
 *     endpoint a déjà appelé `collectImportFormErrors`, on ne fait pas
 *     confiance au client (même logique que `registerUtilisateur`, ST 4.1) ;
 *  4. création du job en statut `en_attente`. La compression elle-même est
 *     déclenchée séparément par `runImportJob` (worker ou exécution inline).
 *
 * @throws {UploadIntrouvableError} objet absent du stockage
 * @throws {ImportRejeteError} vidéo non conforme (fichier déjà supprimé)
 * @throws {ImportFormValidationError} titre/origine/type invalides
 */
export async function finalizeImport(
  deps: FinalizeImportDeps,
  input: FinalizeImportInput
): Promise<ImportJob> {
  const objectRef = (input.objectRef ?? "").trim();
  if (!objectRef) throw new UploadIntrouvableError();

  const probed = await deps.probe.probe(objectRef);
  if (!probed) throw new UploadIntrouvableError();

  const verdict = validateProbedVideo(probed);
  if (!verdict.ok) {
    // Suppression immédiate : le fichier non conforme ne doit pas rester en
    // stockage (coût + risque). Best-effort : si la suppression échoue, on
    // rejette quand même l'import et on laisse la purge planifiée nettoyer.
    await deps.cleaner.delete(objectRef).catch(() => {
      /* la suppression est best-effort — ne pas masquer le motif du rejet */
    });
    throw new ImportRejeteError(verdict.reason);
  }

  const fieldErrors = collectImportFormErrors({
    titre: input.titre,
    origine: input.origine,
    type: input.type,
    certifieDroits: input.certifieDroits,
  });
  if (Object.keys(fieldErrors).length > 0) {
    // Le fichier est conforme mais la classification est invalide, ou la
    // certification des droits n'a pas été cochée (ST 5.2) : on nettoie aussi
    // (l'utilisateur devra recommencer l'upload).
    await deps.cleaner.delete(objectRef).catch(() => {});
    throw new ImportFormValidationError(fieldErrors as Record<string, string>);
  }

  // ST 5.2 — la certification vient d'être validée : on fige l'horodatage et
  // la version du texte, recopiés tels quels sur l'`Extrait` par `runImportJob`.
  const certificationDroitsLe = (deps.now?.() ?? new Date()).toISOString();

  return deps.store.create({
    objectRef,
    utilisateurId: input.utilisateurId,
    titre: input.titre.trim(),
    origine: input.origine,
    type: input.type,
    dureeSecondes: Math.round(probed.durationSeconds),
    mimeType: probed.mimeType,
    sizeBytes: probed.sizeBytes,
    certificationDroitsLe,
    certificationDroitsVersion: CERTIFICATION_DROITS_VERSION,
  });
}

/* -------------------------------------------------------------------------- */
/*  3-4. Compression + création de l'entrée bibliothèque                       */
/* -------------------------------------------------------------------------- */

export interface RunImportJobDeps {
  compressor: VideoCompressor;
  library: ExtraitLibraryWriter;
  cleaner?: ObjectStorageCleaner;
  now?: () => Date;
}

/**
 * Fait passer un job de `en_attente` à `pret` (ou `echec`) — ST 5.1, découpage
 * en tâches points 3 et 4 :
 *  - `compressor.compress` produit la vidéo transcodée (FFmpeg) ;
 *  - `library.create` crée l'entrée `Extrait` (`source = UPLOAD`,
 *    `statut = EN_ATTENTE` — « en attente de modération », cf. Epic 7) ;
 *  - le fichier source original est supprimé du stockage (`cleaner.delete`)
 *    une fois la version compressée en place : on ne conserve que le
 *    nécessaire (coût de stockage).
 *
 * Idempotence / concurrence : ne fait rien si le job n'est pas `en_attente`
 * (déjà pris, terminé, ou introuvable → lève). Toute exception du compresseur
 * ou de l'écriture est capturée et convertie en `status: "echec"` avec un
 * message générique (les détails techniques restent côté serveur, cf.
 * `runDoublageJob` ST 3.1).
 *
 * Cette fonction *ne planifie rien* : l'appelant (endpoint en mode « worker
 * inline » de dev, ou vrai worker BullMQ) décide quand l'exécuter. Elle est
 * `await`-able de bout en bout, ce qui permet le test d'intégration demandé
 * par la DoD ST 5.1 (« fichier limite 4:59 vs 5:01 »).
 */
export async function runImportJob(
  store: ImportJobStore,
  id: string,
  deps: RunImportJobDeps
): Promise<ImportJob> {
  const existing = await store.get(id);
  if (!existing) throw new ImportJobNotFoundError(id);
  if (existing.status !== "en_attente") return existing;

  await store.update(id, { status: "en_traitement", progress: 0.05 });

  try {
    const { outputRef, playbackUrl } = await deps.compressor.compress(
      { ...existing, status: "en_traitement" },
      (progress) => {
        void store
          .update(id, { progress: clampProgress(progress) })
          .catch(() => {
            /* progression best-effort : ne jamais faire échouer la compression */
          });
      }
    );

    const extrait = await deps.library.create({
      titre: existing.input.titre,
      origine: existing.input.origine,
      type: existing.input.type,
      urlSource: playbackUrl,
      dureeSecondes: existing.input.dureeSecondes,
      importeParId: existing.input.utilisateurId,
      // ST 5.2 — preuve de certification recopiée sur l'extrait créé.
      certificationDroitsLe: new Date(existing.input.certificationDroitsLe),
      certificationDroitsVersion: existing.input.certificationDroitsVersion,
    });

    // La version compressée est en bibliothèque : le fichier source brut ne
    // sert plus. Suppression best-effort (ne fait pas échouer l'import).
    if (deps.cleaner) {
      await deps.cleaner.delete(existing.input.objectRef).catch(() => {});
    }

    const nowMs = (deps.now?.() ?? new Date()).getTime();
    return await store.update(id, {
      status: "pret",
      progress: 1,
      outputRef,
      extraitId: extrait.id,
      error: undefined,
      expiresAt: new Date(nowMs + IMPORT_JOB_RETENTION_SECONDS * 1000).toISOString(),
    });
  } catch {
    return store.update(id, {
      status: "echec",
      progress: 1,
      error:
        "La compression de la vidéo a échoué. Réessayez ; si le problème persiste, signalez-le.",
      expiresAt: new Date(
        (deps.now?.() ?? new Date()).getTime() + IMPORT_JOB_RETENTION_SECONDS * 1000
      ).toISOString(),
    });
  }
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0.05;
  return Math.min(0.95, Math.max(0.05, progress));
}

/**
 * Construit (sans l'exécuter) la commande FFmpeg de compression pour un job —
 * exposé pour que le `VideoCompressor` réel s'en serve, et pour tester la
 * cohérence des entrées d'un job. Borne la sortie à `MAX_IMPORT_DURATION_SECONDS`
 * par sécurité.
 */
export function buildImportJobFfmpegArgs(job: ImportJob, outputPath: string): string[] {
  return buildImportCompressionFfmpegArgs({
    inputPath: job.input.objectRef,
    outputPath,
    maxDurationSeconds: MAX_IMPORT_DURATION_SECONDS,
  });
}

/* -------------------------------------------------------------------------- */
/*  Purge des jobs terminés                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Supprime les jobs d'import dont la rétention a expiré (`expiresAt` dépassé).
 * L'extrait créé, lui, est persistant : seul l'objet de suivi disparaît. À
 * appeler périodiquement (cron) ou, faute de mieux en dev, opportunément.
 *
 * @returns le nombre de jobs purgés.
 */
export async function pruneExpiredImportJobs(
  store: ImportJobStore,
  now: Date = new Date()
): Promise<number> {
  const jobs = await store.list();
  let purged = 0;
  for (const job of jobs) {
    if (!job.expiresAt) continue;
    if (new Date(job.expiresAt).getTime() > now.getTime()) continue;
    await store.delete(job.id);
    purged += 1;
  }
  return purged;
}

/* -------------------------------------------------------------------------- */
/*  Projection vers la vue client                                              */
/* -------------------------------------------------------------------------- */

/**
 * Réduit un `ImportJob` interne à la `ImportJobView` renvoyée par l'API : on
 * retire la clé de stockage, l'identité de l'importateur et la référence de
 * sortie — le client n'a besoin que du statut, de la progression et, à la fin,
 * de l'id de l'extrait créé (pour rediriger vers sa page).
 */
export function toImportJobView(job: ImportJob): ImportJobView {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    ...(job.status === "pret" && job.extraitId ? { extraitId: job.extraitId } : {}),
    ...(job.status === "echec" && job.error ? { error: job.error } : {}),
  };
}
