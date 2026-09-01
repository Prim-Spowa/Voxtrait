import { NextRequest, NextResponse } from "next/server";
import { resolveImportAccess } from "@/lib/importAuth";
import { clientIp } from "@/lib/requestIp";
import { createFixedWindowRateLimiter, type RateLimiter } from "@/lib/rateLimit";
import {
  createSignedUpload,
  ImportUploadRequestError,
  IMPORT_UPLOAD_URL_TTL_SECONDS,
} from "@/lib/import";
import { createMockSignedUploadUrlIssuer } from "@/lib/mocks/import.mock";

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
 * ⚠️ Périmètre, cf. tête de `src/lib/import.ts` : l'URL signée est **mockée**
 * (aucune signature réelle, pas de client S3). Le rate limiting est en
 * mémoire par process (même réserve que ST 4.1).
 */

/** Fenêtre : 20 demandes d'URL par IP toutes les 10 minutes. */
const UPLOAD_URL_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 } as const;

const globalForImportUpload = globalThis as unknown as {
  importUploadRateLimiter?: RateLimiter;
};

function getRateLimiter(): RateLimiter {
  if (!globalForImportUpload.importUploadRateLimiter) {
    globalForImportUpload.importUploadRateLimiter =
      createFixedWindowRateLimiter(UPLOAD_URL_RATE_LIMIT);
  }
  return globalForImportUpload.importUploadRateLimiter;
}

export async function POST(request: NextRequest) {
  const noStore = { "Cache-Control": "no-store" };

  const access = await resolveImportAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: noStore });
  }

  const decision = getRateLimiter().check(clientIp(request));
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

  // La brique S3 étant absente, l'issuer réel n'existe pas encore : on utilise
  // toujours le mock (cf. avertissement `src/lib/import.ts`).
  const issuer = createMockSignedUploadUrlIssuer();

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
