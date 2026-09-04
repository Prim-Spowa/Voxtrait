/**
 * Adaptateur et accesseur pour le signalement de contenu (ST 7.1).
 *
 * - `getSignalementStore` : store Prisma (`prisma.signalement`). Jusqu'à
 *   ST 9.1 (« Bascule intégrale sur PostgreSQL »), sélectionnait un store
 *   in-memory quand `DATA_SOURCE=mock` ; bascule retirée, cf. README — le
 *   store in-memory (`createInMemorySignalementStore`, toujours défini dans
 *   `src/lib/signalement.ts`) reste utilisé, mais uniquement injecté
 *   directement par les tests unitaires du module métier.
 * - `prismaSignalementStore` : adaptateur `SignalementStore` →
 *   `prisma.signalement`. Isolé ici pour que `src/lib/signalement.ts` reste
 *   sans dépendance Prisma et testable.
 */

import { prisma } from "@/lib/prisma";
import type { Signalement, SignalementStore, StatutSignalement } from "@/lib/signalement";
import type { TypeContenuSignale } from "@/lib/signalementClient";

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma                                                          */
/* -------------------------------------------------------------------------- */

/** Ligne `Signalement` telle que renvoyée par Prisma (sous-ensemble utilisé). */
interface PrismaSignalementRow {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  motif: string;
  auteurId: string | null;
  statut: StatutSignalement;
  dateCreation: Date;
}

function toEntity(row: PrismaSignalementRow): Signalement {
  return {
    id: row.id,
    contenuType: row.contenuType,
    contenuId: row.contenuId,
    motif: row.motif,
    auteurId: row.auteurId,
    statut: row.statut,
    dateCreation: row.dateCreation.toISOString(),
  };
}

/** Sous-ensemble de `prisma.signalement` utilisé par l'adaptateur. */
interface PrismaSignalementDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaSignalementRow>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<PrismaSignalementRow[]>;
  findUnique(args: { where: { id: string } }): Promise<PrismaSignalementRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<PrismaSignalementRow>;
}

/**
 * `SignalementStore` branché sur `prisma.signalement`. ST 7.1 : `create` /
 * `count`. ST 7.2 : `page` / `get` / `setStatut` / `countPourContenu` pour le
 * dashboard de modération (index `@@index([statut, dateCreation])` et
 * `@@index([contenuType, contenuId])` du schéma).
 */
export function prismaSignalementStore(): SignalementStore {
  const delegate = (prisma as unknown as { signalement: PrismaSignalementDelegate })
    .signalement;

  return {
    async create(input) {
      const row = await delegate.create({
        data: {
          contenuType: input.contenuType,
          contenuId: input.contenuId,
          motif: input.motif,
          auteurId: input.auteurId ?? null,
        },
      });
      return toEntity(row);
    },
    async count() {
      return delegate.count();
    },
    async page({ statut, ordre = "asc", skip = 0, take }) {
      const where = statut ? { statut } : undefined;
      const [rows, total] = await Promise.all([
        delegate.findMany({
          where,
          orderBy: { dateCreation: ordre },
          skip,
          take,
        }),
        delegate.count({ where }),
      ]);
      return { items: rows.map(toEntity), total };
    },
    async get(id) {
      const row = await delegate.findUnique({ where: { id } });
      return row ? toEntity(row) : null;
    },
    async setStatut(id, statut) {
      const row = await delegate.update({ where: { id }, data: { statut } });
      return toEntity(row);
    },
    async countPourContenu(contenuType, contenuId, statut) {
      return delegate.count({
        where: { contenuType, contenuId, ...(statut ? { statut } : {}) },
      });
    },
  };
}

/**
 * Store des signalements — toujours l'adaptateur Prisma (cf. ST 9.1, en-tête
 * de fichier).
 */
export function getSignalementStore(): SignalementStore {
  return prismaSignalementStore();
}
