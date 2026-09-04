/**
 * Signature HMAC des URLs de téléversement/téléchargement des fichiers du
 * stockage local (`localMediaStore.ts`) — ST 9.3, substitut provisoire des
 * URLs pré-signées S3 (`getSignedUrl`, cf. notes de dev ST 9.2) tant que ST 9.2
 * n'est pas fusionnée.
 *
 * Même construction que `lib/session.ts` (HMAC-SHA256, comparaison en temps
 * constant) et même posture pour le secret que `getSessionSecret` : requis en
 * production (≥ 32 caractères), repli de développement sinon — pour que
 * `next dev`/les tests tournent sans configuration supplémentaire.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_FALLBACK_SECRET = "dev-only-media-url-secret-do-not-use-in-production-000000";

export function getMediaUrlSecret(): string {
  const configured = process.env.MEDIA_URL_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MEDIA_URL_SECRET manquant ou trop court (>= 32 caractères requis) en production."
    );
  }
  return DEV_FALLBACK_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", getMediaUrlSecret()).update(payload).digest("base64url");
}

export interface SignedMediaToken {
  /** Référence de l'objet (`localMediaStore`). */
  ref: string;
  /** Expiration Unix (secondes). */
  exp: number;
  /** Signature HMAC de `${ref}:${exp}`. */
  sig: string;
}

/** Émet un jeton signé pour `ref`, valide `ttlSeconds` à partir de `now()`. */
export function signMediaRef(
  ref: string,
  ttlSeconds: number,
  now: () => Date = () => new Date()
): SignedMediaToken {
  const exp = Math.floor(now().getTime() / 1000) + Math.max(1, Math.round(ttlSeconds));
  return { ref, exp, sig: sign(`${ref}:${exp}`) };
}

/**
 * Vérifie un jeton (ref + exp + sig, tels que reçus en query string). `false`
 * si la signature ne correspond pas ou si `exp` est dépassé — les deux motifs
 * ne sont volontairement pas distingués côté appelant (même 403 générique,
 * pas d'oracle sur la raison de l'échec).
 */
export function verifyMediaToken(
  ref: string,
  expRaw: string | null,
  sigRaw: string | null,
  now: () => Date = () => new Date()
): boolean {
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sigRaw) return false;
  if (Math.floor(now().getTime() / 1000) > exp) return false;

  const expected = Buffer.from(sign(`${ref}:${exp}`));
  const provided = Buffer.from(sigRaw);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
