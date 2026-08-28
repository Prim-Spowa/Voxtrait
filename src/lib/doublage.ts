/**
 * Orchestration serveur de la génération du fichier de doublage — ST 3.1
 * « Génération et téléchargement du fichier de doublage ».
 *
 * Découpage en tâches ST 3.1 :
 *  1. `POST /api/doublages` recevant le blob audio + référence extrait  → `src/app/api/doublages/route.ts`
 *  2. Job de mixage FFmpeg (file d'attente)                            → ce module (`runDoublageJob` + `DoublageProcessor`)
 *  3. Stockage du fichier généré + URL signée expirante               → ce module (`SignedUrlIssuer`)
 *  4. Notification frontend (polling) + déclenchement du téléchargement → `GET /api/doublages/:id` + `DoublageExport`
 *
 * ⚠️ Périmètre d'implémentation. La story technique cite BullMQ + Redis pour
 * la file de jobs, FFmpeg pour le mixage, un stockage objet S3 pour la sortie
 * et des URLs signées. Aucune de ces dépendances n'est installée dans le
 * projet à ce stade (cf. `package.json` — même situation que Postgres, non
 * validé en environnement réel, cf. notes de dev ST 1.1). Ce module fournit
 * donc :
 *  - le **contrat** (`DoublageJobStore`, `DoublageProcessor`, `SignedUrlIssuer`)
 *    et la **machine à états** du job, entièrement testables ;
 *  - une implémentation **en mémoire** par défaut (`createInMemoryDoublageJobStore`)
 *    et des adaptateurs **mock** (`src/lib/mocks/doublage.mock.ts`) pour la CI
 *    et la page de QA `DATA_SOURCE=mock`.
 * Le branchement des vraies briques (worker BullMQ, spawn FFmpeg, client S3)
 * se fait en fournissant d'autres implémentations de ces interfaces, sans
 * toucher au reste du code — signalé comme point en suspens dans les notes de
 * dev ST 3.1.
 */

import type { DoublageJobStatus, DoublageJobView } from "@/lib/doublageClient";
import { buildDoublageDownloadFilename } from "@/lib/doublageClient";
import {
  DEFAULT_MIX_MODE,
  DOUBLAGE_OUTPUT_MIME_TYPE,
  type DoublageMixMode,
} from "@/lib/ffmpegCommand";

/** Durée de validité d'une URL de téléchargement générée (15 min). */
export const DOUBLAGE_URL_TTL_SECONDS = 15 * 60;

/** Données d'entrée nécessaires pour créer un job (issues de `POST /api/doublages`). */
export interface DoublageJobInput {
  extraitId: string;
  /** Titre de l'extrait, pour le nom du fichier téléchargé (optionnel). */
  extraitTitre?: string | null;
  /** URL/chemin de la vidéo source (résolu depuis l'extrait côté endpoint). */
  videoSourceUrl: string;
  /** Référence opaque vers le blob audio persisté temporairement (chemin, clé S3…). */
  audioRef: string;
  audioMimeType: string;
  audioSizeBytes: number;
  audioDurationSeconds: number;
  /** Décalage voix/vidéo en secondes (`startedAtVideoTimeSeconds` du recorder). */
  audioOffsetSeconds: number;
  mode?: DoublageMixMode;
}

/** Job tel que stocké côté serveur — inclut des champs internes non exposés au client. */
export interface DoublageJob {
  id: string;
  status: DoublageJobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  input: DoublageJobInput;
  /** Référence du fichier de sortie produit par le `DoublageProcessor` (clé S3, chemin…). */
  outputRef?: string;
  outputMimeType?: string;
  downloadUrl?: string;
  downloadFilename?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * Sous-ensemble d'un store de jobs — permet une implémentation en mémoire
 * (défaut / test) ou, plus tard, Redis. Même approche « delegate injecté »
 * que `ExtraitDelegate` (ST 1.1) ou `ScriptLigneDelegate` (ST 1.3).
 */
export interface DoublageJobStore {
  create(input: DoublageJobInput): Promise<DoublageJob>;
  get(id: string): Promise<DoublageJob | null>;
  update(id: string, patch: Partial<DoublageJob>): Promise<DoublageJob>;
  list(): Promise<DoublageJob[]>;
  delete(id: string): Promise<void>;
}

/**
 * Brique de mixage réelle — implémentée par un worker qui spawn FFmpeg avec
 * les arguments de `buildDoublageFfmpegArgs`. Injectée pour rester testable
 * (FFmpeg absent de la CI) et mockable sur la page de QA.
 *
 * `onProgress` permet au worker de remonter une progression 0..1.
 */
export interface DoublageProcessor {
  mix(
    job: DoublageJob,
    onProgress?: (progress: number) => void
  ): Promise<{ outputRef: string; outputMimeType?: string }>;
}

/** Génère une URL de téléchargement signée et expirante pour un fichier de sortie. */
export interface SignedUrlIssuer {
  issue(outputRef: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }>;
}

export class DoublageJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job de doublage introuvable : ${id}`);
    this.name = "DoublageJobNotFoundError";
  }
}

// --- Store en mémoire ---------------------------------------------------

function generateJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doublage-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Implémentation en mémoire du `DoublageJobStore` — perdue au redémarrage du
 * process (acceptable : les fichiers de sortie sont eux-mêmes temporaires, cf.
 * « nettoyage des fichiers temporaires » dans les points d'attention ST 3.1).
 *
 * ⚠️ En déploiement multi-instances / serverless, chaque instance aurait son
 * propre `Map` : le polling `GET /api/doublages/:id` pourrait tomber sur une
 * instance qui ne connaît pas le job. C'est précisément le rôle de Redis dans
 * la story technique — signalé en notes de dev. Pour le dev local
 * (`next dev`, process unique) et les tests, ce store suffit.
 */
export function createInMemoryDoublageJobStore(
  now: () => Date = () => new Date()
): DoublageJobStore {
  const jobs = new Map<string, DoublageJob>();

  return {
    async create(input) {
      const ts = now().toISOString();
      const job: DoublageJob = {
        id: generateJobId(),
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
      if (!job) throw new DoublageJobNotFoundError(id);
      const updated: DoublageJob = { ...job, ...patch, id: job.id, updatedAt: now().toISOString() };
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

// --- Machine à états du job -------------------------------------------

export interface RunDoublageJobDeps {
  processor: DoublageProcessor;
  issuer: SignedUrlIssuer;
  ttlSeconds?: number;
}

/**
 * Fait passer un job de `en_attente` à `pret` (ou `echec`) : appelle le
 * `DoublageProcessor` pour produire le fichier, puis le `SignedUrlIssuer` pour
 * l'URL de téléchargement.
 *
 * Idempotence / concurrence : ne fait rien si le job n'est pas `en_attente`
 * (déjà pris en charge, déjà terminé, ou introuvable) — retourne l'état
 * courant. Toute exception du processor ou de l'issuer est capturée et
 * convertie en `status: "echec"` avec un message utilisateur générique (les
 * détails techniques restent côté serveur).
 *
 * Cette fonction *ne planifie rien* : c'est l'appelant (le endpoint POST en
 * mode « worker inline » de dev, ou un vrai worker BullMQ) qui décide quand
 * l'exécuter. Elle est `await`-able de bout en bout, ce qui permet le test
 * d'intégration « bout-en-bout sur un extrait court » demandé par la DoD.
 */
export async function runDoublageJob(
  store: DoublageJobStore,
  id: string,
  deps: RunDoublageJobDeps
): Promise<DoublageJob> {
  const existing = await store.get(id);
  if (!existing) throw new DoublageJobNotFoundError(id);
  if (existing.status !== "en_attente") return existing;

  const ttl = deps.ttlSeconds ?? DOUBLAGE_URL_TTL_SECONDS;

  await store.update(id, { status: "en_traitement", progress: 0.05 });

  try {
    const { outputRef, outputMimeType } = await deps.processor.mix(
      { ...existing, status: "en_traitement" },
      (progress) => {
        // Progression best-effort : on borne dans [0.05, 0.95], le passage à 1
        // est réservé au statut `pret` une fois l'URL émise.
        void store
          .update(id, { progress: Math.min(0.95, Math.max(0.05, progress)) })
          .catch(() => {
            /* progression best-effort : ne jamais faire échouer le mixage */
          });
      }
    );

    const { url, expiresAt } = await deps.issuer.issue(outputRef, ttl);

    return await store.update(id, {
      status: "pret",
      progress: 1,
      outputRef,
      outputMimeType: outputMimeType ?? DOUBLAGE_OUTPUT_MIME_TYPE,
      downloadUrl: url,
      downloadFilename: buildDoublageDownloadFilename(existing.input.extraitTitre, id),
      expiresAt,
      error: undefined,
    });
  } catch (err) {
    // Le détail technique (`err`) est volontairement non propagé au client.
    return store.update(id, {
      status: "echec",
      progress: 1,
      error:
        "La génération du fichier de doublage a échoué. Réessayez ; si le problème persiste, signalez-le.",
    });
  }
}

/**
 * Supprime les jobs dont l'URL de téléchargement a expiré (et leur éventuel
 * fichier de sortie via `onDeleteOutput`) — « nettoyage des fichiers
 * temporaires » (points d'attention ST 3.1). À appeler périodiquement (cron /
 * tâche planifiée) ou, faute de mieux en dev, opportunément à chaque POST.
 *
 * @returns le nombre de jobs purgés.
 */
export async function pruneExpiredDoublageJobs(
  store: DoublageJobStore,
  now: Date = new Date(),
  onDeleteOutput?: (outputRef: string) => Promise<void> | void
): Promise<number> {
  const jobs = await store.list();
  let purged = 0;
  for (const job of jobs) {
    if (!job.expiresAt) continue;
    if (new Date(job.expiresAt).getTime() > now.getTime()) continue;
    if (job.outputRef && onDeleteOutput) {
      await onDeleteOutput(job.outputRef);
    }
    await store.delete(job.id);
    purged += 1;
  }
  return purged;
}

// --- Projection vers la vue client ----------------------------------

/**
 * Réduit un `DoublageJob` interne à la `DoublageJobView` renvoyée par l'API :
 * on retire la référence au blob audio, l'URL/chemin vidéo source et la clé de
 * sortie — le client n'a besoin que du statut, de la progression et, à la fin,
 * de l'URL de téléchargement.
 */
export function toDoublageJobView(job: DoublageJob): DoublageJobView {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    ...(job.status === "pret" && job.downloadUrl
      ? {
          downloadUrl: job.downloadUrl,
          downloadFilename: job.downloadFilename,
          expiresAt: job.expiresAt,
        }
      : {}),
    ...(job.status === "echec" && job.error ? { error: job.error } : {}),
  };
}

export { DEFAULT_MIX_MODE };
