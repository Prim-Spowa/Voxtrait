/**
 * Mixage vidéo + voix réel (`ffmpeg`) — ST 9.3, découpage en tâches point 3 :
 * « [...] et le mixage vidéo + voix réel à l'export (ST 3.1) ».
 *
 * Remplace `createMockDoublageProcessor` (`src/lib/mocks/doublage.mock.ts`) par
 * une implémentation de `DoublageProcessor` (`lib/doublage.ts`) qui lance
 * réellement `ffmpeg` avec les arguments de `buildDoublageFfmpegArgs`
 * (`lib/ffmpegCommand.ts`, inchangé).
 *
 * Deux entrées à résoudre en chemins locaux lisibles par `ffmpeg` :
 *  - la voix enregistrée (`job.input.audioRef`) : toujours une ref du
 *    stockage local (`localMediaStore.ts`) — persistée par
 *    `POST /api/doublages` (cf. notes de dev : le blob audio n'était
 *    auparavant pas persisté du tout, ST 3.1 se contentait d'une ref
 *    factice) ;
 *  - la vidéo source de l'extrait (`job.input.videoSourceUrl`) : soit une ref
 *    locale (`/api/media/play/...`, cas d'un extrait importé et compressé par
 *    `videoCompressor.ts`), soit une URL `http(s)` externe (cas
 *    `Extrait.source = UPLOAD` du jeu de données de démonstration,
 *    `prisma/seed.ts`) — `ffmpeg` sait lire un flux HTTP directement via son
 *    propre protocole réseau (`libavformat`), pas besoin de la télécharger au
 *    préalable.
 *
 * ⚠️ Point d'attention (signalé en notes de dev) : les extraits
 * `Extrait.source = EMBED` (YouTube/Vimeo, `urlSource` = URL d'une page de
 * lecteur embarqué, pas d'un flux vidéo direct) ne sont **pas** traitables
 * par cette implémentation — `ffmpeg` échouera à démuxer la page HTML reçue,
 * ce qui se traduit par un job `status: "echec"` avec le message générique
 * (`runDoublageJob`). Détecter ce cas en amont pour renvoyer un message plus
 * explicite à l'utilisateur·rice (« export indisponible pour ce type
 * d'extrait ») serait une amélioration ; non fait ici pour rester dans le
 * périmètre strict du découpage en tâches de la story (traitement FFmpeg +
 * file de jobs, pas la gestion produit des extraits embarqués).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MIX_MODE,
  DOUBLAGE_OUTPUT_MIME_TYPE,
  buildDoublageFfmpegArgs,
} from "@/lib/ffmpegCommand";
import type { DoublageJob, DoublageProcessor } from "@/lib/doublage";
import { runFfmpeg } from "@/lib/media/ffmpegProcess";
import { createFfmpegProgressTracker } from "@/lib/media/ffmpegProgress";
import { adoptLocalFileAsMediaObject, generateMediaRef, readMediaObject } from "@/lib/media/localMediaStore";

/** Préfixe de l'URL de lecture permanente locale (`resolveLocalPersistentPlaybackUrl`). */
const LOCAL_PLAY_URL_PREFIX = "/api/media/play/";

export class DoublageSourceIntrouvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoublageSourceIntrouvableError";
  }
}

/**
 * Résout `videoSourceUrl` en une entrée exploitable par `ffmpeg -i` : chemin
 * local absolu si c'est une de nos refs internes, sinon l'URL `http(s)`
 * elle-même (lue directement par `ffmpeg`, cf. tête de fichier).
 */
async function resolveVideoInputPath(videoSourceUrl: string): Promise<string> {
  if (videoSourceUrl.startsWith(LOCAL_PLAY_URL_PREFIX)) {
    const ref = videoSourceUrl.slice(LOCAL_PLAY_URL_PREFIX.length);
    const object = await readMediaObject(decodeURIComponent(ref));
    if (!object) {
      throw new DoublageSourceIntrouvableError(
        `Vidéo source introuvable dans le stockage local : ${videoSourceUrl}`
      );
    }
    return object.path;
  }

  if (/^https?:\/\//i.test(videoSourceUrl)) {
    return videoSourceUrl;
  }

  throw new DoublageSourceIntrouvableError(
    `URL de vidéo source non exploitable par FFmpeg : ${videoSourceUrl}`
  );
}

/** Construit un `DoublageProcessor` (`lib/doublage.ts`) branché sur un vrai `ffmpeg`. */
export function createFfmpegDoublageProcessor(): DoublageProcessor {
  return {
    async mix(job: DoublageJob, onProgress) {
      const audio = await readMediaObject(job.input.audioRef);
      if (!audio) {
        throw new DoublageSourceIntrouvableError(
          `Enregistrement vocal introuvable dans le stockage local : ${job.input.audioRef}`
        );
      }
      const videoInputPath = await resolveVideoInputPath(job.input.videoSourceUrl);

      const workDir = await mkdtemp(path.join(tmpdir(), "doublage-mix-"));
      const tmpOutputPath = path.join(workDir, `${job.id}.mp4`);

      try {
        const args = buildDoublageFfmpegArgs({
          videoInputPath,
          audioInputPath: audio.path,
          outputPath: tmpOutputPath,
          mode: job.input.mode ?? DEFAULT_MIX_MODE,
          audioOffsetSeconds: job.input.audioOffsetSeconds,
        });
        const onStdoutLine = createFfmpegProgressTracker(
          job.input.audioDurationSeconds,
          onProgress
        );

        await runFfmpeg(["-progress", "pipe:1", "-nostats", ...args], { onStdoutLine });

        const outputRef = generateMediaRef("doublages/output", "mp4");
        await adoptLocalFileAsMediaObject(tmpOutputPath, outputRef);

        return { outputRef, outputMimeType: DOUBLAGE_OUTPUT_MIME_TYPE };
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {
          /* nettoyage best-effort du répertoire de travail temporaire */
        });
      }
    },
  };
}
