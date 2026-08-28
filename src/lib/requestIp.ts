import type { NextRequest } from "next/server";

/**
 * Extraction de l'IP cliente d'une requête — utilisée comme clé de rate
 * limiting (ST 4.1 inscription, ST 4.2 connexion).
 *
 * `x-forwarded-for` (premier maillon) en priorité — l'app est destinée à
 * tourner derrière un proxy / CDN — puis `x-real-ip`, puis `request.ip`
 * (renseigné par certains hébergeurs, absent en dev local). Repli
 * `"unknown"` : en dev local sans en-tête, toutes les requêtes partagent
 * alors le même quota, ce qui reste un comportement sûr (jamais moins strict).
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  // `NextRequest.ip` : accès défensif — sa présence dans les types varie selon
  // la version de Next.
  const nativeIp = (request as unknown as { ip?: string }).ip;
  return nativeIp && nativeIp.trim() ? nativeIp.trim() : "unknown";
}
