/**
 * Client de stockage objet réel — ST 9.2 « Stockage objet réel pour les
 * fichiers vidéo/audio » (cf. `stories-techniques-site-doublage.md`).
 *
 * Remplace les adaptateurs mockés de `src/lib/mocks/import.mock.ts`
 * (`createMockSignedUploadUrlIssuer`, `createMockObjectStorageCleaner`) et de
 * `src/lib/mocks/doublage.mock.ts` (`createMockSignedUrlIssuer`) par de vraies
 * implémentations des interfaces posées par ST 3.1/ST 5.1
 * (`SignedUploadUrlIssuer`, `ObjectStorageCleaner` dans `src/lib/import.ts` ;
 * `SignedUrlIssuer` dans `src/lib/doublage.ts`), sans toucher à ces contrats.
 *
 * Backend : tout client compatible S3 (AWS S3 en production, MinIO en
 * local/dev — cf. `docker-compose.yml`), via le SDK AWS officiel
 * (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). La génération
 * d'URL pré-signée (`getSignedUrl`) est un calcul de signature local (SigV4) :
 * aucun appel réseau n'est fait pour émettre une URL, ce qui rend
 * `createS3SignedUploadUrlIssuer`/`createS3SignedDownloadUrlIssuer`
 * testables hors ligne.
 *
 * ⚠️ Périmètre — ST 9.2 ne branche que le **stockage** : les briques encore
 * mockées par ST 5.1/ST 3.1 (`UploadedVideoProbe` = `ffprobe`,
 * `VideoCompressor`/`DoublageProcessor` = FFmpeg, exécution des jobs en file
 * réelle) restent hors périmètre — elles relèvent de ST 9.3. Concrètement :
 * la sonde vidéo (`createMockUploadedVideoProbe`) continue de renvoyer des
 * métadonnées synthétiques indépendamment de ce qui a réellement été
 * uploadé, et le job de doublage (`createMockDoublageProcessor`) ne dépose
 * aucun octet réel sous l'`outputRef` qu'il invente — l'URL de téléchargement
 * signée émise par `createS3SignedDownloadUrlIssuer` sera donc valide mais
 * pointera vers un objet inexistant tant que ST 9.3 n'aura pas branché un
 * vrai `DoublageProcessor`. Signalé en notes de dev.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorageCleaner, SignedUploadUrlIssuer } from "@/lib/import";
import type { SignedUrlIssuer } from "@/lib/doublage";

export interface ObjectStorageConfig {
  bucket: string;
  region: string;
  /** URL du service S3 — absent = AWS S3 réel ; renseigné pour MinIO (ex. `http://localhost:9000`). */
  endpoint?: string;
  /** Style d'URL « chemin » (`http://host/bucket/clé`), requis par MinIO ; AWS S3 utilise le style « virtual-hosted » par défaut. */
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Valeurs par défaut alignées sur le service `minio` de `docker-compose.yml`
 * — permettent de faire tourner `next dev` sans configuration explicite,
 * même logique de repli que `getSessionSecret` (`src/lib/session.ts`).
 */
const DEV_DEFAULT_CONFIG: ObjectStorageConfig = {
  bucket: "fandub-dev",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin",
};

/**
 * Lit la configuration S3 depuis l'environnement. En production,
 * `S3_BUCKET`, `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY` **doivent** être
 * définis — sinon on lève, plutôt que d'écrire silencieusement vers un
 * MinIO de développement inexistant. Hors production, une configuration
 * absente ou incomplète retombe sur le MinIO local (`DEV_DEFAULT_CONFIG`),
 * avec un avertissement.
 */
export function getObjectStorageConfig(): ObjectStorageConfig {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

  const fullyConfigured = Boolean(bucket && accessKeyId && secretAccessKey);

  if (!fullyConfigured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Configuration de stockage objet manquante en production : S3_BUCKET, " +
          "S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY sont requis (cf. .env.example)."
      );
    }
    console.warn(
      "[objectStorage] Configuration S3 incomplète (S3_BUCKET/S3_ACCESS_KEY_ID/" +
        "S3_SECRET_ACCESS_KEY), repli sur le MinIO de développement (docker-compose.yml)."
    );
    return { ...DEV_DEFAULT_CONFIG };
  }

  const region = process.env.S3_REGION?.trim() || DEV_DEFAULT_CONFIG.region;
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true";

  return {
    bucket: bucket!,
    region,
    endpoint,
    forcePathStyle,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
  };
}

const globalForS3 = globalThis as unknown as {
  s3Client?: S3Client;
};

/**
 * Client S3 singleton — même raison que le singleton Prisma
 * (`src/lib/prisma.ts`) : éviter d'instancier un nouveau client (et son pool
 * de connexions HTTP) à chaque rechargement de module en `next dev`.
 */
export function getS3Client(config: ObjectStorageConfig = getObjectStorageConfig()): S3Client {
  if (!globalForS3.s3Client) {
    globalForS3.s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return globalForS3.s3Client;
}

/* -------------------------------------------------------------------------- */
/*  Import (ST 5.1) — URL d'upload signée + nettoyage                         */
/* -------------------------------------------------------------------------- */

/**
 * `SignedUploadUrlIssuer` réel — ST 9.2, découpage en tâches point 2.
 * Émet une URL PUT pré-signée S3 pour l'objet `objectRef` (déjà préfixé par
 * `createSignedUpload`, cf. `src/lib/import.ts`).
 */
export function createS3SignedUploadUrlIssuer(
  client: S3Client = getS3Client(),
  bucket: string = getObjectStorageConfig().bucket
): SignedUploadUrlIssuer {
  return {
    async issue({ objectRef, contentType, ttlSeconds }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectRef,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: ttlSeconds });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      return {
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt,
      };
    },
  };
}

/**
 * `ObjectStorageCleaner` réel — ST 9.2, découpage en tâches point 2. `DELETE`
 * S3 est idempotent : supprimer une clé déjà absente ne lève pas (utile ici
 * car `finalizeImport`/`runImportJob` appellent `delete` en best-effort sur
 * des références qui, avec la sonde encore mockée de ST 5.1, ne
 * correspondent pas toujours à un objet réellement écrit).
 */
export function createS3ObjectStorageCleaner(
  client: S3Client = getS3Client(),
  bucket: string = getObjectStorageConfig().bucket
): ObjectStorageCleaner {
  return {
    async delete(objectRef) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectRef }));
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Doublage (ST 3.1) — URL de téléchargement signée                          */
/* -------------------------------------------------------------------------- */

/**
 * `SignedUrlIssuer` réel — ST 9.2, découpage en tâches point 3. Émet une URL
 * GET pré-signée S3 pour le fichier de doublage produit (`outputRef`).
 *
 * Cf. avertissement en tête de fichier : tant que ST 9.3 n'a pas branché un
 * `DoublageProcessor` réel, l'`outputRef` fourni par le processor mocké ne
 * correspond à aucun objet réellement stocké — l'URL émise est valide (bien
 * formée, signée, expire correctement) mais mène à un `404` du stockage à
 * l'ouverture.
 */
export function createS3SignedUrlIssuer(
  client: S3Client = getS3Client(),
  bucket: string = getObjectStorageConfig().bucket
): SignedUrlIssuer {
  return {
    async issue(outputRef, ttlSeconds) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: outputRef });
      const url = await getSignedUrl(client, command, { expiresIn: ttlSeconds });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      return { url, expiresAt };
    },
  };
}
