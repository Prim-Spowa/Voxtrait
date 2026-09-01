/**
 * Construction (pure, sans exécution) de la commande FFmpeg de
 * compression/transcodage d'un extrait importé — ST 5.1 « Import et compression
 * vidéo », découpage en tâches point 3 : « Job de compression/transcodage
 * FFmpeg (format cible optimisé pour le stockage/diffusion) ».
 *
 * Même séparation logique/exécution que le reste du projet
 * (`lib/ffmpegCommand.ts` pour ST 3.1, `lib/videoPlayer.ts`, `lib/voiceRecorder.ts`) :
 * ce module ne fait que *décrire* la liste d'arguments à passer à `ffmpeg` — il
 * ne lance aucun processus. L'exécution réelle (spawn du binaire, file de jobs)
 * est du ressort du `VideoCompressor` (cf. `lib/import.ts`), volontairement
 * injecté pour rester testable et permettre un mock en environnement CI/test où
 * FFmpeg n'est pas installé.
 *
 * Definition of Done ST 5.1 : « Tests unitaires sur la validation de
 * durée/format » — la partie « construction de la commande » est couverte par
 * `src/lib/__tests__/importFfmpegCommand.test.ts`, sur le modèle de ST 3.1.
 */

/** Conteneur/codecs de sortie : MP4 (H.264 + AAC) — cf. `DOUBLAGE_OUTPUT_*` (ST 3.1), même cible universelle. */
export const IMPORT_OUTPUT_EXTENSION = "mp4";
export const IMPORT_OUTPUT_MIME_TYPE = "video/mp4";

/**
 * Profil de compression par défaut. Choix conservateurs, orientés
 * « stockage/diffusion » (points d'attention ST 5.1 : coût de stockage/bande
 * passante) sans dégrader visiblement un extrait court :
 *  - hauteur plafonnée à 720p (downscale seulement, jamais d'upscale) ;
 *  - H.264 `veryfast` / CRF 24 : bon compromis taille/qualité/CPU ;
 *  - audio AAC 128 kb/s stéréo ;
 *  - `+faststart` pour la lecture progressive (lecteur `<video>` natif, ST 1.2).
 */
export interface ImportCompressionProfile {
  maxHeight: number;
  crf: number;
  preset: string;
  audioBitrateKbps: number;
}

export const DEFAULT_IMPORT_COMPRESSION_PROFILE: ImportCompressionProfile = {
  maxHeight: 720,
  crf: 24,
  preset: "veryfast",
  audioBitrateKbps: 128,
};

export interface ImportFfmpegCommandInput {
  /** Chemin (ou URL lisible par FFmpeg) du fichier source uploadé. */
  inputPath: string;
  /** Chemin du fichier de sortie à produire (doit se terminer par `.mp4`). */
  outputPath: string;
  /** Profil de compression (défaut : `DEFAULT_IMPORT_COMPRESSION_PROFILE`). */
  profile?: Partial<ImportCompressionProfile>;
  /**
   * Durée maximale de sortie en secondes. Filet de sécurité : même si la
   * validation post-upload (`validateProbedVideo`) a déjà rejeté les fichiers
   * trop longs, on borne la sortie avec `-t` pour ne jamais produire un
   * fichier > 5 min en bibliothèque. `undefined` = pas de coupe.
   */
  maxDurationSeconds?: number;
}

export class InvalidImportFfmpegCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImportFfmpegCommandError";
  }
}

function assertNonEmptyPath(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidImportFfmpegCommandError(`Le chemin ${label} est requis.`);
  }
}

/**
 * Construit la liste d'arguments `ffmpeg` pour compresser/transcoder un extrait
 * importé vers le format cible MP4.
 *
 * La fonction est *pure* : mêmes entrées → même sortie, aucun effet de bord.
 * Elle valide ses entrées (chemins non vides, extension de sortie, valeurs de
 * profil positives) et lève `InvalidImportFfmpegCommandError` sinon — plutôt
 * que de produire une commande silencieusement incorrecte.
 *
 * Forme produite (profil par défaut, sans coupe) :
 * ```
 * ffmpeg -y -i <input>
 *   -vf scale=-2:'min(720,ih)'
 *   -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p
 *   -c:a aac -b:a 128k -ac 2
 *   -movflags +faststart <output>
 * ```
 *
 * @returns la liste d'arguments (sans le mot `ffmpeg` lui-même), prête à être
 *   passée à `spawn("ffmpeg", args)` par le `VideoCompressor`.
 */
export function buildImportCompressionFfmpegArgs(
  input: ImportFfmpegCommandInput
): string[] {
  const { inputPath, outputPath, maxDurationSeconds } = input;

  assertNonEmptyPath(inputPath, "du fichier source");
  assertNonEmptyPath(outputPath, "du fichier de sortie");

  if (!outputPath.toLowerCase().endsWith(`.${IMPORT_OUTPUT_EXTENSION}`)) {
    throw new InvalidImportFfmpegCommandError(
      `Le fichier de sortie doit avoir l'extension .${IMPORT_OUTPUT_EXTENSION}.`
    );
  }

  const profile: ImportCompressionProfile = {
    ...DEFAULT_IMPORT_COMPRESSION_PROFILE,
    ...input.profile,
  };

  for (const [key, value] of Object.entries({
    maxHeight: profile.maxHeight,
    crf: profile.crf,
    audioBitrateKbps: profile.audioBitrateKbps,
  })) {
    if (!Number.isFinite(value) || (value as number) <= 0) {
      throw new InvalidImportFfmpegCommandError(
        `Le paramètre de profil "${key}" doit être un nombre strictement positif.`
      );
    }
  }
  if (typeof profile.preset !== "string" || !profile.preset.trim()) {
    throw new InvalidImportFfmpegCommandError('Le paramètre de profil "preset" est requis.');
  }
  if (
    maxDurationSeconds !== undefined &&
    (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0)
  ) {
    throw new InvalidImportFfmpegCommandError(
      "La durée maximale de sortie doit être un nombre strictement positif."
    );
  }

  const args: string[] = ["-y", "-i", inputPath];

  if (maxDurationSeconds !== undefined) {
    args.push("-t", formatSeconds(maxDurationSeconds));
  }

  args.push(
    // Downscale seulement : `min(maxHeight, ih)` ne dépasse jamais la hauteur
    // d'origine ; `-2` conserve le ratio en gardant une largeur paire (requis
    // par yuv420p / H.264).
    "-vf",
    `scale=-2:'min(${profile.maxHeight},ih)'`,
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    `${profile.audioBitrateKbps}k`,
    "-ac",
    "2",
    // Index MP4 en tête de fichier : lecture en streaming progressif par le
    // lecteur `<video>` natif (ST 1.2).
    "-movflags",
    "+faststart",
    outputPath
  );

  return args;
}

/** Formate un nombre de secondes pour FFmpeg (pas de notation exponentielle, 3 décimales max). */
function formatSeconds(seconds: number): string {
  return seconds.toFixed(3).replace(/\.?0+$/, "");
}
