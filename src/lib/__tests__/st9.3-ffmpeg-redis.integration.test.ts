import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfmpeg, runFfprobe } from "@/lib/media/ffmpegProcess";
import {
  generateMediaRef,
  readMediaObject,
  writeMediaObjectFromStream,
} from "@/lib/media/localMediaStore";
import { createFfprobeVideoProbe } from "@/lib/videoProbe";
import { createFfmpegVideoCompressor } from "@/lib/videoCompressor";
import { createFfmpegDoublageProcessor } from "@/lib/doublageProcessor";
import type { ImportJob } from "@/lib/import";
import type { DoublageJob } from "@/lib/doublage";
import { getRedisClient } from "@/lib/media/redisConnection";
import { createRedisJobStore } from "@/lib/media/redisJobStore";

/**
 * Tests d'intégration ST 9.3 « Traitement vidéo réel (ffprobe/FFmpeg) et file
 * de jobs réelle » — DoD explicite : « Tests d'intégration bout-en-bout avec
 * de vrais fichiers vidéo courts ; CI verte (FFmpeg/Redis disponibles en
 * CI) ». Contrairement au reste de la suite (binaires FFmpeg/client Redis
 * mockés), ces tests lancent réellement `ffmpeg`/`ffprobe` et parlent à un
 * vrai Redis (`REDIS_URL`) — mêmes principes que
 * `st9.1-postgres.integration.test.ts` (ST 9.1) et
 * `st9.2-object-storage.integration.test.ts` (ST 9.2, branche non fusionnée).
 *
 * Les fichiers vidéo/audio de test ne sont pas des fixtures versionnées : ils
 * sont générés à la volée par FFmpeg lui-même via ses sources synthétiques
 * (`lavfi`, `testsrc`/`sine`) — courts (2 s), déterministes, sans dépendance à
 * un fichier binaire dans le dépôt.
 *
 * Prérequis, comme en CI (`.github/workflows/ci.yml`) : `ffmpeg`/`ffprobe`
 * installés et sur le `PATH` (ou `FFMPEG_PATH`/`FFPROBE_PATH`), `REDIS_URL`
 * valide (défaut `redis://127.0.0.1:6379`, cf. `docker compose up -d redis`).
 *
 * ⚠️ Non exécutés dans l'environnement de développement de cette story
 * (`ffmpeg`, `ffprobe` et Redis absents du bac à sable) — vérifiés par
 * relecture seulement. À exécuter en priorité avant merge (cf. notes de dev).
 */

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "st9.3-integration-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Génère une courte vidéo MP4 synthétique (2 s, mire + tonalité) via `ffmpeg -f lavfi`. */
async function generateSyntheticVideo(outputPath: string, durationSeconds = 2): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=duration=${durationSeconds}:size=320x240:rate=15`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${durationSeconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

/** Génère un court fichier audio synthétique (WAV, tonalité) via `ffmpeg -f lavfi`. */
async function generateSyntheticAudio(outputPath: string, durationSeconds = 2): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=880:duration=${durationSeconds}`,
    outputPath,
  ]);
}

describe("ST 9.3 — ffprobe/ffmpeg réels", () => {
  it("createFfprobeVideoProbe sonde une vraie vidéo (durée/format réels)", async () => {
    const localPath = path.join(workDir, "source.mp4");
    await generateSyntheticVideo(localPath, 2);

    const ref = generateMediaRef("imports/it-test", "mp4");
    const { createReadStream } = await import("node:fs");
    await writeMediaObjectFromStream(ref, createReadStream(localPath));

    const probe = createFfprobeVideoProbe();
    const result = await probe.probe(ref);

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("video/mp4");
    expect(result!.durationSeconds).toBeGreaterThan(1.5);
    expect(result!.durationSeconds).toBeLessThan(3);
  });

  it("createFfmpegVideoCompressor produit un MP4 ≤ 720p exploitable (ré-analysable par ffprobe)", async () => {
    const localPath = path.join(workDir, "source-compress.mp4");
    await generateSyntheticVideo(localPath, 2);

    const ref = generateMediaRef("imports/it-test", "mp4");
    const { createReadStream } = await import("node:fs");
    await writeMediaObjectFromStream(ref, createReadStream(localPath));

    const job: ImportJob = {
      id: "it-import-1",
      status: "en_traitement",
      progress: 0.05,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input: {
        objectRef: ref,
        utilisateurId: "it-user",
        titre: "Intégration ST 9.3",
        origine: "FR",
        type: "FILM",
        dureeSecondes: 2,
        mimeType: "video/mp4",
        sizeBytes: 1000,
        certificationDroitsLe: new Date().toISOString(),
        certificationDroitsVersion: "v1",
      },
    };

    const progressValues: number[] = [];
    const compressor = createFfmpegVideoCompressor();
    const { outputRef, playbackUrl, mimeType } = await compressor.compress(job, (p) =>
      progressValues.push(p)
    );

    expect(mimeType).toBe("video/mp4");
    expect(playbackUrl).toBe(`/api/media/play/${outputRef}`);

    const output = await readMediaObject(outputRef);
    expect(output).not.toBeNull();

    const { stdout } = await runFfprobe([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "stream=height,codec_type",
      output!.path,
    ]);
    const parsed = JSON.parse(stdout) as { streams: Array<{ codec_type: string; height?: number }> };
    const videoStream = parsed.streams.find((s) => s.codec_type === "video");
    expect(videoStream?.height).toBeLessThanOrEqual(720);
  });

  it("createFfmpegDoublageProcessor mixe une vraie vidéo et un vrai audio en un MP4", async () => {
    const videoPath = path.join(workDir, "source-mix.mp4");
    const audioPath = path.join(workDir, "voix.wav");
    await generateSyntheticVideo(videoPath, 2);
    await generateSyntheticAudio(audioPath, 2);

    const { createReadStream } = await import("node:fs");
    const videoRef = generateMediaRef("imports/it-test-compressed", "mp4");
    await writeMediaObjectFromStream(videoRef, createReadStream(videoPath));
    const audioRef = generateMediaRef("doublages/it-test-audio", "wav");
    await writeMediaObjectFromStream(audioRef, createReadStream(audioPath));

    const job: DoublageJob = {
      id: "it-doublage-1",
      status: "en_traitement",
      progress: 0.05,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      visibilite: "privee",
      input: {
        extraitId: "it-extrait-1",
        videoSourceUrl: `/api/media/play/${videoRef}`,
        audioRef,
        audioMimeType: "audio/wav",
        audioSizeBytes: 1000,
        audioDurationSeconds: 2,
        audioOffsetSeconds: 0,
      },
    };

    const processor = createFfmpegDoublageProcessor();
    const { outputRef, outputMimeType } = await processor.mix(job);

    expect(outputMimeType).toBe("video/mp4");
    const output = await readMediaObject(outputRef);
    expect(output).not.toBeNull();
    expect(output!.sizeBytes).toBeGreaterThan(0);
  });
});

describe("ST 9.3 — store de jobs Redis réel", () => {
  const store = createRedisJobStore<{ label: string }, {
    id: string;
    updatedAt: string;
    createdAt: string;
    status: string;
    expiresAt?: string;
    input: { label: string };
  }>("it-test", {
    redis: getRedisClient(),
    keyPrefix: "it-test-job:",
    buildInitial: (id, ts, input) => ({
      id,
      status: "en_attente",
      createdAt: ts,
      updatedAt: ts,
      input,
    }),
  });

  afterAll(async () => {
    const remaining = await store.list();
    await Promise.all(remaining.map((job) => store.delete(job.id)));
    await getRedisClient().quit();
  });

  it("create/get/update/list/delete fonctionnent contre un vrai serveur Redis", async () => {
    const job = await store.create({ label: "intégration" });
    await expect(store.get(job.id)).resolves.toEqual(job);

    const updated = await store.update(job.id, { status: "pret" });
    expect(updated.status).toBe("pret");

    const list = await store.list();
    expect(list.some((j) => j.id === job.id)).toBe(true);

    await store.delete(job.id);
    await expect(store.get(job.id)).resolves.toBeNull();
  });
});
