import { NextRequest, NextResponse } from "next/server";
import { isMockDataSource } from "@/lib/config";
import { resolveImportAccess } from "@/lib/importAuth";
import { clientIp } from "@/lib/requestIp";
import { getFixedWindowRateLimiter } from "@/lib/rateLimiterFactory";
import {
  createSignedUpload,
  ImportUploadRequestError,
  IMPORT_UPLOAD_URL_TTL_SECONDS,
} from "@/lib/import";
import { createMockSignedUploadUrlIssuer } from "@/lib/mocks/import.mock";
import { createLocalSignedUploadUrlIssuer } from "@/lib/media/localObjectStorageAdapters";

/**
 * POST /api/import/upload-url — ST 5.1 « Import et compression vidéo »,
 * découpage en tâches point 1 : « Endpoint de génération d'URL signée
 * d'upload ».
 *
 * Réservé aux comptes ayant accepté les CGU (ST 4.2 + ST 4.3 : « bloque
 * ST 5.1 ») — cf. `resolveImportAccess`.
 *
 * Corps attendu (`application/json`) :
 * `{ "filename": string, "contentType": string, "sizeBytes": number }`.
 *
 * Réponses :
 *  - `200` `{ upload: { url, method, headers, objectRef, expiresAt } }` :
 *    le client PUT ensuite le fichier directement vers `url`, puis appelle
 *    `POST /api/import` avec `objectRef` ;
 *  - `400` `{ error }` : corps illisible ou métadonnées invalides
 *    (format/taille — la durée est contrôlée après upload) ;
 *  - `401` / `403` `{ error }` : session absente / CGU non acceptées ;
 *  - `429` `{ error }` + `Retry-After` : trop de demandes depuis la même IP.
 *
 * ⚠️ Périmètre — ST 9.3 : l'URL signée pointe vers le stockage **local**
 * (`localMediaStore.ts`/`PUT /api/media/upload/:ref`, signée par HMAC — cf.
 * `mediaUrlSigning.ts`), substitut provisoire à une vraie URL S3 pré-signée
 * tant que ST 9.2 n'est pas fusionnée sur `main`. Reste mockée si
 * `DATA_SOURCE=mock`. Le rate limiting est persisté dans Redis
 * (`getFixedWindowRateLimiter`, ST 9.4), en mémoire par process seulement en
 * mode `DATA_SOURCE=mock`.
 */

/** Fenêtre : 20 demandes d'URL par IP toutes les 10 minutes. */
const UPLOAD_URL_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 } as const;

function getRateLimiter() {
  return getFixedWindowRateLimiter("import-upload-url", UPLOAD_URL_RATE_LIMIT);
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const access = await resolveImportAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: noStore });
  }

  const decision = await getRateLimiter().check(clientIp(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Trop de demandes d'import. Réessayez dans quelques minutes." },
      {
        status: 429,
        headers: { ...noStore, "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) },
      }
    );
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

  const filename = typeof body.filename === "string" ? body.filename : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const sizeBytes = Number(body.sizeBytes);

  const issuer = isMockDataSource()
    ? createMockSignedUploadUrlIssuer()
    : createLocalSignedUploadUrlIssuer();

  try {
    const upload = await createSignedUpload(
      issuer,
      { filename, mimeType: contentType, sizeBytes, utilisateurId: access.utilisateurId },
      IMPORT_UPLOAD_URL_TTL_SECONDS
    );
    return NextResponse.json({ upload }, { status: 200, headers: noStore });
  } catch (err) {
    if (err instanceof ImportUploadRequestError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    return NextResponse.json(
      { error: "La préparation de l'import a échoué. Réessayez plus tard." },
      { status: 500, headers: noStore }
    );
  }
}
