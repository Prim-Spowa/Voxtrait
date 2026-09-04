import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { findExtraitById } from "@/lib/extraits";
import { readSessionFromCookieStore } from "@/lib/session";
import {
  chargerHistoriqueDoublages,
  type ResolveExtraitResume,
} from "@/lib/doublageSauvegarde";
import { getDoublageSauvegardeStore } from "@/lib/mocks/doublageSauvegarde.mock";
import {
  HistoriqueQueryError,
  parseHistoriqueQuery,
} from "@/lib/doublageSauvegardeClient";
import {
  normalizeAudioMimeType,
  validateDoublageRequest,
} from "@/lib/doublageClient";
import {
  pruneExpiredDoublageJobs,
  runDoublageJob,
  toDoublageJobView,
  type DoublageJobInput,
} from "@/lib/doublage";
import {
  createMockDoublageProcessor,
  createMockSignedUrlIssuer,
  getDoublageJobStore,
} from "@/lib/mocks/doublage.mock";
import type { DoublageMixMode } from "@/lib/ffmpegCommand";

/**
 * POST /api/doublages — ST 3.1 « Génération et téléchargement du fichier de
 * doublage », découpage en tâches point 1 : « Endpoint recevant le blob audio
 * + référence à l'extrait ».
 *
 * Corps accepté (deux formes) :
 *  - `multipart/form-data` : champ `audio` (fichier), `extraitId`,
 *    `audioDurationSeconds`, `audioOffsetSeconds` (optionnel), `mode` (optionnel) ;
 *  - `application/json` : `{ extraitId, audioBase64, audioMimeType,
 *    audioDurationSeconds, audioOffsetSeconds?, mode? }`.
 *
 * Réponse `202 Accepted` : `{ job: DoublageJobView }` — le traitement est
 * asynchrone, le frontend interroge ensuite `GET /api/doublages/:id`.
 *
 * ⚠️ Périmètre d'implémentation, cf. tête de `src/lib/doublage.ts` :
 *  - En l'absence de BullMQ/Redis, le job est exécuté **inline** (dans la
 *    requête, en `next dev` mono-process) via `runDoublageJob`. En production
 *    ce serait `queue.add(...)` puis retour immédiat.
 *  - En l'absence de client S3, le blob audio n'est **pas réellement
 *    persisté** : on ne conserve que ses métadonnées (taille, type, durée) et
 *    une référence factice. Le `DoublageProcessor` mock ne lit pas le fichier.
 *  - Aucun contrôle d'accès (US 3.1 = visiteur non authentifié ; ST 4.x non
 *    développé) — un rate limiting par IP serait à ajouter avant production.
 */
export async function POST(request: NextRequest) {
  let parsed: ParsedDoublageBody;
  try {
    parsed = await parseBody(request);
  } catch (err) {
    const message =
      err instanceof BadRequestError
        ? err.message
        : "Corps de requête invalide.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const validationError = validateDoublageRequest({
    extraitId: parsed.extraitId,
    audioMimeType: parsed.audioMimeType,
    audioSizeBytes: parsed.audioSizeBytes,
    audioDurationSeconds: parsed.audioDurationSeconds,
  });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const extrait = await findExtraitById(prisma.extrait, parsed.extraitId);
  if (!extrait) {
    return NextResponse.json(
      { error: "L'extrait de référence est introuvable." },
      { status: 404 }
    );
  }

  const store = getDoublageJobStore();

  // Nettoyage opportuniste des jobs expirés (« nettoyage des fichiers
  // temporaires », points d'attention ST 3.1). En production ce serait une
  // tâche planifiée dédiée ; ici on profite de chaque création de job.
  await pruneExpiredDoublageJobs(store).catch(() => {
    /* le nettoyage ne doit jamais faire échouer une création de job */
  });

  const input: DoublageJobInput = {
    extraitId: extrait.id,
    extraitTitre: extrait.titre,
    extraitThumbnail: extrait.thumbnail ?? null,
    videoSourceUrl: extrait.urlSource,
    audioRef: `pending-audio/${parsed.extraitId}-${Date.now()}`,
    audioMimeType: normalizeAudioMimeType(parsed.audioMimeType),
    audioSizeBytes: parsed.audioSizeBytes,
    audioDurationSeconds: parsed.audioDurationSeconds,
    audioOffsetSeconds: parsed.audioOffsetSeconds,
    mode: parsed.mode,
  };

  const job = await store.create(input);

  // --- Exécution inline du job (voir avertissement ci-dessus). ---
  // On n'attend PAS la fin : la réponse part immédiatement avec le job en
  // `en_attente`, et le frontend suit l'avancement par polling. `void` +
  // `.catch` pour ne pas laisser une promesse rejetée non gérée.
  void runDoublageJob(store, job.id, {
    processor: createMockDoublageProcessor(),
    issuer: createMockSignedUrlIssuer(),
  }).catch(() => {
    /* `runDoublageJob` convertit déjà les erreurs en `status: "echec"` */
  });

  return NextResponse.json(
    { job: toDoublageJobView(job) },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * GET /api/doublages?utilisateur=me — ST 6.2 « Historique des doublages »,
 * découpage en tâches point 1 : « Endpoint `GET /api/doublages?utilisateur=me`
 * paginé ».
 *
 * Renvoie la page demandée de l'historique des doublages **sauvegardés**
 * (ST 6.1) du compte connecté, les plus récents d'abord, chaque entrée enrichie
 * des métadonnées de l'extrait d'origine (titre, vignette — ST 1.1).
 *
 * Query params (cf. `parseHistoriqueQuery`) :
 *  - `utilisateur` : **obligatoire**, valeur `me` ;
 *  - `page` (défaut 1), `pageSize` (défaut 12, plafond 50).
 *
 * Réponses :
 *  - `200` `{ items, pagination }` (`DoublageHistoriqueResponse`) ;
 *  - `400` : query params invalides (`utilisateur` absent/≠ `me`, `page` non entier…) ;
 *  - `401` : pas de session valide.
 *
 * `Cache-Control: no-store` : contenu strictement personnel, jamais mis en cache.
 *
 * Source de données : Prisma/Postgres pour l'extrait et l'historique des
 * sauvegardes (ST 9.1 « Bascule intégrale sur PostgreSQL » — l'ancienne
 * bascule `DATA_SOURCE=mock` a été retirée).
 */
export async function GET(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const session = readSessionFromCookieStore(cookies());
  if (!session) {
    return NextResponse.json(
      { error: "Vous devez être connecté·e pour consulter votre historique." },
      { status: 401, headers: noStore }
    );
  }

  let query;
  try {
    query = parseHistoriqueQuery(new URL(request.url).searchParams);
  } catch (err) {
    if (err instanceof HistoriqueQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    throw err;
  }

  const resolveExtrait: ResolveExtraitResume = async (extraitId) => {
    const extrait = await findExtraitById(prisma.extrait, extraitId);
    if (!extrait) return null;
    return {
      titre: extrait.titre,
      thumbnail: extrait.thumbnail ?? null,
      origine: extrait.origine,
      type: extrait.type,
    };
  };

  const historique = await chargerHistoriqueDoublages(getDoublageSauvegardeStore(), {
    utilisateurId: session.sub,
    page: query.page,
    pageSize: query.pageSize,
    resolveExtrait,
  });

  return NextResponse.json(historique, { headers: noStore });
}

// --- Parsing du corps -------------------------------------------------

class BadRequestError extends Error {}

interface ParsedDoublageBody {
  extraitId: string;
  audioMimeType: string;
  audioSizeBytes: number;
  audioDurationSeconds: number;
  audioOffsetSeconds: number;
  mode?: DoublageMixMode;
}

const VALID_MODES: readonly DoublageMixMode[] = ["remplacer", "superposer"];

function parseMode(raw: unknown): DoublageMixMode | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "string" && (VALID_MODES as readonly string[]).includes(raw)) {
    return raw as DoublageMixMode;
  }
  throw new BadRequestError(`Mode de mixage inconnu : ${String(raw)}.`);
}

function parsePositiveNumber(raw: unknown, label: string, { allowZero = false } = {}): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw new BadRequestError(`Le champ ${label} est invalide.`);
  }
  return n;
}

async function parseBody(request: NextRequest): Promise<ParsedDoublageBody> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      throw new BadRequestError("Le fichier audio (champ « audio ») est manquant.");
    }
    return {
      extraitId: String(form.get("extraitId") ?? "").trim(),
      audioMimeType: audio.type || String(form.get("audioMimeType") ?? ""),
      audioSizeBytes: audio.size,
      audioDurationSeconds: parsePositiveNumber(
        form.get("audioDurationSeconds"),
        "audioDurationSeconds"
      ),
      audioOffsetSeconds: form.get("audioOffsetSeconds")
        ? parsePositiveNumber(form.get("audioOffsetSeconds"), "audioOffsetSeconds", {
            allowZero: true,
          })
        : 0,
      mode: parseMode(form.get("mode")),
    };
  }

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new BadRequestError("Corps JSON illisible.");
    }
    const base64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    if (!base64) {
      throw new BadRequestError("Le champ « audioBase64 » est manquant.");
    }
    return {
      extraitId: String(body.extraitId ?? "").trim(),
      audioMimeType: String(body.audioMimeType ?? ""),
      audioSizeBytes: estimateBase64Bytes(base64),
      audioDurationSeconds: parsePositiveNumber(
        body.audioDurationSeconds,
        "audioDurationSeconds"
      ),
      audioOffsetSeconds:
        body.audioOffsetSeconds != null
          ? parsePositiveNumber(body.audioOffsetSeconds, "audioOffsetSeconds", {
              allowZero: true,
            })
          : 0,
      mode: parseMode(body.mode),
    };
  }

  throw new BadRequestError(
    "Type de contenu non supporté : utilisez multipart/form-data ou application/json."
  );
}

/** Taille approximative (octets) d'un payload base64, sans le décoder entièrement. */
function estimateBase64Bytes(base64: string): number {
  const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}
