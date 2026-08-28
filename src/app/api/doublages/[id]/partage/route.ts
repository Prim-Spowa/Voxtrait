import { NextRequest, NextResponse } from "next/server";
import {
  DoublageJobNotFoundError,
  DoublageJobNotReadyError,
  publishDoublageJob,
  toDoublageJobView,
} from "@/lib/doublage";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";

/**
 * POST /api/doublages/:id/partage — ST 3.2, découpage en tâches point 3 :
 * « Gestion de la visibilité (public dès génération du lien, indépendamment
 * de la sauvegarde privée) ».
 *
 * Rend le doublage `:id` partageable : passe sa visibilité à `lien_public` et
 * renvoie la `DoublageJobView` enrichie de `shareUrl` (URL absolue de la page
 * publique `/doublage/:id`). Le frontend (`DoublageExport`) appelle cette
 * route quand l'utilisateur clique sur « Partager ».
 *
 * Idempotent : ré-appelée, elle renvoie la même URL sans rien modifier.
 *
 * ⚠️ Périmètre, cf. tête de `src/lib/doublage.ts` : le store de jobs est en
 * mémoire (`getDoublageJobStore`). Un lien public ne survit donc ni au
 * redémarrage du process, ni au-delà de l'expiration du job (TTL 15 min,
 * `pruneExpiredDoublageJobs`). La persistance réelle d'un doublage partagé
 * (modèle Prisma) est signalée en notes de dev ST 3.2.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Identifiant de doublage manquant." }, { status: 400 });
  }

  try {
    const job = await publishDoublageJob(getDoublageJobStore(), id, {
      baseUrl: resolvePublicBaseUrl(request),
    });
    return NextResponse.json(
      { job: toDoublageJobView(job) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof DoublageJobNotFoundError) {
      return NextResponse.json(
        { error: "Doublage introuvable ou expiré." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (err instanceof DoublageJobNotReadyError) {
      return NextResponse.json(
        { error: "Le doublage n'est pas encore prêt à être partagé." },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: "Le partage a échoué." }, { status: 500 });
  }
}

/**
 * Origine publique du site pour construire l'URL de partage absolue.
 *
 * Priorité : `NEXT_PUBLIC_SITE_URL` (déploiement derrière un proxy/CDN où
 * l'origine vue par le serveur diffère de l'URL publique) → origine de la
 * requête. Retourne `null` si rien n'est exploitable : `resolveDoublageShareUrl`
 * retombe alors sur un chemin relatif.
 */
function resolvePublicBaseUrl(request: NextRequest): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    return request.nextUrl.origin || null;
  } catch {
    return null;
  }
}
