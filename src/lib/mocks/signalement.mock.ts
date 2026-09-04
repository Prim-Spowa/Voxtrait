/**
 * Adaptateurs et singleton pour le signalement de contenu (ST 7.1).
 *
 * - `getSignalementStore` : sélectionne le store selon `DATA_SOURCE`
 *   (`src/lib/config.ts`) — Prisma en mode `api`, in-memory partagé au sein du
 *   process en mode `mock`. Même pattern `globalThis` que
 *   `getDoublageSauvegardeStore` (ST 6.1).
 * - `prismaSignalementStore` : adaptateur `SignalementStore` →
 *   `prisma.signalement`. Isolé ici pour que `src/lib/signalement.ts` reste
 *   sans dépendance Prisma et testable.
 * - `resetMockSignalements` : vide le store mock entre deux tests.
 *
 * ⚠️ `prisma.signalement` n'est typé qu'après régénération du client Prisma
 * (`npm run prisma:generate`) suite à l'ajout du modèle `Signalement` — cf.
 * note dans le README.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import {
  createInMemorySignalementStore,
  type Signalement,
  type SignalementStore,
  type StatutSignalement,
} from "@/lib/signalement";
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
  count(): Promise<number>;
}

/** `SignalementStore` branché sur `prisma.signalement`. */
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
  };
}

/* -------------------------------------------------------------------------- */
/*  Singleton                                                                  */
/* -------------------------------------------------------------------------- */

const globalForSignalement = globalThis as unknown as {
  signalementStore?: SignalementStore;
};

/**
 * Store des signalements. En mode `mock`, un singleton in-memory partagé au
 * sein du process. En mode `api`, l'adaptateur Prisma.
 */
export function getSignalementStore(): SignalementStore {
  if (!isMockDataSource()) {
    return prismaSignalementStore();
  }
  if (!globalForSignalement.signalementStore) {
    globalForSignalement.signalementStore = createInMemorySignalementStore();
  }
  return globalForSignalement.signalementStore;
}

/** Vide le store mock — à appeler dans un `beforeEach`/`afterEach` de test. */
export function resetMockSignalements(): void {
  globalForSignalement.signalementStore = createInMemorySignalementStore();
}
