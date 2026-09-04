import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createS3ObjectStorageCleaner,
  createS3SignedUploadUrlIssuer,
  createS3SignedUrlIssuer,
  getObjectStorageConfig,
  getS3Client,
} from "../objectStorage";

/**
 * Tests de `src/lib/objectStorage.ts` (ST 9.2 « Stockage objet réel »).
 *
 * `getSignedUrl` (`@aws-sdk/s3-request-presigner`) calcule une signature
 * SigV4 **localement**, sans appel réseau : les tests sur
 * `createS3SignedUploadUrlIssuer`/`createS3SignedUrlIssuer` peuvent donc
 * s'exécuter hors ligne, avec un client configuré sur des identifiants
 * factices. `createS3ObjectStorageCleaner` est testé en injectant un faux
 * client (`send` espionné) plutôt qu'un vrai `S3Client`, pour vérifier la
 * commande envoyée sans toucher le réseau.
 *
 * Un round-trip contre un vrai stockage S3/MinIO est couvert séparément par
 * `st9.2-object-storage.integration.test.ts` (nécessite MinIO, cf. ce
 * fichier et `docker-compose.yml`).
 */

const TEST_CONFIG = {
  bucket: "fandub-test",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

function testClient(): S3Client {
  return new S3Client({
    region: TEST_CONFIG.region,
    endpoint: TEST_CONFIG.endpoint,
    forcePathStyle: TEST_CONFIG.forcePathStyle,
    credentials: {
      accessKeyId: TEST_CONFIG.accessKeyId,
      secretAccessKey: TEST_CONFIG.secretAccessKey,
    },
  });
}

describe("getObjectStorageConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllEnvs();
  });

  it("lit une configuration complète depuis l'environnement", () => {
    process.env.S3_BUCKET = "fandub-prod";
    process.env.S3_ACCESS_KEY_ID = "AKIA...";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.S3_REGION = "eu-west-3";
    process.env.S3_ENDPOINT = "";
    process.env.S3_FORCE_PATH_STYLE = "false";

    const config = getObjectStorageConfig();
    expect(config).toEqual({
      bucket: "fandub-prod",
      region: "eu-west-3",
      endpoint: undefined,
      forcePathStyle: false,
      accessKeyId: "AKIA...",
      secretAccessKey: "secret",
    });
  });

  it("retombe sur le MinIO de développement hors production si la config est incomplète", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getObjectStorageConfig();
    warnSpy.mockRestore();

    expect(config).toEqual({
      bucket: "fandub-dev",
      region: "us-east-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    });
  });

  it("lève en production si la configuration S3 est incomplète", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getObjectStorageConfig()).toThrow(/production/i);
  });

  it("considère la configuration incomplète si un seul des trois champs requis manque", () => {
    process.env.S3_BUCKET = "fandub-prod";
    process.env.S3_ACCESS_KEY_ID = "AKIA...";
    delete process.env.S3_SECRET_ACCESS_KEY;
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getObjectStorageConfig()).toThrow();
  });
});

describe("getS3Client", () => {
  it("renvoie la même instance à chaque appel (singleton)", () => {
    const a = getS3Client(TEST_CONFIG);
    const b = getS3Client(TEST_CONFIG);
    expect(a).toBe(b);
  });
});

describe("createS3SignedUploadUrlIssuer", () => {
  it("émet une URL PUT pré-signée pointant vers le bucket/la clé demandés", async () => {
    const issuer = createS3SignedUploadUrlIssuer(testClient(), TEST_CONFIG.bucket);
    const before = Date.now();

    const target = await issuer.issue({
      objectRef: "imports/user-1/src-abc",
      contentType: "video/mp4",
      ttlSeconds: 900,
    });

    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(target.uploadUrl).toContain(TEST_CONFIG.bucket);
    expect(target.uploadUrl).toContain("imports/user-1/src-abc");
    // Signature SigV4 : présente dans la query string, aucune signature « mock ».
    expect(target.uploadUrl).toMatch(/X-Amz-Signature=/);

    const expiresAtMs = new Date(target.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 900 * 1000 - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 900 * 1000 + 1000);
  });
});

describe("createS3SignedUrlIssuer (téléchargement du doublage)", () => {
  it("émet une URL GET pré-signée pointant vers l'outputRef demandé", async () => {
    const issuer = createS3SignedUrlIssuer(testClient(), TEST_CONFIG.bucket);
    const before = Date.now();

    const { url, expiresAt } = await issuer.issue("mock-output/job-1.mp4", 900);

    expect(url).toContain(TEST_CONFIG.bucket);
    expect(url).toContain("mock-output/job-1.mp4");
    expect(url).toMatch(/X-Amz-Signature=/);

    const expiresAtMs = new Date(expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 900 * 1000 - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 900 * 1000 + 1000);
  });
});

describe("createS3ObjectStorageCleaner", () => {
  it("envoie une commande DeleteObject avec le bucket/la clé attendus", async () => {
    const send = vi.fn().mockResolvedValue({});
    const fakeClient = { send } as unknown as S3Client;

    const cleaner = createS3ObjectStorageCleaner(fakeClient, TEST_CONFIG.bucket);
    await cleaner.delete("imports/user-1/src-abc");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.constructor.name).toBe("DeleteObjectCommand");
    expect(command.input).toEqual({
      Bucket: TEST_CONFIG.bucket,
      Key: "imports/user-1/src-abc",
    });
  });

  it("propage l'erreur si la suppression échoue (best-effort géré par l'appelant)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("réseau indisponible"));
    const fakeClient = { send } as unknown as S3Client;

    const cleaner = createS3ObjectStorageCleaner(fakeClient, TEST_CONFIG.bucket);
    await expect(cleaner.delete("imports/user-1/src-abc")).rejects.toThrow(
      "réseau indisponible"
    );
  });
});
