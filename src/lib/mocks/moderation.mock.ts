/**
 * Adaptateurs et singletons pour le dashboard de modération (ST 7.2).
 *
 * - `getModerationStores` : `{ signalements, decisions }`. `signalements`
 *   réutilise le store de ST 7.1 (`getSignalementStore` — Prisma en mode `api`,
 *   in-memory partagé en mode `mock`, étendu en ST 7.2). `decisions` suit le
 *   même pattern `globalThis`.
 * - `getContenuModerationGateway` : mutations de contenu / compte. En mode
 *   `api`, `prisma.extrait` / `prisma.doublage` / `prisma.utilisateur`. En mode
 *   `mock`, agit sur le jeu de données mocké (extraits) et les stores in-memory
 *   (jobs de doublage, comptes).
 * - `resetMockModeration` : vide le store de décisions entre deux tests.
 *
 * ⚠️ `prisma.decisionModeration` et les colonnes `role` / `statut_moderation`
 * ne sont typées qu'après régénération du client Prisma
 * (`npm run prisma:generate`) suite à la migration `moderation_dashboard` —
 * cf. note dans le README.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import {
  createInMemoryDecisionModerationStore,
  type ContenuModerationGateway,
  type CreerDecisionInput,
  type DecisionModeration,
  type DecisionModerationStore,
} from "@/lib/moderation";
import type { SignalementStore } from "@/lib/signalement";
import { getSignalementStore } from "@/lib/mocks/signalement.mock";
import { getDoublageJobStore } from "@/lib/mocks/doublage.mock";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import { MOCK_EXTRAITS } from "@/lib/mocks/extraits.mock";
import type { TypeContenuSignale } from "@/lib/signalementClient";

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma — journal des décisions                                  */
/* -------------------------------------------------------------------------- */

interface PrismaDecisionRow {
  id: string;
  action: DecisionModeration["action"];
  moderateurId: string | null;
  signalementId: string | null;
  contenuType: TypeContenuSignale | null;
  contenuId: string | null;
  compteCibleId: string | null;
  commentaire: string | null;
  dateCreation: Date;
}

function toDecisionEntity(row: PrismaDecisionRow): DecisionModeration {
  return {
    id: row.id,
    action: row.action,
    moderateurId: row.moderateurId,
    signalementId: row.signalementId,
    contenuType: row.contenuType,
    contenuId: row.contenuId,
    compteCibleId: row.compteCibleId,
    commentaire: row.commentaire,
    dateCreation: row.dateCreation.toISOString(),
  };
}

interface PrismaDecisionDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaDecisionRow>;
  findMany(args: {
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<PrismaDecisionRow[]>;
  count(): Promise<number>;
}

function dataFromInput(input: CreerDecisionInput): Record<string, unknown> {
  return {
    action: input.action,
    moderateurId: input.moderateurId ?? null,
    signalementId: input.signalementId ?? null,
    contenuType: input.contenuType ?? null,
    contenuId: input.contenuId ?? null,
    compteCibleId: input.compteCibleId ?? null,
    commentaire: input.commentaire ?? null,
  };
}

export function prismaDecisionModerationStore(): DecisionModerationStore {
  const delegate = (
    prisma as unknown as { decisionModeration: PrismaDecisionDelegate }
  ).decisionModeration;

  return {
    async create(input) {
      const row = await delegate.create({ data: dataFromInput(input) });
      return toDecisionEntity(row);
    },
    async page({ skip, take }) {
      const [rows, total] = await Promise.all([
        delegate.findMany({ orderBy: { dateCreation: "desc" }, skip, take }),
        delegate.count(),
      ]);
      return { items: rows.map(toDecisionEntity), total };
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Adaptateur Prisma — mutations de contenu / compte                          */
/* -------------------------------------------------------------------------- */

/** `code: "P2025"` = « Record to update not found » (Prisma). */
function estIntrouvable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2025"
  );
}

interface PrismaUpdateDelegate {
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
}

export function prismaContenuModerationGateway(): ContenuModerationGateway {
  const p = prisma as unknown as {
    extrait: PrismaUpdateDelegate;
    doublage: PrismaUpdateDelegate;
    utilisateur: PrismaUpdateDelegate;
  };

  async function tenter(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      if (estIntrouvable(err)) return false;
      throw err;
    }
  }

  return {
    retirerExtrait: (id) =>
      tenter(() =>
        p.extrait.update({ where: { id }, data: { statut: "RETRAIT_MODERATION" } })
      ),
    retirerDoublage: (id) =>
      tenter(() =>
        p.doublage.update({
          where: { id },
          data: { statutModeration: "RETRAIT_MODERATION" },
        })
      ),
    suspendreCompte: (id) =>
      tenter(() => p.utilisateur.update({ where: { id }, data: { statut: "SUSPENDU" } })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Gateway mock (DATA_SOURCE=mock / next dev)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Gateway in-memory : agit sur le jeu de données mocké. Un retrait d'extrait
 * modifie `MOCK_EXTRAITS` en place (le listing public `GET /api/extraits` ne
 * renvoie que les `VALIDE`, l'extrait disparaît donc). Un retrait de doublage
 * dépublie le job (`visibilite = privee` → la page `/doublage/:id` renvoie
 * 404). Une suspension passe le compte mock à `SUSPENDU`.
 */
function createMockContenuModerationGateway(): ContenuModerationGateway {
  return {
    async retirerExtrait(id) {
      const extrait = MOCK_EXTRAITS.find((e) => e.id === id);
      if (!extrait) return false;
      extrait.statut = "RETRAIT_MODERATION";
      return true;
    },
    async retirerDoublage(id) {
      const store = getDoublageJobStore();
      const job = await store.get(id);
      if (!job) return false;
      await store.update(id, { visibilite: "privee", shareUrl: undefined });
      return true;
    },
    async suspendreCompte(id) {
      try {
        await mockUtilisateurDelegate.update({
          where: { id },
          data: { statut: "SUSPENDU" },
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Singletons                                                                 */
/* -------------------------------------------------------------------------- */

const globalForModeration = globalThis as unknown as {
  decisionModerationStore?: DecisionModerationStore;
};

function getDecisionStore(): DecisionModerationStore {
  if (!isMockDataSource()) return prismaDecisionModerationStore();
  if (!globalForModeration.decisionModerationStore) {
    globalForModeration.decisionModerationStore =
      createInMemoryDecisionModerationStore();
  }
  return globalForModeration.decisionModerationStore;
}

/** Stores nécessaires aux cas d'usage de `src/lib/moderation.ts`. */
export function getModerationStores(): {
  signalements: SignalementStore;
  decisions: DecisionModerationStore;
} {
  return { signalements: getSignalementStore(), decisions: getDecisionStore() };
}

export function getContenuModerationGateway(): ContenuModerationGateway {
  return isMockDataSource()
    ? createMockContenuModerationGateway()
    : prismaContenuModerationGateway();
}

/** Vide le store mock de décisions — `beforeEach`/`afterEach` de test. */
export function resetMockModeration(): void {
  globalForModeration.decisionModerationStore =
    createInMemoryDecisionModerationStore();
}
