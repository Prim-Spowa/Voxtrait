/**
 * Adaptateurs et accesseurs pour le dashboard de modération (ST 7.2).
 *
 * - `getModerationStores` : `{ signalements, decisions }` — toujours les
 *   adaptateurs Prisma (`signalements` réutilise `getSignalementStore`,
 *   ST 7.1 ; `decisions` l'adaptateur ci-dessous).
 * - `getContenuModerationGateway` : mutations de contenu / compte, toujours
 *   `prisma.extrait` / `prisma.doublage` / `prisma.utilisateur`.
 *
 * Jusqu'à ST 9.1 (« Bascule intégrale sur PostgreSQL »), ces deux accesseurs
 * basculaient vers un store in-memory / un gateway agissant sur le jeu de
 * données mocké quand `DATA_SOURCE=mock` — bascule retirée, cf. README ; le
 * store in-memory (`createInMemoryDecisionModerationStore`, toujours défini
 * dans `src/lib/moderation.ts`) reste utilisé, mais uniquement injecté
 * directement par les tests unitaires du module métier.
 */

import { prisma } from "@/lib/prisma";
import type {
  ContenuModerationGateway,
  CreerDecisionInput,
  DecisionModeration,
  DecisionModerationStore,
} from "@/lib/moderation";
import type { SignalementStore } from "@/lib/signalement";
import { getSignalementStore } from "@/lib/mocks/signalement.mock";
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
  demandeRetraitId: string | null;
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
    demandeRetraitId: row.demandeRetraitId,
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
    demandeRetraitId: input.demandeRetraitId ?? null,
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
    retirerExtrait: (id, statutCible = "RETRAIT_MODERATION") =>
      tenter(() =>
        p.extrait.update({ where: { id }, data: { statut: statutCible } })
      ),
    retirerDoublage: (id, statutCible = "RETRAIT_MODERATION") =>
      tenter(() =>
        p.doublage.update({
          where: { id },
          data: { statutModeration: statutCible },
        })
      ),
    suspendreCompte: (id) =>
      tenter(() => p.utilisateur.update({ where: { id }, data: { statut: "SUSPENDU" } })),
  };
}

/** Stores nécessaires aux cas d'usage de `src/lib/moderation.ts`. */
export function getModerationStores(): {
  signalements: SignalementStore;
  decisions: DecisionModerationStore;
} {
  return { signalements: getSignalementStore(), decisions: prismaDecisionModerationStore() };
}

export function getContenuModerationGateway(): ContenuModerationGateway {
  return prismaContenuModerationGateway();
}
