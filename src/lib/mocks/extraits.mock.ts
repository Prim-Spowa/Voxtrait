import type {
  Extrait,
  OrigineExtrait,
  Prisma,
  SourceExtrait,
  StatutModeration,
  TypeExtrait,
} from "@prisma/client";
import type { ExtraitDelegate } from "@/lib/extraits";

/**
 * Jeu de données mockées pour la bibliothèque d'extraits (ST 1.1) et le
 * lecteur vidéo (ST 1.2) — utilisé quand `DATA_SOURCE=mock` (cf.
 * `src/lib/config.ts`), à la place du client Prisma.
 *
 * Objectifs de ce jeu de données :
 * - couvrir les 3 origines (FR/US/JP) et les 3 types de contenu ;
 * - couvrir les deux sources de lecture (EMBED/UPLOAD) avec des URLs
 *   réellement jouables, pour tester ST 1.2 de bout en bout sans dépendre
 *   d'un import réel (cf. `src/lib/mocks/videoPlayerScenarios.ts`) ;
 * - inclure des statuts non "VALIDE" (EN_ATTENTE, REJETE) pour vérifier que le
 *   filtre serveur les exclut bien du public (cf. `buildExtraitsWhere`) ;
 * - dépasser `PAGE_SIZE_DEFAUT` (20) en nombre d'extraits VALIDE, pour exercer
 *   la pagination sur plusieurs pages.
 *
 * URLs vidéo : contenus de démonstration libres de droits (Big Buck Bunny,
 * Blender Foundation, CC BY 3.0), utilisés uniquement à des fins de test —
 * à ne pas utiliser comme contenu de production.
 */

function iso(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

export const UPLOAD_SAMPLE_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
export const EMBED_SAMPLE_URL_YOUTUBE = "https://www.youtube.com/embed/aqz-KE-bpKQ";
export const EMBED_SAMPLE_URL_VIMEO = "https://player.vimeo.com/video/1084537";

interface MockExtraitInput {
  id: string;
  titre: string;
  origine: OrigineExtrait;
  type: TypeExtrait;
  source: SourceExtrait;
  urlSource: string;
  thumbnail?: string | null;
  statut: StatutModeration;
  /** Ancienneté simulée (jours) — détermine `createdAt`/l'ordre de tri par défaut. */
  daysAgo: number;
}

function makeExtrait(input: MockExtraitInput): Extrait {
  const createdAt = iso(input.daysAgo);
  return {
    id: input.id,
    titre: input.titre,
    origine: input.origine,
    type: input.type,
    source: input.source,
    urlSource: input.urlSource,
    thumbnail: input.thumbnail ?? null,
    statut: input.statut,
    createdAt,
    updatedAt: createdAt,
  };
}

const namedExtraits: Extrait[] = [
  makeExtrait({
    id: "mock-001",
    titre: "L'Odyssée Stellaire — Pilote",
    origine: "FR",
    type: "SERIE",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "VALIDE",
    daysAgo: 1,
  }),
  makeExtrait({
    id: "mock-002",
    titre: "Réverbérations",
    origine: "US",
    type: "FILM",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 2,
  }),
  makeExtrait({
    id: "mock-003",
    titre: "Sakura no Machi",
    origine: "JP",
    type: "DESSIN_ANIME",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_VIMEO,
    statut: "VALIDE",
    daysAgo: 3,
  }),
  makeExtrait({
    id: "mock-004",
    titre: "Nuits Blanches",
    origine: "FR",
    type: "FILM",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 4,
  }),
  makeExtrait({
    id: "mock-005",
    titre: "Iron Horizon",
    origine: "US",
    type: "SERIE",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "VALIDE",
    daysAgo: 5,
  }),
  makeExtrait({
    id: "mock-006",
    titre: "Yume no Kakera",
    origine: "JP",
    type: "FILM",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 6,
  }),
  makeExtrait({
    id: "mock-007",
    titre: "Les Ombres du Vieux Port",
    origine: "FR",
    type: "DESSIN_ANIME",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_VIMEO,
    statut: "VALIDE",
    daysAgo: 7,
  }),
  makeExtrait({
    id: "mock-008",
    titre: "Redline County",
    origine: "US",
    type: "FILM",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "VALIDE",
    daysAgo: 8,
  }),
  makeExtrait({
    id: "mock-009",
    titre: "Neko Densetsu",
    origine: "JP",
    type: "SERIE",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 9,
  }),
  makeExtrait({
    id: "mock-010",
    titre: "Marée Basse",
    origine: "FR",
    type: "SERIE",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 10,
  }),
  makeExtrait({
    id: "mock-011",
    titre: "Skyfall Protocol",
    origine: "US",
    type: "DESSIN_ANIME",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 11,
  }),
  makeExtrait({
    id: "mock-012",
    titre: "Kage no Machi",
    origine: "JP",
    type: "DESSIN_ANIME",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "VALIDE",
    daysAgo: 12,
  }),
  makeExtrait({
    id: "mock-013",
    titre: "Les Veilleurs",
    origine: "FR",
    type: "FILM",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_VIMEO,
    statut: "VALIDE",
    daysAgo: 13,
  }),
  makeExtrait({
    id: "mock-014",
    titre: "Northern Static",
    origine: "US",
    type: "SERIE",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 14,
  }),
  // Statuts non "VALIDE" : doivent être exclus du endpoint public
  // (cf. `buildExtraitsWhere` — statut toujours forcé à "VALIDE").
  makeExtrait({
    id: "mock-015",
    titre: "En attente de modération #1",
    origine: "FR",
    type: "FILM",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "EN_ATTENTE",
    daysAgo: 0,
  }),
  makeExtrait({
    id: "mock-016",
    titre: "En attente de modération #2",
    origine: "US",
    type: "SERIE",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "EN_ATTENTE",
    daysAgo: 0,
  }),
  makeExtrait({
    id: "mock-017",
    titre: "En attente de modération #3",
    origine: "JP",
    type: "DESSIN_ANIME",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "EN_ATTENTE",
    daysAgo: 0,
  }),
  makeExtrait({
    id: "mock-018",
    titre: "Contenu rejeté #1",
    origine: "FR",
    type: "FILM",
    source: "UPLOAD",
    urlSource: UPLOAD_SAMPLE_URL,
    statut: "REJETE",
    daysAgo: 0,
  }),
  makeExtrait({
    id: "mock-019",
    titre: "Contenu rejeté #2",
    origine: "US",
    type: "FILM",
    source: "EMBED",
    urlSource: EMBED_SAMPLE_URL_YOUTUBE,
    statut: "REJETE",
    daysAgo: 0,
  }),
];

// Complète le jeu de données pour dépasser PAGE_SIZE_DEFAUT (20) en nombre
// d'extraits VALIDE (14 ci-dessus + 10 ici = 24), afin de pouvoir tester la
// pagination sur une 2ᵉ page sans configuration supplémentaire.
const FILLER_COUNT = 10;
const fillerExtraits: Extrait[] = Array.from({ length: FILLER_COUNT }, (_, i) =>
  makeExtrait({
    id: `mock-filler-${String(i + 1).padStart(2, "0")}`,
    titre: `Extrait de test #${i + 1}`,
    origine: "FR",
    type: "FILM",
    source: i % 2 === 0 ? "EMBED" : "UPLOAD",
    urlSource: i % 2 === 0 ? EMBED_SAMPLE_URL_YOUTUBE : UPLOAD_SAMPLE_URL,
    statut: "VALIDE",
    daysAgo: 30 + i,
  })
);

export const MOCK_EXTRAITS: Extrait[] = [...namedExtraits, ...fillerExtraits];

function matchesWhere(extrait: Extrait, where: Prisma.ExtraitWhereInput | undefined): boolean {
  if (!where) return true;

  if (where.statut !== undefined && extrait.statut !== where.statut) return false;
  if (where.origine !== undefined && extrait.origine !== where.origine) return false;
  if (where.type !== undefined && extrait.type !== where.type) return false;

  if (where.titre !== undefined) {
    // `buildExtraitsWhere` ne produit que `{ contains, mode: "insensitive" }`
    // pour ce champ (cf. lib/extraits.ts) — c'est la seule forme gérée ici.
    const titreFilter = where.titre as unknown as { contains?: string } | string;
    const needle =
      typeof titreFilter === "string" ? titreFilter : (titreFilter.contains ?? "");
    if (needle && !extrait.titre.toLowerCase().includes(needle.toLowerCase())) {
      return false;
    }
  }

  return true;
}

function filterMockExtraits(where: Prisma.ExtraitWhereInput | undefined): Extrait[] {
  return MOCK_EXTRAITS.filter((extrait) => matchesWhere(extrait, where));
}

function sortByCreatedAtDesc(items: Extrait[]): Extrait[] {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Implémentation en mémoire de `ExtraitDelegate` (cf. lib/extraits.ts), pour
 * remplacer `prisma.extrait` quand `DATA_SOURCE=mock`. Reproduit le
 * comportement Prisma utile à `listExtraits` : filtre `where`, tri
 * `createdAt desc`, pagination `skip`/`take`.
 */
export const mockExtraitDelegate: ExtraitDelegate = {
  async findMany(args) {
    const filtered = sortByCreatedAtDesc(filterMockExtraits(args.where));
    const skip = args.skip ?? 0;
    const take = args.take ?? filtered.length;
    return filtered.slice(skip, skip + take);
  },
  async count(args) {
    return filterMockExtraits(args.where).length;
  },
};
