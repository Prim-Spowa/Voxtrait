import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvalidMediaRefError,
  adoptLocalFileAsMediaObject,
  deleteMediaObject,
  generateMediaRef,
  readMediaObject,
  resolveMediaStoreRoot,
  writeMediaObjectFromBuffer,
  writeMediaObjectFromStream,
} from "@/lib/media/localMediaStore";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "media-store-test-"));
  vi.stubEnv("MEDIA_STORAGE_DIR", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("resolveMediaStoreRoot", () => {
  it("résout MEDIA_STORAGE_DIR en chemin absolu", () => {
    expect(path.isAbsolute(resolveMediaStoreRoot())).toBe(true);
    expect(resolveMediaStoreRoot()).toBe(path.resolve(root));
  });
});

describe("generateMediaRef", () => {
  it("produit une ref sous le préfixe donné, avec l'extension demandée", () => {
    const ref = generateMediaRef("imports/user-1", "mp4");
    expect(ref).toMatch(/^imports\/user-1\/[0-9a-f-]+\.mp4$/);
  });

  it("nettoie les slashes superflus du préfixe et le point de l'extension", () => {
    const ref = generateMediaRef("/imports/user-1/", ".mp4");
    expect(ref.startsWith("imports/user-1/")).toBe(true);
    expect(ref.endsWith(".mp4")).toBe(true);
    expect(ref).not.toContain("..mp4");
  });
});

describe("writeMediaObjectFromBuffer / readMediaObject / deleteMediaObject", () => {
  it("écrit puis relit le même contenu", async () => {
    const ref = "imports/user-1/video.mp4";
    await writeMediaObjectFromBuffer(ref, Buffer.from("contenu vidéo factice"));

    const object = await readMediaObject(ref);
    expect(object).not.toBeNull();
    expect(object!.sizeBytes).toBe(Buffer.byteLength("contenu vidéo factice"));
    await expect(readFile(object!.path, "utf8")).resolves.toBe("contenu vidéo factice");
  });

  it("renvoie null pour une ref jamais écrite", async () => {
    await expect(readMediaObject("jamais/ecrit.mp4")).resolves.toBeNull();
  });

  it("delete est idempotent (pas d'erreur sur une ref déjà absente)", async () => {
    await expect(deleteMediaObject("jamais/ecrit.mp4")).resolves.toBeUndefined();
  });

  it("supprime un objet existant", async () => {
    const ref = "doublages/audio/x.webm";
    await writeMediaObjectFromBuffer(ref, Buffer.from("voix"));
    await deleteMediaObject(ref);
    await expect(readMediaObject(ref)).resolves.toBeNull();
  });
});

describe("writeMediaObjectFromStream", () => {
  it("écrit le contenu d'un flux Node", async () => {
    const ref = "imports/user-2/upload.mp4";
    const stream = Readable.from([Buffer.from("partie1-"), Buffer.from("partie2")]);
    await writeMediaObjectFromStream(ref, stream);

    const object = await readMediaObject(ref);
    await expect(readFile(object!.path, "utf8")).resolves.toBe("partie1-partie2");
  });
});

describe("adoptLocalFileAsMediaObject", () => {
  it("déplace un fichier local existant vers le store, sous la nouvelle ref", async () => {
    const sourcePath = path.join(root, "..", `work-${Date.now()}.mp4`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(sourcePath, "sortie ffmpeg");

    const ref = generateMediaRef("imports/compressed/user-1", "mp4");
    await adoptLocalFileAsMediaObject(sourcePath, ref);

    const object = await readMediaObject(ref);
    expect(object).not.toBeNull();
    await expect(readFile(object!.path, "utf8")).resolves.toBe("sortie ffmpeg");

    await rm(sourcePath, { force: true });
  });
});

describe("protection contre la traversée de répertoire", () => {
  it("rejette une ref absolue", async () => {
    await expect(readMediaObject("/etc/passwd")).rejects.toThrow(InvalidMediaRefError);
  });

  it("rejette une ref vide", async () => {
    await expect(readMediaObject("")).rejects.toThrow(InvalidMediaRefError);
  });

  it("rejette une ref sortant de la racine via '..'", async () => {
    await expect(readMediaObject("../../etc/passwd")).rejects.toThrow(InvalidMediaRefError);
    await expect(
      writeMediaObjectFromBuffer("../escape.mp4", Buffer.from("x"))
    ).rejects.toThrow(InvalidMediaRefError);
  });
});
