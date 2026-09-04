import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { readMediaObject } from "@/lib/media/localMediaStore";
import { verifyMediaToken } from "@/lib/media/mediaUrlSigning";

/**
 * GET /api/media/download/[...ref] — ST 9.3, cible de l'URL signée renvoyée
 * par `createLocalSignedUrlIssuer` (`src/lib/media/localObjectStorageAdapters.ts`)
 * pour le fichier de doublage généré (ST 3.1) — substitut local à une URL S3
 * pré-signée (`GetObjectCommand` + `getSignedUrl`, cf. notes de dev ST 9.2)
 * tant que ST 9.2 n'est pas fusionnée.
 *
 * Contrairement à `GET /api/media/play/[...ref]` (permanent, non signé), cette
 * route vérifie un jeton HMAC `exp`/`sig` — le fichier de doublage est un
 * artefact **temporaire** par job (`DOUBLAGE_URL_TTL_SECONDS`, 15 min,
 * `lib/doublage.ts`), pas un asset de bibliothèque public.
 *
 * `filename` (optionnel) : nom de fichier suggéré au téléchargement
 * (`buildDoublageDownloadFilename`, `lib/doublageClient.ts`) — renvoyé tel
 * quel dans `Content-Disposition`, échappé pour rester dans les limites d'un
 * en-tête HTTP (pas de guillemets/retours à la ligne).
 */
export async function GET(request: NextRequest, { params }: { params: { ref: string[] } }) {
  const ref = (params.ref ?? []).join("/");
  const { searchParams } = new URL(request.url);

  if (!verifyMediaToken(ref, searchParams.get("exp"), searchParams.get("sig"))) {
    return NextResponse.json(
      { error: "Lien de téléchargement invalide ou expiré." },
      { status: 403 }
    );
  }

  const object = await readMediaObject(ref).catch(() => null);
  if (!object) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  const filename = sanitizeFilename(searchParams.get("filename")) ?? "doublage.mp4";
  const stream = createReadStream(object.path);

  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(object.sizeBytes),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Retire tout caractère susceptible de casser l'en-tête `Content-Disposition`. */
function sanitizeFilename(raw: string | null): string | null {
  if (!raw) return null;
  const clean = raw.replace(/["\r\n]/g, "").trim();
  return clean || null;
}
