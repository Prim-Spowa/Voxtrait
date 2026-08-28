/**
 * Génération serveur des métadonnées de partage (Open Graph / Twitter Card)
 * de la page publique d'un doublage — ST 3.2 « Partage sur réseaux sociaux »,
 * découpage en tâches point 1 : « Page publique `/doublage/:id` avec balises
 * Open Graph (titre, vignette, vidéo) ».
 *
 * Module **pur** : à partir d'un job de doublage rendu public, il produit la
 * description des balises `<meta>` — il n'accède ni au store, ni au réseau, ni
 * au runtime Next. C'est la partie couverte par la Definition of Done ST 3.2
 * (« Tests unitaires sur la génération des métadonnées Open Graph »), cf.
 * `src/lib/__tests__/doublageShare.test.ts`.
 *
 * La séparation logique/exécution suit le reste du projet : `ffmpegCommand.ts`
 * décrit une commande sans la lancer, ce module décrit des métadonnées sans
 * les rendre. Le mapping vers l'objet `Metadata` de Next (`toNextMetadata`)
 * est une projection mince, elle aussi testable.
 */

import type { Metadata } from "next";
import type { DoublageJob } from "@/lib/doublage";
import { DOUBLAGE_OUTPUT_MIME_TYPE } from "@/lib/ffmpegCommand";
import { resolveDoublageShareUrl } from "@/lib/doublageShareClient";

export const DOUBLAGE_SITE_NAME = "Voxtrait";

/** Entrée de `buildDoublageShareMetadata` — le strict nécessaire aux balises. */
export interface DoublageShareMetadataInput {
  id: string;
  extraitTitre?: string | null;
  /** URL absolue de la page publique (`og:url` / canonique). */
  shareUrl: string;
  /** URL de la vidéo doublée (`og:video`) — l'URL de téléchargement signée (ST 3.1). */
  videoUrl?: string | null;
  /** MIME de la vidéo doublée (défaut : `video/mp4`). */
  videoMimeType?: string | null;
  /** Vignette de l'extrait (`og:image`). */
  imageUrl?: string | null;
}

export interface DoublageShareImage {
  url: string;
  alt: string;
}

export interface DoublageShareVideo {
  url: string;
  type: string;
}

/**
 * Description neutre des métadonnées de partage — indépendante du format de
 * sortie (Next `Metadata`, balises brutes…). C'est cette forme qui est
 * assertée dans les tests.
 */
export interface DoublageShareMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  siteName: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    type: "video.other";
    siteName: string;
    images: DoublageShareImage[];
    videos: DoublageShareVideo[];
  };
  twitter: {
    card: "player" | "summary_large_image" | "summary";
    title: string;
    description: string;
    images: string[];
  };
  /**
   * Les pages de partage sont accessibles par lien direct mais **non
   * indexées** : le risque juridique lié aux droits d'auteur est jugé élevé
   * (cf. cahier des charges §9) et rien n'impose que ces pages remontent dans
   * les moteurs de recherche. `follow: true` laisse néanmoins suivre les liens
   * internes (retour bibliothèque…).
   */
  robots: { index: false; follow: true };
}

function buildTitle(extraitTitre: string | null | undefined): string {
  const titre = (extraitTitre ?? "").trim();
  return titre ? `${titre} — doublage sur ${DOUBLAGE_SITE_NAME}` : `Doublage sur ${DOUBLAGE_SITE_NAME}`;
}

function buildDescription(extraitTitre: string | null | undefined): string {
  const titre = (extraitTitre ?? "").trim();
  return titre
    ? `Un redoublage amateur de « ${titre} », réalisé sur ${DOUBLAGE_SITE_NAME}. Écoutez le résultat et prêtez votre voix à votre tour.`
    : `Un redoublage amateur réalisé sur ${DOUBLAGE_SITE_NAME}. Écoutez le résultat et prêtez votre voix à votre tour.`;
}

/**
 * Construit la description des métadonnées de partage d'un doublage public.
 *
 * Règles :
 * - `og:image` n'est présent que si une vignette existe (pas de placeholder
 *   distant : une image cassée dégrade l'aperçu plus qu'elle ne l'aide) ;
 * - `og:video` n'est présent que si l'URL de la vidéo doublée est connue ;
 * - la Twitter Card est `player` si une vidéo est disponible, sinon
 *   `summary_large_image` avec vignette, sinon `summary` (texte seul).
 */
export function buildDoublageShareMetadata(
  input: DoublageShareMetadataInput
): DoublageShareMetadata {
  const title = buildTitle(input.extraitTitre);
  const description = buildDescription(input.extraitTitre);
  const altBase = (input.extraitTitre ?? "").trim();
  const imageAlt = altBase ? `Vignette de « ${altBase} »` : "Vignette du doublage";

  const images: DoublageShareImage[] = input.imageUrl
    ? [{ url: input.imageUrl, alt: imageAlt }]
    : [];
  const videos: DoublageShareVideo[] = input.videoUrl
    ? [{ url: input.videoUrl, type: input.videoMimeType || DOUBLAGE_OUTPUT_MIME_TYPE }]
    : [];

  const twitterCard: DoublageShareMetadata["twitter"]["card"] =
    videos.length > 0 ? "player" : images.length > 0 ? "summary_large_image" : "summary";

  return {
    title,
    description,
    canonicalUrl: input.shareUrl,
    siteName: DOUBLAGE_SITE_NAME,
    openGraph: {
      title,
      description,
      url: input.shareUrl,
      type: "video.other",
      siteName: DOUBLAGE_SITE_NAME,
      images,
      videos,
    },
    twitter: {
      card: twitterCard,
      title,
      description,
      images: images.map((image) => image.url),
    },
    robots: { index: false, follow: true },
  };
}

/**
 * Dérive l'entrée de `buildDoublageShareMetadata` depuis un `DoublageJob`
 * complet. `baseUrl` sert de repli si `job.shareUrl` n'est pas encore
 * renseigné (job résolu juste avant `publishDoublageJob`).
 */
export function doublageShareMetadataFromJob(
  job: DoublageJob,
  baseUrl?: string | null
): DoublageShareMetadata {
  return buildDoublageShareMetadata({
    id: job.id,
    extraitTitre: job.input.extraitTitre,
    shareUrl: job.shareUrl ?? resolveDoublageShareUrl(baseUrl, job.id),
    videoUrl: job.downloadUrl ?? null,
    videoMimeType: job.outputMimeType ?? null,
    imageUrl: job.input.extraitThumbnail ?? null,
  });
}

/**
 * Métadonnées d'une page publique introuvable / privée : titre générique et
 * `noindex, nofollow` — on ne laisse pas fuiter l'existence d'un doublage non
 * partagé, et on évite qu'un lien mort soit indexé.
 */
export function buildUnavailableDoublageMetadata(): Metadata {
  return {
    title: `Doublage indisponible — ${DOUBLAGE_SITE_NAME}`,
    description: "Ce doublage n'existe pas ou n'est plus partagé publiquement.",
    robots: { index: false, follow: false },
  };
}

/** Projette `DoublageShareMetadata` vers l'objet `Metadata` attendu par Next. */
export function toNextMetadata(meta: DoublageShareMetadata): Metadata {
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonicalUrl },
    robots: meta.robots,
    openGraph: {
      title: meta.openGraph.title,
      description: meta.openGraph.description,
      url: meta.openGraph.url,
      type: meta.openGraph.type,
      siteName: meta.openGraph.siteName,
      images: meta.openGraph.images.map((image) => ({ url: image.url, alt: image.alt })),
      videos: meta.openGraph.videos.map((video) => ({ url: video.url, type: video.type })),
    },
    twitter: {
      card: meta.twitter.card,
      title: meta.twitter.title,
      description: meta.twitter.description,
      images: meta.twitter.images,
    },
  };
}
