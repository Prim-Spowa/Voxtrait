/**
 * Stockage local des fichiers vidéo/audio traités par FFmpeg — ST 9.3
 * « Traitement vidéo réel (ffprobe/FFmpeg) et file de jobs réelle ».
 *
 * ⚠️ Périmètre : la story technique dépend explicitement de ST 9.2
 * (« Stockage objet réel ») pour le stockage des fichiers produits — cf.
 * `stories-techniques-site-doublage.md`, « Impacts sur l'existant » de ST 9.3.
 * Or ST 9.2 n'est **pas fusionnée sur `main`** au moment de ce développement
 * (branche `st-9.2-stockage-objet-reel` restée ouverte, cf. notes de dev) : le
 * module `src/lib/objectStorage.ts` (client S3/MinIO) qu'elle introduit
 * n'existe donc pas encore sur cette branche.
 *
 * Pour ne pas rester bloqué (et pour que `ffprobe`/`ffmpeg`, eux, tournent
 * réellement sur de vrais octets — objet même de ST 9.3), ce module fournit un
 * stockage **disque local**, utilisé comme substitut provisoire de
 * `ObjectStorageCleaner`/`SignedUploadUrlIssuer`/`SignedUrlIssuer` (cf.
 * `localObjectStorageAdapters.ts`) tant que ST 9.2 n'est pas mergée. Les refs
 * (`objectRef`/`outputRef`/`audioRef`) sont de simples chemins relatifs sous
 * `MEDIA_STORAGE_DIR` (défaut : `.data/media`, hors du contrôle de version).
 *
 * **À la fusion de ST 9.2** : remplacer les fonctions de ce module par des
 * appels au client S3 (`PutObject`/`GetObject`/`DeleteObject`) — signalé en
 * notes de dev comme point de suivi explicite. Les modules qui consomment ce
 * fichier (`videoProbe.ts`, `videoCompressor.ts`, `doublageProcessor.ts`,
 * `localObjectStorageAdapters.ts`) n'ont volontairement qu'une toute petite
 * surface (lire un objet vers un chemin local, écrire un chemin local comme
 * objet, supprimer, lister la taille) : un remplacement par un accesseur S3
 * (téléchargement vers un fichier temporaire / upload depuis un fichier
 * temporaire) ne devrait pas les toucher.
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Racine du stockage local — `MEDIA_STORAGE_DIR`, défaut `.data/media` (relatif à la racine du projet). */
export function resolveMediaStoreRoot(): string {
  const configured = process.env.MEDIA_STORAGE_DIR?.trim();
  return path.resolve(process.cwd(), configured || ".data/media");
}

/** Une référence invalide (vide, absolue, ou sortant de la racine du store via `..`). */
export class InvalidMediaRefError extends Error {
  constructor(ref: string) {
    super(`Référence de fichier média invalide : "${ref}".`);
    this.name = "InvalidMediaRefError";
  }
}

/**
 * Valide qu'une ref reste **strictement** sous la racine du store, une fois
 * résolue — protection contre la traversée de répertoire (`../../etc/passwd`)
 * si une ref finissait par provenir d'une entrée utilisateur (ce qui n'est
 * pas censé arriver : les refs sont générées côté serveur par
 * `generateMediaRef`, jamais fournies telles quelles par le client — mais
 * défense en profondeur, même posture que le reste du projet).
 */
function resolveObjectPath(ref: string): string {
  const trimmed = (ref ?? "").trim();
  if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes("\0")) {
    throw new InvalidMediaRefError(ref);
  }
  const root = resolveMediaStoreRoot();
  const resolved = path.resolve(root, trimmed);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new InvalidMediaRefError(ref);
  }
  return resolved;
}

/** Génère une ref unique sous un préfixe donné (ex. `imports/<utilisateurId>`), avec extension. */
export function generateMediaRef(prefix: string, extension: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const cleanExt = extension.replace(/^\.+/, "");
  return `${cleanPrefix}/${randomUUID()}.${cleanExt}`;
}

/** Résultat de la lecture d'un objet : chemin local absolu + taille. */
export interface LocalMediaObject {
  path: string;
  sizeBytes: number;
}

/** Lit un objet existant — `null` si absent (fichier jamais uploadé / déjà supprimé). */
export async function readMediaObject(ref: string): Promise<LocalMediaObject | null> {
  const filePath = resolveObjectPath(ref);
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return null;
    return { path: filePath, sizeBytes: st.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Écrit un flux dans le store sous `ref`. Écrit d'abord vers un fichier
 * temporaire voisin puis renomme (`rename` est atomique sur un même volume) :
 * un lecteur concurrent (ex. `ffprobe` déclenché juste après un upload encore
 * en cours) ne peut jamais voir un fichier à moitié écrit.
 */
export async function writeMediaObjectFromStream(ref: string, source: Readable): Promise<void> {
  const filePath = resolveObjectPath(ref);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const dest = createWriteStream(tmpPath);
  try {
    await pipeline(source, dest);
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/** Variante `Buffer` de `writeMediaObjectFromStream` (utilisée pour l'audio de doublage, déjà bufferisé côté endpoint). */
export async function writeMediaObjectFromBuffer(ref: string, data: Buffer): Promise<void> {
  const filePath = resolveObjectPath(ref);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  await rename(tmpPath, filePath);
}

/**
 * « Adopte » un fichier déjà produit localement (ex. sortie `ffmpeg`, écrite
 * directement dans un répertoire de travail) comme objet du store, sous une
 * nouvelle ref. Renomme quand c'est possible (même volume) — sinon copie +
 * suppression (import trans-périphérique), transparent pour l'appelant.
 */
export async function adoptLocalFileAsMediaObject(
  sourcePath: string,
  ref: string
): Promise<void> {
  const filePath = resolveObjectPath(ref);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await rename(sourcePath, filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const { copyFile, unlink } = await import("node:fs/promises");
    await copyFile(sourcePath, filePath);
    await unlink(sourcePath).catch(() => {});
  }
}

/** Supprime un objet — idempotent : ne lève pas si déjà absent (même sémantique que `DeleteObject` S3, cf. notes de dev ST 9.2). */
export async function deleteMediaObject(ref: string): Promise<void> {
  const filePath = resolveObjectPath(ref);
  await rm(filePath, { force: true });
}

/**
 * Empreinte stable d'une ref, utilisée par `mediaUrlSigning.ts` pour les URLs
 * signées (évite d'exposer directement le chemin disque dans les logs de
 * signature, sans intérêt fonctionnel — juste de l'hygiène).
 */
export function hashMediaRef(ref: string): string {
  return createHash("sha256").update(ref).digest("hex").slice(0, 16);
}
