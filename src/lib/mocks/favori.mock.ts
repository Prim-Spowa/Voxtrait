/**
 * Adaptateurs et singleton pour les favoris (ST 8.1).
 *
 * - `getFavoriStore` : sélectionne le store selon `DATA_SOURCE`
 *   (`src/lib/config.ts`) — Prisma en mode `api`, in-memory partagé au sein du
 *   process en mode `mock`. Même pattern `globalThis` que
 *   `getDoublageSauvegardeStore` (ST 6.1).
 * - `prismaFavoriStore` : adaptateur `FavoriStore` → `prisma.favori`. Isolé ici
 *   pour que le module métier (`src/lib/favori.ts`) reste sans dépendance
 *   Prisma et testable.
 * - `resetMockFavoris` : vide le store mock entre deux tests.
 *
 * ⚠️ `prisma.favori` n'est typé qu'après régénération du client Prisma
 * (`npm run prisma:generate`) suite à l'ajout du modèle `Favori` — cf. note
 * dans le README.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { createInMemoryFavoriStore, type Favori, type FavoriStore } from "@/lib/favori";

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma                                                          */
/* -------------------------------------------------------------------------- */

/** Ligne `Favori` telle que renvoyée par Prisma (sous-ensemble utilisé). */
interface PrismaFavoriRow {
  id: string;
  utilisateurId: string;
  extraitId: string;
  dateAjout: Date;
}

function toEntity(row: PrismaFavoriRow): Favori {
  return {
    id: row.id,
    utilisateurId: row.utilisateurId,
    extraitId: row.extraitId,
    dateAjout: row.dateAjout.toISOString(),
  };
}

/**
 * `FavoriStore` branché sur `prisma.favori`. La contrainte
 * `@@unique([utilisateurId, extraitId])` du schéma fait lever `P2002` à
 * `create` sur doublon — capturé par `ajouterFavori` (idempotence).
 *
 * `delete` s'appuie sur `deleteMany` (et non `delete`, qui exigerait un
 * `where` unique et lèverait `P2025` sur une ligne absente) : `deleteMany`
 * renvoie `{ count: 0 }` sans erreur, ce qui reflète directement la sémantique
 * idempotente attendue par `FavoriStore.delete`.
 */
export function prismaFavoriStore(): FavoriStore {
  // `prisma.favori` : voir avertissement en tête de fichier.
  const delegate = (prisma as unknown as { favori: PrismaFavoriDelegate }).favori;

  return {
    async create(input) {
      const row = await delegate.create({
        data: { utilisateurId: input.utilisateurId, extraitId: input.extraitId },
      });
      return toEntity(row);
    },
    async delete(utilisateurId, extraitId) {
      const { count } = await delegate.deleteMany({ where: { utilisateurId, extraitId } });
      return count > 0;
    },
    async find(utilisateurId, extraitId) {
      const row = await delegate.findUnique({
        where: { utilisateurId_extraitId: { utilisateurId, extraitId } },
      });
      return row ? toEntity(row) : null;
    },
    async pageByUtilisateur(utilisateurId, { skip, take }) {
      const where = { utilisateurId };
      const [rows, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy: { dateAjout: "desc" },
          skip,
          take,
        }),
        delegate.count({ where }),
      ]);
      return { items: rows.map(toEntity), total };
    },
  };
}

/** Sous-ensemble de `prisma.favori` utilisé par l'adaptateur. */
interface PrismaFavoriDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaFavoriRow>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  findUnique(args: { where: Record<string, unknown> }): Promise<PrismaFavoriRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<PrismaFavoriRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/*  Singleton                                                                  */
/* -------------------------------------------------------------------------- */

const globalForFavori = globalThis as unknown as {
  favoriStore?: FavoriStore;
};

/**
 * Store des favoris. En mode `mock`, un singleton in-memory partagé au sein du
 * process (le `POST`/`DELETE` de bascule et le `GET` paginé voient les mêmes
 * données). En mode `api`, l'adaptateur Prisma.
 */
export function getFavoriStore(): FavoriStore {
  if (!isMockDataSource()) {
    return prismaFavoriStore();
  }
  if (!globalForFavori.favoriStore) {
    globalForFavori.favoriStore = createInMemoryFavoriStore();
  }
  return globalForFavori.favoriStore;
}

/** Vide le store mock — à appeler dans un `beforeEach`/`afterEach` de test. */
export function resetMockFavoris(): void {
  globalForFavori.favoriStore = createInMemoryFavoriStore();
}
