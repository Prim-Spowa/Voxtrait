/**
 * Adaptateurs et singleton pour la procédure notice-and-takedown (ST 7.3).
 *
 * - `getDemandeRetraitStore` : sélectionne le store selon `DATA_SOURCE`
 *   (`src/lib/config.ts`) — Prisma en mode `api`, in-memory partagé au sein du
 *   process en mode `mock`. Même pattern `globalThis` que `getSignalementStore`
 *   (ST 7.1) et `getDecisionStore` (ST 7.2).
 * - `prismaDemandeRetraitStore` : adaptateur `DemandeRetraitStore` →
 *   `prisma.demandeRetrait`. Isolé ici pour que `src/lib/demandeRetrait.ts`
 *   reste sans dépendance Prisma et testable.
 * - `resetMockDemandesRetrait` : vide le store mock entre deux tests.
 *
 * ⚠️ `prisma.demandeRetrait` n'est typé qu'après régénération du client Prisma
 * (`npm run prisma:generate`) suite à la migration `notice_and_takedown` — cf.
 * note dans le README.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import {
  createInMemoryDemandeRetraitStore,
  type CloreDemandeRetraitInput,
  type CreerDemandeRetraitInput,
  type DemandeRetrait,
  type DemandeRetraitStore,
  type ListerDemandesRetraitOptions,
} from "@/lib/demandeRetrait";
import type { StatutDemandeRetrait } from "@/lib/demandeRetraitClient";
import type { TypeContenuSignale } from "@/lib/signalementClient";

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma                                                          */
/* -------------------------------------------------------------------------- */

interface PrismaDemandeRetraitRow {
  id: string;
  contenuType: TypeContenuSignale;
  contenuId: string;
  oeuvre: string;
  demandeurNom: string;
  demandeurEmail: string;
  demandeurOrganisation: string | null;
  motif: string;
  declarationBonneFoi: boolean;
  statut: StatutDemandeRetrait;
  commentaireTraitement: string | null;
  traiteeParId: string | null;
  dateCreation: Date;
  dateTraitement: Date | null;
}

function toEntity(row: PrismaDemandeRetraitRow): DemandeRetrait {
  return {
    id: row.id,
    contenuType: row.contenuType,
    contenuId: row.contenuId,
    oeuvre: row.oeuvre,
    demandeurNom: row.demandeurNom,
    demandeurEmail: row.demandeurEmail,
    demandeurOrganisation: row.demandeurOrganisation,
    motif: row.motif,
    declarationBonneFoi: row.declarationBonneFoi,
    statut: row.statut,
    commentaireTraitement: row.commentaireTraitement,
    traiteeParId: row.traiteeParId,
    dateCreation: row.dateCreation.toISOString(),
    dateTraitement: row.dateTraitement ? row.dateTraitement.toISOString() : null,
  };
}

interface PrismaDemandeRetraitDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaDemandeRetraitRow>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<PrismaDemandeRetraitRow[]>;
  findUnique(args: {
    where: { id: string };
  }): Promise<PrismaDemandeRetraitRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<PrismaDemandeRetraitRow>;
}

export function prismaDemandeRetraitStore(): DemandeRetraitStore {
  const delegate = (
    prisma as unknown as { demandeRetrait: PrismaDemandeRetraitDelegate }
  ).demandeRetrait;

  return {
    async create(input: CreerDemandeRetraitInput) {
      const row = await delegate.create({
        data: {
          contenuType: input.contenuType,
          contenuId: input.contenuId,
          oeuvre: input.oeuvre,
          demandeurNom: input.demandeurNom,
          demandeurEmail: input.demandeurEmail,
          demandeurOrganisation: input.demandeurOrganisation ?? null,
          motif: input.motif,
          declarationBonneFoi: input.declarationBonneFoi,
        },
      });
      return toEntity(row);
    },
    async count() {
      return delegate.count();
    },
    async page({ statut, ordre = "asc", skip = 0, take }: ListerDemandesRetraitOptions) {
      const where = statut ? { statut } : undefined;
      const [rows, total] = await Promise.all([
        delegate.findMany({ where, orderBy: { dateCreation: ordre }, skip, take }),
        delegate.count({ where }),
      ]);
      return { items: rows.map(toEntity), total };
    },
    async get(id: string) {
      const row = await delegate.findUnique({ where: { id } });
      return row ? toEntity(row) : null;
    },
    async clore(id: string, input: CloreDemandeRetraitInput) {
      const row = await delegate.update({
        where: { id },
        data: {
          statut: input.statut,
          traiteeParId: input.traiteeParId,
          commentaireTraitement: input.commentaireTraitement,
          dateTraitement: new Date(input.dateTraitement),
        },
      });
      return toEntity(row);
    },
    async all() {
      const rows = await delegate.findMany({ orderBy: { dateCreation: "asc" } });
      return rows.map(toEntity);
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Singleton                                                                  */
/* -------------------------------------------------------------------------- */

const globalForDemandeRetrait = globalThis as unknown as {
  demandeRetraitStore?: DemandeRetraitStore;
};

export function getDemandeRetraitStore(): DemandeRetraitStore {
  if (!isMockDataSource()) {
    return prismaDemandeRetraitStore();
  }
  if (!globalForDemandeRetrait.demandeRetraitStore) {
    globalForDemandeRetrait.demandeRetraitStore = createInMemoryDemandeRetraitStore();
  }
  return globalForDemandeRetrait.demandeRetraitStore;
}

/** Vide le store mock — à appeler dans un `beforeEach`/`afterEach` de test. */
export function resetMockDemandesRetrait(): void {
  globalForDemandeRetrait.demandeRetraitStore = createInMemoryDemandeRetraitStore();
}
