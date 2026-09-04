import { HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createS3ObjectStorageCleaner,
  createS3SignedUploadUrlIssuer,
  createS3SignedUrlIssuer,
  getObjectStorageConfig,
  getS3Client,
} from "@/lib/objectStorage";

/**
 * Tests d'intégration ST 9.2 « Stockage objet réel pour les fichiers
 * vidéo/audio » — DoD technique : « tests d'intégration avec un stockage réel
 * (MinIO en CI) ».
 *
 * Contrairement à `objectStorage.test.ts` (URLs pré-signées vérifiées hors
 * ligne), ces tests parlent à un vrai service S3/MinIO : ils PUT un objet via
 * l'URL émise par `createS3SignedUploadUrlIssuer`, vérifient qu'il est bien
 * lisible (`GetObjectCommand`, via l'URL de `createS3SignedUrlIssuer`), puis
 * le suppriment via `createS3ObjectStorageCleaner` et vérifient sa disparition.
 *
 * Prérequis : un MinIO accessible (`docker compose up -d minio`, cf.
 * `docker-compose.yml`) — configuration par défaut (`getObjectStorageConfig`)
 * si aucune variable `S3_*` n'est positionnée, comme en CI
 * (`.github/workflows/ci.yml`).
 */

const config = getObjectStorageConfig();
const client = getS3Client(config);

const TEST_KEY = `st9.2-integration/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
const TEST_BODY = "contenu de test ST 9.2 — round-trip MinIO";

async function objectExists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (err) {
    if (err instanceof NotFound) return false;
    // MinIO renvoie parfois un code générique plutôt que `NotFound` typé :
    // on retombe sur le nom/statut de l'erreur.
    const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (name === "NotFound" || status === 404) return false;
    throw err;
  }
}

describe("Stockage objet réel (MinIO) — round-trip complet", () => {
  beforeAll(async () => {
    // Échoue tôt et lisiblement si MinIO n'est pas démarré, plutôt que de
    // laisser chaque `it` échouer séparément avec une erreur réseau opaque.
    await client
      .send(new HeadObjectCommand({ Bucket: config.bucket, Key: "__st9.2-healthcheck__" }))
      .catch((err) => {
        if (err instanceof NotFound) return; // bucket joignable, clé absente : attendu
        throw new Error(
          `MinIO/S3 injoignable (bucket « ${config.bucket} », endpoint « ${config.endpoint ?? "AWS"} »). ` +
            "Démarrez-le avec `docker compose up -d minio` (cf. docker-compose.yml) avant de lancer ce test.\n" +
            `Erreur d'origine : ${String(err)}`
        );
      });
  });

  it("upload via l'URL pré-signée, puis lit et supprime l'objet via un vrai bucket", async () => {
    const uploadIssuer = createS3SignedUploadUrlIssuer(client, config.bucket);
    const upload = await uploadIssuer.issue({
      objectRef: TEST_KEY,
      contentType: "text/plain",
      ttlSeconds: 300,
    });

    // Upload direct vers le stockage objet — même parcours que le navigateur
    // (`createSignedUpload`, `src/lib/import.ts`).
    const putResponse = await fetch(upload.uploadUrl, {
      method: upload.method,
      headers: upload.headers,
      body: TEST_BODY,
    });
    expect(putResponse.ok).toBe(true);
    expect(await objectExists(TEST_KEY)).toBe(true);

    // Lecture via l'URL de téléchargement signée (même adaptateur que
    // `runDoublageJob` → `SignedUrlIssuer.issue`, `src/lib/doublage.ts`).
    const downloadIssuer = createS3SignedUrlIssuer(client, config.bucket);
    const { url: downloadUrl } = await downloadIssuer.issue(TEST_KEY, 300);
    const getResponse = await fetch(downloadUrl);
    expect(getResponse.ok).toBe(true);
    expect(await getResponse.text()).toBe(TEST_BODY);

    // Suppression — même adaptateur que `finalizeImport`/`runImportJob`
    // (`ObjectStorageCleaner`, `src/lib/import.ts`).
    const cleaner = createS3ObjectStorageCleaner(client, config.bucket);
    await cleaner.delete(TEST_KEY);
    expect(await objectExists(TEST_KEY)).toBe(false);
  });

  it("la suppression d'une clé déjà absente ne lève pas (idempotence S3)", async () => {
    const cleaner = createS3ObjectStorageCleaner(client, config.bucket);
    await expect(
      cleaner.delete(`st9.2-integration/jamais-cree-${Date.now()}.txt`)
    ).resolves.toBeUndefined();
  });
});
