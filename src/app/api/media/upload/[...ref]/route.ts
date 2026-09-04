import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { InvalidMediaRefError, writeMediaObjectFromStream } from "@/lib/media/localMediaStore";
import { verifyMediaToken } from "@/lib/media/mediaUrlSigning";

/**
 * PUT /api/media/upload/[...ref] — ST 9.3, cible de l'URL « signée »
 * renvoyée par `createLocalSignedUploadUrlIssuer`
 * (`src/lib/media/localObjectStorageAdapters.ts`), qui remplace l'upload
 * direct-vers-S3 prévu par ST 5.1/ST 9.2 tant que ST 9.2 n'est pas fusionnée
 * (cf. avertissement en tête de `localMediaStore.ts`).
 *
 * Le client PUT directement ici avec les octets du fichier (comportement
 * identique à un PUT S3 pré-signé du point de vue du frontend — même contrat
 * `SignedUploadTarget`, `src/lib/import.ts`). Autorisation : jeton HMAC en
 * query string (`exp`/`sig`), pas de session applicative — une URL signée
 * S3 ne porte pas non plus l'identité de l'utilisateur·rice, seulement une
 * autorisation d'écrire à un endroit précis pendant un temps limité.
 *
 * Réponses : `204` (succès), `403` (jeton absent/invalide/expiré), `400`
 * (référence de fichier invalide), `500` (échec d'écriture disque).
 */
export async function PUT(request: NextRequest, { params }: { params: { ref: string[] } }) {
  const ref = (params.ref ?? []).join("/");
  const { searchParams } = new URL(request.url);

  if (!verifyMediaToken(ref, searchParams.get("exp"), searchParams.get("sig"))) {
    return NextResponse.json(
      { error: "Jeton d'upload invalide, expiré, ou destiné à une autre référence." },
      { status: 403 }
    );
  }

  if (!request.body) {
    return NextResponse.json({ error: "Corps de requête manquant." }, { status: 400 });
  }

  try {
    // `NextRequest.body` est un `ReadableStream` (Web Streams) — converti en
    // flux Node pour l'écriture disque (`writeMediaObjectFromStream`).
    await writeMediaObjectFromStream(ref, Readable.fromWeb(request.body as never));
  } catch (err) {
    if (err instanceof InvalidMediaRefError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "L'enregistrement du fichier a échoué. Réessayez." },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
