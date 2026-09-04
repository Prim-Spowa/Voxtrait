/**
 * Script de seed Prisma — ST 9.1 « Bascule intégrale sur PostgreSQL »,
 * découpage en tâches point 1.
 *
 * Reproduit, dans une vraie base Postgres, le jeu de données jusqu'ici servi
 * par `DATA_SOURCE=mock` — `src/lib/mocks/extraits.mock.ts` (toujours
 * présent, encore utilisé par les favoris, ST 8.1, hors périmètre de
 * ST 9.1) et l'ancien `src/lib/mocks/script.mock.ts` (supprimé, devenu
 * inutile une fois `GET`/`POST /api/extraits/:id/script` toujours branchés
 * sur Prisma) : même identifiants (`mock-001`, …),
 * mêmes titres/origines/types/statuts, même script de démonstration sur
 * `mock-001`. Objectif : permettre de développer/tester la bibliothèque
 * (ST 1.1), le lecteur vidéo (ST 1.2) et la synchronisation de script
 * (ST 1.3) en local sans jamais activer de bascule applicative — la seule
 * différence entre développement et production est le contenu de la base,
 * pas le code qui la lit.
 *
 * ⚠️ Ce que ce seed NE reproduit PAS, faute de jeu de données existant à
 * reproduire : les signalements (ST 7.1), les demandes de retrait (ST 7.3)
 * et les doublages sauvegardés (ST 6.1). Contrairement aux extraits et aux
 * scripts, ces trois entités n'ont jamais eu de jeu de données mocké fixe
 * dans `src/lib/mocks/*.mock.ts` — seulement des stores en mémoire vides,
 * peuplés au fil des actions utilisateur (signaler, demander un retrait,
 * sauvegarder un doublage). Un jeu de données de démonstration pour ces
 * entités serait donc inventé, pas repris d'un mock existant — décision
 * signalée dans les notes de dev plutôt que fabriquée ici sans validation
 * du porteur de projet.
 *
 * Idempotent : peut être exécuté plusieurs fois sans dupliquer les lignes
 * (`upsert` sur l'identifiant mocké).
 *
 * Usage : `npm run db:seed` (équivalent à `npx prisma db seed`, cf.
 * `package.json` → `prisma.seed`). Exécuté automatiquement après
 * `prisma migrate dev` / `prisma migrate reset`.
 */

import { PrismaClient, type Extrait, type ScriptLigne } from "@prisma/client";

const prisma = new PrismaClient();

function iso(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

const UPLOAD_SAMPLE_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
const EMBED_SAMPLE_URL_YOUTUBE = "https://www.youtube.com/embed/aqz-KE-bpKQ";
const EMBED_SAMPLE_URL_VIMEO = "https://player.vimeo.com/video/1084537";

type SeedExtrait = Pick<
  Extrait,
  "id" | "titre" | "origine" | "type" | "source" | "urlSource" | "statut"
> & { daysAgo: number };

// Même jeu de données que `src/lib/mocks/extraits.mock.ts` (`namedExtraits`) :
// 14 extraits VALIDE couvrant les 3 origines/types/sources, 3 EN_ATTENTE et
// 2 REJETE pour vérifier que le endpoint public les exclut bien.
const NAMED_EXTRAITS: SeedExtrait[] = [
  { id: "mock-001", titre: "L'Odyssée Stellaire — Pilote", origine: "FR", type: "SERIE", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "VALIDE", daysAgo: 1 },
  { id: "mock-002", titre: "Réverbérations", origine: "US", type: "FILM", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 2 },
  { id: "mock-003", titre: "Sakura no Machi", origine: "JP", type: "DESSIN_ANIME", source: "EMBED", urlSource: EMBED_SAMPLE_URL_VIMEO, statut: "VALIDE", daysAgo: 3 },
  { id: "mock-004", titre: "Nuits Blanches", origine: "FR", type: "FILM", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 4 },
  { id: "mock-005", titre: "Iron Horizon", origine: "US", type: "SERIE", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "VALIDE", daysAgo: 5 },
  { id: "mock-006", titre: "Yume no Kakera", origine: "JP", type: "FILM", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 6 },
  { id: "mock-007", titre: "Les Ombres du Vieux Port", origine: "FR", type: "DESSIN_ANIME", source: "EMBED", urlSource: EMBED_SAMPLE_URL_VIMEO, statut: "VALIDE", daysAgo: 7 },
  { id: "mock-008", titre: "Redline County", origine: "US", type: "FILM", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "VALIDE", daysAgo: 8 },
  { id: "mock-009", titre: "Neko Densetsu", origine: "JP", type: "SERIE", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 9 },
  { id: "mock-010", titre: "Marée Basse", origine: "FR", type: "SERIE", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 10 },
  { id: "mock-011", titre: "Skyfall Protocol", origine: "US", type: "DESSIN_ANIME", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 11 },
  { id: "mock-012", titre: "Kage no Machi", origine: "JP", type: "DESSIN_ANIME", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "VALIDE", daysAgo: 12 },
  { id: "mock-013", titre: "Les Veilleurs", origine: "FR", type: "FILM", source: "EMBED", urlSource: EMBED_SAMPLE_URL_VIMEO, statut: "VALIDE", daysAgo: 13 },
  { id: "mock-014", titre: "Northern Static", origine: "US", type: "SERIE", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "VALIDE", daysAgo: 14 },
  { id: "mock-015", titre: "En attente de modération #1", origine: "FR", type: "FILM", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "EN_ATTENTE", daysAgo: 0 },
  { id: "mock-016", titre: "En attente de modération #2", origine: "US", type: "SERIE", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "EN_ATTENTE", daysAgo: 0 },
  { id: "mock-017", titre: "En attente de modération #3", origine: "JP", type: "DESSIN_ANIME", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "EN_ATTENTE", daysAgo: 0 },
  { id: "mock-018", titre: "Contenu rejeté #1", origine: "FR", type: "FILM", source: "UPLOAD", urlSource: UPLOAD_SAMPLE_URL, statut: "REJETE", daysAgo: 0 },
  { id: "mock-019", titre: "Contenu rejeté #2", origine: "US", type: "FILM", source: "EMBED", urlSource: EMBED_SAMPLE_URL_YOUTUBE, statut: "REJETE", daysAgo: 0 },
];

// Même complément que `fillerExtraits` (10 extraits) : dépasse
// `PAGE_SIZE_DEFAUT` (20) en nombre d'extraits VALIDE (14 + 10 = 24) pour
// exercer la pagination sur une 2ᵉ page sans configuration supplémentaire.
const FILLER_COUNT = 10;
const FILLER_EXTRAITS: SeedExtrait[] = Array.from({ length: FILLER_COUNT }, (_, i) => ({
  id: `mock-filler-${String(i + 1).padStart(2, "0")}`,
  titre: `Extrait de test #${i + 1}`,
  origine: "FR",
  type: "FILM",
  source: i % 2 === 0 ? "EMBED" : "UPLOAD",
  urlSource: i % 2 === 0 ? EMBED_SAMPLE_URL_YOUTUBE : UPLOAD_SAMPLE_URL,
  statut: "VALIDE",
  daysAgo: 30 + i,
}));

const SEED_EXTRAITS: SeedExtrait[] = [...NAMED_EXTRAITS, ...FILLER_EXTRAITS];

// Même script de démonstration que `src/lib/mocks/script.mock.ts`, porté par
// `mock-001` — silence volontaire entre 5.4s et 5.9s (cf. commentaire du
// fichier mocké). Les autres extraits restent volontairement sans script.
type SeedScriptLigne = Pick<
  ScriptLigne,
  "id" | "extraitId" | "texte" | "timestampDebut" | "timestampFin"
>;

const SEED_SCRIPT_LIGNES: SeedScriptLigne[] = [
  { id: "mock-script-001", extraitId: "mock-001", texte: "Tu ne passeras pas ce pont.", timestampDebut: 0, timestampFin: 3.2 },
  { id: "mock-script-002", extraitId: "mock-001", texte: "Alors pousse-moi.", timestampDebut: 3.2, timestampFin: 5.4 },
  { id: "mock-script-003", extraitId: "mock-001", texte: "Tu regretteras d'avoir dit ça.", timestampDebut: 5.9, timestampFin: 8.9 },
  { id: "mock-script-004", extraitId: "mock-001", texte: "On verra bien.", timestampDebut: 8.9, timestampFin: 11.0 },
];

async function seedExtraits(): Promise<void> {
  for (const extrait of SEED_EXTRAITS) {
    const createdAt = iso(extrait.daysAgo);
    await prisma.extrait.upsert({
      where: { id: extrait.id },
      create: {
        id: extrait.id,
        titre: extrait.titre,
        origine: extrait.origine,
        type: extrait.type,
        source: extrait.source,
        urlSource: extrait.urlSource,
        statut: extrait.statut,
        createdAt,
        updatedAt: createdAt,
      },
      // Idempotence : un second passage réaligne les champs de contenu sans
      // toucher aux entités qui référencent l'extrait par id (scripts,
      // favoris, signalements, doublages…).
      update: {
        titre: extrait.titre,
        origine: extrait.origine,
        type: extrait.type,
        source: extrait.source,
        urlSource: extrait.urlSource,
        statut: extrait.statut,
      },
    });
  }
  console.log(`Extraits : ${SEED_EXTRAITS.length} lignes upsertées.`);
}

async function seedScriptLignes(): Promise<void> {
  for (const ligne of SEED_SCRIPT_LIGNES) {
    await prisma.scriptLigne.upsert({
      where: { id: ligne.id },
      create: ligne,
      update: {
        texte: ligne.texte,
        timestampDebut: ligne.timestampDebut,
        timestampFin: ligne.timestampFin,
      },
    });
  }
  console.log(`Lignes de script : ${SEED_SCRIPT_LIGNES.length} lignes upsertées.`);
}

async function main(): Promise<void> {
  await seedExtraits();
  await seedScriptLignes();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Échec du seed :", error);
    await prisma.$disconnect();
    process.exit(1);
  });
