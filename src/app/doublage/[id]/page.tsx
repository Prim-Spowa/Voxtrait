import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VideoPlayer } from "@/components/VideoPlayer";
import { DoublageShareButtons } from "@/components/DoublageShareButtons";
import { SignalerButton } from "@/components/SignalerButton";
import { Footer } from "@/components/nav/Footer";
import type { DoublageJob } from "@/lib/doublage";
import {
  buildUnavailableDoublageMetadata,
  doublageShareMetadataFromJob,
  toNextMetadata,
} from "@/lib/doublageShare";
import { resolveDoublageShareUrl } from "@/lib/doublageShareClient";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";

/**
 * Page publique de partage d'un doublage — ST 3.2, découpage en tâches
 * point 1 : « Page publique `/doublage/:id` avec balises Open Graph (titre,
 * vignette, vidéo) ».
 *
 * N'est servie que si le doublage a été rendu public (`visibilite ===
 * "lien_public"`, via `POST /api/doublages/:id/partage`). Sinon → 404, sans
 * révéler qu'un doublage privé existe sous cet id.
 *
 * ⚠️ Périmètre, cf. tête de `src/lib/doublage.ts` : le store est en mémoire.
 * En pratique un lien public n'est résoluble que dans le même process
 * (`next dev`) et tant que le job n'a pas expiré (TTL 15 min). La persistance
 * d'un doublage partagé (modèle Prisma + fichier de sortie durable) est un
 * point en suspens documenté dans les notes de dev ST 3.2.
 */

export const dynamic = "force-dynamic";

async function findPublicDoublage(id: string): Promise<DoublageJob | null> {
  const trimmed = id?.trim();
  if (!trimmed) return null;
  const job = await getDoublageJobStore().get(trimmed);
  if (!job || job.visibilite !== "lien_public") return null;
  return job;
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const job = await findPublicDoublage(params.id);
  if (!job) return buildUnavailableDoublageMetadata();
  return toNextMetadata(doublageShareMetadataFromJob(job));
}

export default async function DoublagePartagePage({ params }: { params: { id: string } }) {
  const job = await findPublicDoublage(params.id);
  if (!job) notFound();

  const titre = job.input.extraitTitre ?? "Doublage";
  const shareUrl = job.shareUrl ?? resolveDoublageShareUrl(null, job.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 880,
          margin: "0 auto",
          padding: "var(--space-6) var(--gutter-page) var(--space-10)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-micro)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              color: "var(--accent-primary)",
            }}
          >
            doublage partagé
          </span>
          <h1 style={{ margin: 0, fontSize: "var(--text-display-md)" }}>{titre}</h1>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>
            Un redoublage amateur réalisé sur Voxtrait. Écoutez le résultat, puis prêtez votre voix à
            votre tour.
          </p>
        </header>

        {/* Le doublage est un MP4 (sortie FFmpeg ST 3.1) → lecteur natif.
            ⚠️ En mode mock, `downloadUrl` pointe vers une route de
            téléchargement factice : le lecteur affichera une erreur de
            chargement (cf. point en suspens ST 3.1/3.2). Le flux de partage
            (métadonnées, boutons) reste, lui, entièrement fonctionnel. */}
        {job.downloadUrl ? (
          <VideoPlayer
            source="UPLOAD"
            url={job.downloadUrl}
            title={`Doublage — ${titre}`}
            poster={job.input.extraitThumbnail ?? null}
          />
        ) : (
          <p role="status" style={{ margin: 0, color: "var(--text-muted)" }}>
            La vidéo doublée n&apos;est pas disponible pour le moment.
          </p>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-title)" }}>Partager ce doublage</h2>
          <DoublageShareButtons shareUrl={shareUrl} extraitTitre={job.input.extraitTitre ?? null} />
        </section>

        {/* ST 7.1 — signalement de contenu. Ouvert aux visiteurs non connectés.
            `contenuId` = id du job de doublage (ST 3.1) : le rapprochement avec
            le doublage concerné se fait côté modération (ST 7.2). */}
        <section>
          <SignalerButton
            contenuType="DOUBLAGE"
            contenuId={job.id}
            contenuTitre={job.input.extraitTitre ?? null}
          />
        </section>
      </main>

      <Footer />
    </div>
  );
}
