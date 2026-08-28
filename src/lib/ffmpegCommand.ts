/**
 * Construction (pure, sans exécution) de la commande FFmpeg de mixage
 * vidéo + voix — ST 3.1 « Génération et téléchargement du fichier de doublage »,
 * découpage en tâches, point 2 : « Job de mixage FFmpeg [...] :
 * remplacement/superposition de la piste audio ».
 *
 * Même séparation logique/exécution que le reste du projet (`lib/extraits.ts`,
 * `lib/videoPlayer.ts`, `lib/voiceRecorder.ts`) : ce module ne fait que
 * *décrire* la liste d'arguments à passer à `ffmpeg` — il ne lance aucun
 * processus. L'exécution réelle (spawn du binaire, file de jobs) est du
 * ressort de `DoublageProcessor` (cf. `lib/doublage.ts`), volontairement
 * injecté pour rester testable et permettre un mock en environnement CI/test
 * où FFmpeg n'est pas installé.
 *
 * Definition of Done ST 3.1 : « Tests unitaires sur la construction de la
 * commande FFmpeg (mockée) » — couverts par
 * `src/lib/__tests__/ffmpegCommand.test.ts`.
 */

/**
 * Deux stratégies de traitement de la piste audio de l'extrait original, cf.
 * résumé de ST 3.1 (« remplacement/superposition ») :
 *
 * - `"remplacer"` : la voix de l'utilisateur *remplace* entièrement la bande-son
 *   d'origine (cas nominal du fandub : on redouble par-dessus une vidéo dont
 *   on coupe le son).
 * - `"superposer"` : la voix est *mixée* avec l'audio d'origine (utile si
 *   l'utilisateur veut garder la musique / les bruitages de fond).
 *
 * Le choix par défaut est `"remplacer"` : c'est l'attente la plus courante
 * pour un redoublage et cela évite un mixage de niveaux (risque de saturation)
 * non maîtrisable sans réglage utilisateur — point signalé en notes de dev.
 */
export type DoublageMixMode = "remplacer" | "superposer";

export const DEFAULT_MIX_MODE: DoublageMixMode = "remplacer";

/**
 * Codec/conteneur de sortie. MP4 (H.264 + AAC) est retenu comme cible unique :
 * c'est le format le plus universellement lisible sur mobile et desktop et
 * accepté par les plateformes de partage visées en ST 3.2. La vidéo est copiée
 * sans ré-encodage (`-c:v copy`) quand c'est possible pour limiter le coût CPU
 * (cf. « Points d'attention » ST 3.1) ; seul l'audio est (ré)encodé.
 */
export const DOUBLAGE_OUTPUT_EXTENSION = "mp4";
export const DOUBLAGE_OUTPUT_MIME_TYPE = "video/mp4";

export interface FfmpegCommandInput {
  /** Chemin (ou URL lisible par FFmpeg) de la vidéo source de l'extrait. */
  videoInputPath: string;
  /** Chemin du fichier audio enregistré par l'utilisateur (blob voix). */
  audioInputPath: string;
  /** Chemin du fichier de sortie à produire (doit se terminer par `.mp4`). */
  outputPath: string;
  /** Stratégie de traitement de l'audio d'origine (défaut : `"remplacer"`). */
  mode?: DoublageMixMode;
  /**
   * Décalage (en secondes) à appliquer à la piste voix pour l'aligner sur la
   * timeline vidéo — c'est le `startedAtVideoTimeSeconds` de
   * `RecordingResult` (l'enregistrement a pu démarrer alors que la vidéo
   * n'était pas à 0). Doit être positif ou nul. Défaut : 0.
   */
  audioOffsetSeconds?: number;
}

export class InvalidFfmpegCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFfmpegCommandError";
  }
}

function assertNonEmptyPath(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidFfmpegCommandError(`Le chemin ${label} est requis.`);
  }
}

/**
 * Construit la liste d'arguments `ffmpeg` pour produire le fichier de doublage.
 *
 * La fonction est *pure* : mêmes entrées → même sortie, aucun effet de bord.
 * Elle valide ses entrées (chemins non vides, extension de sortie, offset
 * positif) et lève `InvalidFfmpegCommandError` sinon — plutôt que de produire
 * une commande silencieusement incorrecte.
 *
 * Forme de la commande produite (mode `"remplacer"`, offset 0) :
 * ```
 * ffmpeg -y -i <video> -i <audio>
 *   -map 0:v:0 -map 1:a:0
 *   -c:v copy -c:a aac -b:a 192k -shortest
 *   -movflags +faststart <output>
 * ```
 * En mode `"superposer"`, la sélection `-map 1:a:0` est remplacée par un
 * `-filter_complex amix` fusionnant l'audio d'origine (`0:a`) et la voix
 * (`1:a`). Un offset non nul insère `adelay` (mode superposer) ou `-itsoffset`
 * (mode remplacer) devant l'entrée voix.
 *
 * @returns la liste d'arguments (sans le mot `ffmpeg` lui-même), prête à être
 *   passée à `spawn("ffmpeg", args)` par le `DoublageProcessor`.
 */
export function buildDoublageFfmpegArgs(input: FfmpegCommandInput): string[] {
  const {
    videoInputPath,
    audioInputPath,
    outputPath,
    mode = DEFAULT_MIX_MODE,
    audioOffsetSeconds = 0,
  } = input;

  assertNonEmptyPath(videoInputPath, "de la vidéo source");
  assertNonEmptyPath(audioInputPath, "de l'audio enregistré");
  assertNonEmptyPath(outputPath, "du fichier de sortie");

  if (!outputPath.toLowerCase().endsWith(`.${DOUBLAGE_OUTPUT_EXTENSION}`)) {
    throw new InvalidFfmpegCommandError(
      `Le fichier de sortie doit avoir l'extension .${DOUBLAGE_OUTPUT_EXTENSION}.`
    );
  }

  if (!Number.isFinite(audioOffsetSeconds) || audioOffsetSeconds < 0) {
    throw new InvalidFfmpegCommandError(
      "Le décalage audio doit être un nombre positif ou nul."
    );
  }

  const offsetMs = Math.round(audioOffsetSeconds * 1000);

  const args: string[] = ["-y"];

  // Entrée 0 : vidéo. Entrée 1 : voix. En mode "remplacer" avec offset, on
  // décale l'entrée voix elle-même via `-itsoffset` (placé AVANT le `-i`
  // correspondant, comme l'exige FFmpeg).
  args.push("-i", videoInputPath);
  if (mode === "remplacer" && offsetMs > 0) {
    args.push("-itsoffset", formatSeconds(audioOffsetSeconds));
  }
  args.push("-i", audioInputPath);

  if (mode === "superposer") {
    // Mixe l'audio d'origine (0:a) et la voix (1:a). `adelay` décale la voix
    // si besoin ; `amix` normalise sur la plus longue des deux pistes.
    const voix = offsetMs > 0 ? `[1:a]adelay=${offsetMs}|${offsetMs}[voix]` : null;
    const voixLabel = voix ? "[voix]" : "[1:a]";
    const filter = `${voix ? `${voix};` : ""}[0:a]${voixLabel}amix=inputs=2:duration=longest:normalize=0[aout]`;
    args.push("-filter_complex", filter);
    args.push("-map", "0:v:0", "-map", "[aout]");
  } else {
    // "remplacer" : on ignore purement l'audio d'origine.
    args.push("-map", "0:v:0", "-map", "1:a:0");
  }

  args.push(
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    // Coupe la sortie sur la plus courte des pistes retenues : évite une
    // queue de vidéo muette si la voix est plus courte que l'extrait, et
    // borne la durée (cohérent avec la contrainte des 5 min, cf. ST 5.1).
    "-shortest",
    // Déplace l'index MP4 en tête de fichier pour permettre la lecture en
    // streaming progressif (utile pour la page de partage ST 3.2).
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
