import { NextRequest, NextResponse } from "next/server";
import { isMockDataSource } from "@/lib/config";
import { resolveImportAccess } from "@/lib/importAuth";
import {
  collectImportFormErrors,
  ORIGINES_IMPORT,
  TYPES_IMPORT,
} from "@/lib/importClient";
import {
  finalizeImport,
  runImportJob,
  pruneExpiredImportJobs,
  toImportJobView,
  ImportFormValidationError,
  ImportRejeteError,
  UploadIntrouvableError,
  type ExtraitLibraryWriter,
} from "@/lib/import";
import {
  createMockObjectStorageCleaner,
  createMockUploadedVideoProbe,
  createMockVideoCompressor,
  getImportJobStore,
  getMockImportLibraryWriter,
} from "@/lib/mocks/import.mock";
import { createLocalObjectStorageCleaner } from "@/lib/media/localObjectStorageAdapters";
import { createFfprobeVideoProbe } from "@/lib/videoProbe";
import { enqueueImportCompressionJob } from "@/lib/media/jobQueues";
import { prismaExtraitLibraryWriter } from "@/lib/importLibraryWriter";

/**
 * POST /api/import — ST 5.1 « Import et compression vidéo », découpage en
 * tâches points 2 à 4 : validation post-upload (durée ≤ 5 min, format,
 * taille), job de compression FFmpeg, création de l'entrée `Extrait` au statut
 * « en attente de modération ».
 *
 * Appelé par le client **après** avoir uploadé le fichier via l'URL signée
 * (`POST /api/import/upload-url`). Réservé aux comptes ayant accepté les CGU.
 *
 * Corps attendu (`application/json`) :
 * `{ "objectRef": string, "titre": string, "origine": "FR"|"US"|"JP",
 *    "type": "FILM"|"SERIE"|"DESSIN_ANIME", "certifieDroits": true }`.
 * `certifieDroits` (ST 5.2) doit valoir `true` — case à cocher obligatoire ;
 * sinon `400` avec `fieldErrors.certifieDroits`.
 * La **durée** n'est pas fournie par le client : elle est sondée côté serveur
 * (impossible de faire confiance à une valeur cliente, cf. ST 5.1 « Choix
 * techniques »).
 *
 * Réponses :
 *  - `202` `{ job: ImportJobView }` : fichier validé, compression lancée — le
 *    frontend interroge `GET /api/import/:id` jusqu'au statut `pret`
 *    (`extraitId` renseigné) ou `echec` ;
 *  - `400` `{ error, fieldErrors? }` : corps illisible / titre-origine-type invalides ;
 *  - `401` / `403` `{ error }` : session absente / CGU non acceptées ;
 *  - `404` `{ error }` : aucun fichier uploadé pour `objectRef` ;
 *  - `422` `{ error }` : vidéo non conforme (durée > 5 min, format, taille) —
 *    **le fichier a été supprimé du stockage** (point d'attention ST 5.1).
 *
 * ⚠️ Périmètre — ST 9.3 « Traitement vidéo réel » : sonde (`ffprobe`) et
 * compression (`ffmpeg`) réelles hors `DATA_SOURCE=mock`, job de compression
 * exécuté via BullMQ (`enqueueImportCompressionJob`, consommé par
 * `scripts/worker.ts`) plutôt qu'inline. Stockage du fichier source **local**
 * (`localMediaStore.ts`), substitut provisoire à S3 tant que ST 9.2 n'est pas
 * fusionnée sur `main` (cf. avertissement en tête de ce module).
 */
export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const access = await resolveImportAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: noStore });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Corps de requête JSON invalide." },
      { status: 400, headers: noStore }
    );
  }

  const objectRef = typeof body.objectRef === "string" ? body.objectRef.trim() : "";
  const titre = typeof body.titre === "string" ? body.titre : "";
  const origineRaw = typeof body.origine === "string" ? body.origine.toUpperCase() : "";
  const typeRaw = typeof body.type === "string" ? body.type.toUpperCase() : "";
  // ST 5.2 — case de certification des droits (case à cocher du formulaire).
  const certifieDroits = body.certifieDroits === true;

  if (!objectRef) {
    return NextResponse.json(
      { error: "La référence du fichier uploadé (« objectRef ») est manquante." },
      { status: 400, headers: noStore }
    );
  }

  // Validation de forme partagée client/serveur (source de vérité :
  // `collectImportFormErrors`). `finalizeImport` la rejoue aussi, mais on
  // renvoie ici des `fieldErrors` détaillés pour le formulaire.
  const fieldErrors = collectImportFormErrors({
    titre,
    origine: origineRaw,
    type: typeRaw,
    certifieDroits,
  });
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: "Les informations de l'extrait sont invalides.", fieldErrors },
      { status: 400, headers: noStore }
    );
  }

  const origine = origineRaw as (typeof ORIGINES_IMPORT)[number];
  const type = typeRaw as (typeof TYPES_IMPORT)[number];

  const store = getImportJobStore();
  await pruneExpiredImportJobs(store).catch(() => {
    /* le nettoyage ne doit jamais faire échouer un import */
  });

  const mock = isMockDataSource();
  const cleaner = mock ? createMockObjectStorageCleaner() : createLocalObjectStorageCleaner();
  const library: ExtraitLibraryWriter = mock
    ? getMockImportLibraryWriter()
    : prismaExtraitLibraryWriter();

  let job;
  try {
    job = await finalizeImport(
      {
        store,
        probe: mock ? createMockUploadedVideoProbe() : createFfprobeVideoProbe(),
        cleaner,
      },
      { objectRef, utilisateurId: access.utilisateurId, titre, origine, type, certifieDroits }
    );
  } catch (err) {
    if (err instanceof UploadIntrouvableError) {
      return NextResponse.json({ error: err.message }, { status: 404, headers: noStore });
    }
    if (err instanceof ImportRejeteError) {
      return NextResponse.json({ error: err.reason }, { status: 422, headers: noStore });
    }
    if (err instanceof ImportFormValidationError) {
      return NextResponse.json(
        { error: err.message, fieldErrors: err.fieldErrors },
        { status: 400, headers: noStore }
      );
    }
    return NextResponse.json(
      { error: "La finalisation de l'import a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }

  if (mock) {
    // --- Exécution inline du job de compression (mode mock/QA/tests). ---
    // On n'attend PAS la fin : réponse immédiate avec le job `en_attente`, le
    // frontend suit l'avancement par polling.
    void runImportJob(store, job.id, {
      compressor: createMockVideoCompressor(),
      library,
      cleaner,
    }).catch(() => {
      /* `runImportJob` convertit déjà les erreurs en `status: "echec"` */
    });
  } else {
    // --- Exécution asynchrone via BullMQ (ST 9.3) ---
    // Le job métier existe déjà (`store.create` dans `finalizeImport`) ; on ne
    // fait qu'ajouter une entrée à la file — le worker (`scripts/worker.ts`)
    // appellera `runImportJob` avec le vrai compresseur FFmpeg. Best-effort :
    // si l'ajout à la file échoue (Redis indisponible), le job reste visible
    // en `en_attente` jusqu'à sa purge (`pruneExpiredImportJobs`) — signalé en
    // notes de dev comme limite à surveiller.
    await enqueueImportCompressionJob(job.id).catch(() => {});
  }

  return NextResponse.json(
    { job: toImportJobView(job) },
    { status: 202, headers: noStore }
  );
}
