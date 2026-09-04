import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { readMediaObject } from "@/lib/media/localMediaStore";

/**
 * GET /api/media/play/[...ref] — ST 9.3, URL de lecture **permanente et non
 * signée** renvoyée par `resolveLocalPersistentPlaybackUrl`
 * (`src/lib/media/localObjectStorageAdapters.ts`) pour la vidéo compressée
 * d'un import (`Extrait.urlSource`, cf. `videoCompressor.ts`) — substitut
 * local à une URL de CDN public tant que ST 9.2 (stockage S3) n'est pas
 * fusionnée (cf. avertissement en tête de `localMediaStore.ts`).
 *
 * Supporte les requêtes `Range` (`206 Partial Content`) : indispensable pour
 * que le lecteur `<video>` natif (ST 1.2) puisse chercher dans la vidéo sans
 * la retélécharger entièrement.
 *
 * Pas de contrôle d'accès : une fois un extrait `VALIDE` (modération, Epic 7),
 * sa vidéo est publique au même titre qu'un lien EMBED YouTube/Vimeo — même
 * niveau d'exposition qu'une URL de CDN public en production.
 */
export async function GET(request: NextRequest, { params }: { params: { ref: string[] } }) {
  const ref = (params.ref ?? []).join("/");
  const object = await readMediaObject(ref).catch(() => null);
  if (!object) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  const mimeType = guessMimeTypeFromRef(ref);
  const range = request.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : object.sizeBytes - 1;
    if (
      !match ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > end ||
      end >= object.sizeBytes
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${object.sizeBytes}` },
      });
    }

    const stream = createReadStream(object.path, { start, end });
    return new NextResponse(Readable.toWeb(stream) as never, {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${object.sizeBytes}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const stream = createReadStream(object.path);
  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(object.sizeBytes),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function guessMimeTypeFromRef(ref: string): string {
  const lower = ref.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}
