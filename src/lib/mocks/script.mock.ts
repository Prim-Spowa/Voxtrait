import type { Prisma, ScriptLigne } from "@prisma/client";
import type { ScriptLigneDelegate } from "@/lib/script";

/**
 * Jeu de données mockées pour la synchronisation script/dialogue (ST 1.3),
 * utilisé quand `DATA_SOURCE=mock` (cf. `src/lib/config.ts`), à la place du
 * client Prisma — même rôle que `extraits.mock.ts` pour ST 1.1/1.2.
 *
 * `mock-001` ("L'Odyssée Stellaire — Pilote", cf. `extraits.mock.ts`) a un
 * script complet, avec un silence volontaire entre deux répliques (5.4s à
 * 5.9s), pour exercer :
 * - la surbrillance dynamique de bout en bout (`ScriptSynchronise`) ;
 * - le cas "aucune ligne active" pendant un silence (`resolveActiveLineIndex`
 *   retourne -1 sans qu'il s'agisse d'une absence de script).
 *
 * Les autres extraits mockés n'ont volontairement aucune ligne, pour couvrir
 * le cas "pas de script disponible" (US 1.3, second critère d'acceptation)
 * sans configuration supplémentaire.
 */

function makeLigne(input: {
  id: string;
  extraitId: string;
  texte: string;
  timestampDebut: number;
  timestampFin: number;
}): ScriptLigne {
  const now = new Date();
  return {
    id: input.id,
    extraitId: input.extraitId,
    texte: input.texte,
    timestampDebut: input.timestampDebut,
    timestampFin: input.timestampFin,
    createdAt: now,
    updatedAt: now,
  };
}

// Mutable : l'outil interne de saisie/import (POST /api/extraits/:id/script)
// doit pouvoir y ajouter des lignes en mode mock, pour être démontrable et
// testable sans base Postgres (cf. ST 1.3, découpage en tâches, point 4).
export const MOCK_SCRIPT_LIGNES: ScriptLigne[] = [
  makeLigne({
    id: "mock-script-001",
    extraitId: "mock-001",
    texte: "Tu ne passeras pas ce pont.",
    timestampDebut: 0,
    timestampFin: 3.2,
  }),
  makeLigne({
    id: "mock-script-002",
    extraitId: "mock-001",
    texte: "Alors pousse-moi.",
    timestampDebut: 3.2,
    timestampFin: 5.4,
  }),
  // Silence volontaire entre 5.4s et 5.9s (cf. commentaire ci-dessus).
  makeLigne({
    id: "mock-script-003",
    extraitId: "mock-001",
    texte: "Tu regretteras d'avoir dit ça.",
    timestampDebut: 5.9,
    timestampFin: 8.9,
  }),
  makeLigne({
    id: "mock-script-004",
    extraitId: "mock-001",
    texte: "On verra bien.",
    timestampDebut: 8.9,
    timestampFin: 11.0,
  }),
];

let nextMockId = MOCK_SCRIPT_LIGNES.length + 1;

function matchesExtraitId(ligne: ScriptLigne, where: Prisma.ScriptLigneWhereInput | undefined): boolean {
  if (!where) return true;
  const extraitId = (where as { extraitId?: unknown }).extraitId;
  if (extraitId === undefined) return true;
  // `listScriptLignes` ne produit que `{ extraitId }` (égalité simple, cf.
  // lib/script.ts) — c'est la seule forme gérée ici.
  return ligne.extraitId === extraitId;
}

/**
 * Implémentation en mémoire de `ScriptLigneDelegate` (cf. lib/script.ts),
 * pour remplacer `prisma.scriptLigne` quand `DATA_SOURCE=mock`. Reproduit le
 * comportement Prisma utile à `listScriptLignes`/`createScriptLignes` :
 * filtre `where` par `extraitId`, tri `timestampDebut asc`, insertion en
 * lot.
 */
export const mockScriptLigneDelegate: ScriptLigneDelegate = {
  async findMany(args) {
    const filtered = MOCK_SCRIPT_LIGNES.filter((ligne) => matchesExtraitId(ligne, args.where));
    return [...filtered].sort((a, b) => a.timestampDebut - b.timestampDebut);
  },
  async createMany(args) {
    const data = Array.isArray(args.data) ? args.data : [args.data];
    for (const entry of data) {
      MOCK_SCRIPT_LIGNES.push(
        makeLigne({
          id: `mock-script-${String(nextMockId++).padStart(3, "0")}`,
          extraitId: entry.extraitId as string,
          texte: entry.texte as string,
          timestampDebut: entry.timestampDebut as number,
          timestampFin: entry.timestampFin as number,
        })
      );
    }
    return { count: data.length };
  },
};
