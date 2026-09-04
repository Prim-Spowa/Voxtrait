/**
 * Adaptateurs et singleton pour la sauvegarde privée d'un doublage (ST 6.1).
 *
 * - `getDoublageSauvegardeStore` : sélectionne le store selon `DATA_SOURCE`
 *   (`src/lib/config.ts`) — Prisma en mode `api`, in-memory partagé au sein du
 *   process en mode `mock`. Même pattern `globalThis` que `getDoublageJobStore`
 *   (ST 3.1) / `getImportJobStore` (ST 5.1).
 * - `prismaDoublageSauvegardeStore` : adaptateur `DoublageSauvegardeStore` →
 *   `prisma.doublage`. Isolé ici pour que le module métier
 *   (`src/lib/doublageSauvegarde.ts`) reste sans dépendance Prisma et testable.
 * - `resetMockDoublageSauvegardes` : vide le store mock entre deux tests.
 *
 * ⚠️ `prisma.doublage` n'est typé qu'après régénération du client Prisma
 * (`npm run prisma:generate`) suite à l'ajout du modèle `Doublage` — cf. note
 * dans le README.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import {
  createInMemoryDoublageSauvegardeStore,
  type DoublageSauvegarde,
  type DoublageSauvegardeStore,
} from "@/lib/doublageSauvegarde";

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma                                                          */
/* -------------------------------------------------------------------------- */

/** Ligne `Doublage` telle que renvoyée par Prisma (sous-ensemble utilisé). */
interface PrismaDoublageRow {
  id: string;
  utilisateurId: string;
  extraitId: string;
  jobId: string;
  fichierUrl: string;
  visibilite: "PRIVEE" | "PUBLIC";
  dateCreation: Date;
}

function toEntity(row: PrismaDoublageRow): DoublageSauvegarde {
  return {
    id: row.id,
    utilisateurId: row.utilisateurId,
    extraitId: row.extraitId,
    jobId: row.jobId,
    fichierUrl: row.fichierUrl,
    visibilite: row.visibilite,
    dateCreation: row.dateCreation.toISOString(),
  };
}

/**
 * `DoublageSauvegardeStore` branché sur `prisma.doublage`. La contrainte
 * `@@unique([utilisateurId, jobId])` du schéma fait lever `P2002` à `create`
 * sur doublon — capturé par `sauvegarderDoublage` (idempotence).
 */
export function prismaDoublageSauvegardeStore(): DoublageSauvegardeStore {
  // `prisma.doublage` : voir avertissement en tête de fichier.
  const delegate = (prisma as unknown as { doublage: PrismaDoublageDelegate }).doublage;

  return {
    async create(input) {
      const row = await delegate.create({
        data: {
          utilisateurId: input.utilisateurId,
          extraitId: input.extraitId,
          jobId: input.jobId,
          fichierUrl: input.fichierUrl,
          visibilite: input.visibilite ?? "PRIVEE",
        },
      });
      return toEntity(row);
    },
    async get(id) {
      const row = await delegate.findUnique({ where: { id } });
      return row ? toEntity(row) : null;
    },
    async findByJob(utilisateurId, jobId) {
      const row = await delegate.findUnique({
        where: { utilisateurId_jobId: { utilisateurId, jobId } },
      });
      return row ? toEntity(row) : null;
    },
    async listByUtilisateur(utilisateurId) {
      const rows = await delegate.findMany({
        where: { utilisateurId },
        orderBy: { dateCreation: "desc" },
      });
      return rows.map(toEntity);
    },
    async pageByUtilisateur(utilisateurId, { skip, take }) {
      const where = { utilisateurId };
      const [rows, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy: { dateCreation: "desc" },
          skip,
          take,
        }),
        delegate.count({ where }),
      ]);
      return { items: rows.map(toEntity), total };
    },
  };
}

/** Sous-ensemble de `prisma.doublage` utilisé par l'adaptateur. */
interface PrismaDoublageDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaDoublageRow>;
  findUnique(args: { where: Record<string, unknown> }): Promise<PrismaDoublageRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<PrismaDoublageRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/*  Singleton                                                                  */
/* -------------------------------------------------------------------------- */

const globalForDoublageSauvegarde = globalThis as unknown as {
  doublageSauvegardeStore?: DoublageSauvegardeStore;
};

/**
 * Store des sauvegardes de doublage. En mode `mock`, un singleton in-memory
 * partagé au sein du process (le `POST` de sauvegarde et un futur `GET`
 * d'espace privé voient les mêmes données). En mode `api`, l'adaptateur Prisma.
 */
export function getDoublageSauvegardeStore(): DoublageSauvegardeStore {
  if (!isMockDataSource()) {
    return prismaDoublageSauvegardeStore();
  }
  if (!globalForDoublageSauvegarde.doublageSauvegardeStore) {
    globalForDoublageSauvegarde.doublageSauvegardeStore =
      createInMemoryDoublageSauvegardeStore();
  }
  return globalForDoublageSauvegarde.doublageSauvegardeStore;
}

/** Vide le store mock — à appeler dans un `beforeEach`/`afterEach` de test. */
export function resetMockDoublageSauvegardes(): void {
  globalForDoublageSauvegarde.doublageSauvegardeStore =
    createInMemoryDoublageSauvegardeStore();
}
