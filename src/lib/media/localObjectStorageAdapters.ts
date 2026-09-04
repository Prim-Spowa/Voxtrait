/**
 * Adaptateurs branchant le stockage local (`localMediaStore.ts` +
 * `mediaUrlSigning.ts`) sur les contrats déjà définis par ST 5.1/ST 3.1
 * (`SignedUploadUrlIssuer`, `ObjectStorageCleaner` — `lib/import.ts` ;
 * `SignedUrlIssuer` — `lib/doublage.ts`) — ST 9.3.
 *
 * Même rôle que `src/lib/objectStorage.ts` introduit par ST 9.2 (branche non
 * fusionnée, cf. avertissement en tête de `localMediaStore.ts`) mais pour le
 * disque local plutôt que S3 : c'est le point de bascule unique à remplacer
 * quand ST 9.2 sera mergée.
 *
 * Trois routes HTTP consomment ces signatures :
 *  - `PUT  /api/media/upload/[...ref]`  (upload direct, cf. `createLocalSignedUploadUrlIssuer`)
 *  - `GET  /api/media/play/[...ref]`    (lecture **non signée, permanente** — cf. `createLocalPersistentPlaybackUrlIssuer`)
 *  - `GET  /api/media/download/[...ref]` (téléchargement **signé, temporaire** — cf. `createLocalSignedUrlIssuer`)
 */

import { deleteMediaObject } from "@/lib/media/localMediaStore";
import { signMediaRef } from "@/lib/media/mediaUrlSigning";
import type {
  ObjectStorageCleaner,
  SignedUploadTarget,
  SignedUploadUrlIssuer,
} from "@/lib/import";
import type { SignedUrlIssuer } from "@/lib/doublage";

/**
 * `SignedUploadUrlIssuer` (ST 5.1) — l'« URL signée » pointe vers
 * `PUT /api/media/upload/:ref`, dont la validité est bornée par un jeton HMAC
 * en query string (`exp`/`sig`, cf. `mediaUrlSigning.ts`), pas par une vraie
 * signature de service de stockage — même fonction, implémentation locale.
 */
export function createLocalSignedUploadUrlIssuer(): SignedUploadUrlIssuer {
  return {
    async issue({ objectRef, contentType, ttlSeconds }) {
      const { exp, sig } = signMediaRef(objectRef, ttlSeconds);
      const expiresAt = new Date(exp * 1000).toISOString();
      return {
        uploadUrl: `/api/media/upload/${objectRef}?exp=${exp}&sig=${encodeURIComponent(sig)}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt,
      } satisfies Omit<SignedUploadTarget, "objectRef" | "expiresAt"> & { expiresAt: string };
    },
  };
}

/** `ObjectStorageCleaner` (ST 5.1/ST 3.1) — suppression directe sur le disque local. */
export function createLocalObjectStorageCleaner(): ObjectStorageCleaner {
  return {
    async delete(objectRef) {
      await deleteMediaObject(objectRef);
    },
  };
}

/**
 * `SignedUrlIssuer` (ST 3.1) — URL de **téléchargement temporaire** du fichier
 * de doublage généré, signée (`exp`/`sig`) et bornée par `ttlSeconds` (même
 * contrat que la version S3 prévue par la story : « URL signée expirante »).
 */
export function createLocalSignedUrlIssuer(): SignedUrlIssuer {
  return {
    async issue(outputRef, ttlSeconds) {
      const { exp, sig } = signMediaRef(outputRef, ttlSeconds);
      return {
        url: `/api/media/download/${outputRef}?exp=${exp}&sig=${encodeURIComponent(sig)}`,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    },
  };
}

/**
 * Résout l'URL de **lecture permanente, non signée** d'un objet — utilisée
 * pour la vidéo compressée d'un import (`Extrait.urlSource`, consommée
 * indéfiniment par le lecteur `<video>`, ST 1.2), pas un artefact temporaire
 * comme le fichier de doublage. Sert la même logique qu'une URL de CDN public
 * en production (cf. commentaire « URL CDN » du mock `VideoCompressor`,
 * `src/lib/mocks/import.mock.ts`) : pas de signature, juste une référence
 * stable.
 */
export function resolveLocalPersistentPlaybackUrl(ref: string): string {
  return `/api/media/play/${ref}`;
}
