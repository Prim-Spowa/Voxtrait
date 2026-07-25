import type { Extrait, OrigineExtrait, Prisma, TypeExtrait } from "@prisma/client";

/**
 * Logique métier du endpoint `GET /api/extraits` (ST 1.1).
 *
 * Séparée de la route Next.js pour être testable unitairement sans dépendre
 * du runtime Next (parsing/validation des paramètres) et avec un mock du
 * client Prisma (construction de la requête + pagination).
 */

export const ORIGINES_VALIDES: readonly OrigineExtrait[] = ["FR", "US", "JP"];
export const TYPES_VALIDES: readonly TypeExtrait[] = ["FILM", "SERIE", "DESSIN_ANIME"];

export const PAGE_SIZE_DEFAUT = 20;
export const PAGE_SIZE_MAX = 50;

export interface ExtraitsQueryParams {
  origine?: OrigineExtrait;
  type?: TypeExtrait;
  q?: string;
  page: number;
  pageSize: number;
}

export class InvalidQueryParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueryParamError";
  }
}

/**
 * Parse et valide les query params bruts (URLSearchParams ou objet équivalent)
 * de `GET /api/extraits`.
 *
 * Lève une `InvalidQueryParamError` si une valeur est fournie mais invalide
 * (plutôt que de la silencieusement ignorer), pour retourner un 400 explicite
 * côté route plutôt qu'un comportement de filtrage surprenant.
 */
export function parseExtraitsQueryParams(
  searchParams: URLSearchParams
): ExtraitsQueryParams {
  const origineRaw = searchParams.get("origine");
  const typeRaw = searchParams.get("type");
  const q = searchParams.get("q")?.trim() || undefined;
  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");

  let origine: OrigineExtrait | undefined;
  if (origineRaw) {
    const upper = origineRaw.toUpperCase();
    if (!ORIGINES_VALIDES.includes(upper as OrigineExtrait)) {
      throw new InvalidQueryParamError(
        `Paramètre "origine" invalide: "${origineRaw}". Valeurs acceptées: ${ORIGINES_VALIDES.join(", ")}.`
      );
    }
    origine = upper as OrigineExtrait;
  }

  let type: TypeExtrait | undefined;
  if (typeRaw) {
    const upper = typeRaw.toUpperCase();
    if (!TYPES_VALIDES.includes(upper as TypeExtrait)) {
      throw new InvalidQueryParamError(
        `Paramètre "type" invalide: "${typeRaw}". Valeurs acceptées: ${TYPES_VALIDES.join(", ")}.`
      );
    }
    type = upper as TypeExtrait;
  }

  let page = 1;
  if (pageRaw !== null) {
    const parsed = Number(pageRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new InvalidQueryParamError(
        `Paramètre "page" invalide: "${pageRaw}". Doit être un entier >= 1.`
      );
    }
    page = parsed;
  }

  let pageSize = PAGE_SIZE_DEFAUT;
  if (pageSizeRaw !== null) {
    const parsed = Number(pageSizeRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new InvalidQueryParamError(
        `Paramètre "pageSize" invalide: "${pageSizeRaw}". Doit être un entier >= 1.`
      );
    }
    // Plafond plutôt qu'erreur : évite qu'un client mal intentionné/buggé ne
    // demande une page de taille arbitraire (protection légère contre une
    // requête coûteuse), cf. ST 1.1 "Points d'attention" sur la performance.
    pageSize = Math.min(parsed, PAGE_SIZE_MAX);
  }

  return { origine, type, q, page, pageSize };
}

export interface ExtraitsPage {
  items: Extrait[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Sous-ensemble du client Prisma utilisé ici — permet un mock simple en test. */
export type ExtraitDelegate = {
  findMany: (args: Prisma.ExtraitFindManyArgs) => Promise<Extrait[]>;
  count: (args: Prisma.ExtraitCountArgs) => Promise<number>;
};

/**
 * Construit le `where` Prisma pour un jeu de filtres donné.
 *
 * Le statut "validé" est toujours forcé et n'est jamais pilotable par le
 * client : cf. ST 1.1, "Points d'attention" — "n'afficher que les extraits
 * au statut « validé » côté public". Ce endpoint est public (pas d'admin).
 */
export function buildExtraitsWhere(
  params: Pick<ExtraitsQueryParams, "origine" | "type" | "q">
): Prisma.ExtraitWhereInput {
  const where: Prisma.ExtraitWhereInput = {
    statut: "VALIDE",
  };

  if (params.origine) {
    where.origine = params.origine;
  }

  if (params.type) {
    where.type = params.type;
  }

  if (params.q) {
    // `contains` + mode insensitive : s'appuie sur l'index pg_trgm créé en
    // migration (prisma/migrations/.../migration.sql) pour rester performant
    // sur ILIKE '%terme%' à volume croissant.
    where.titre = { contains: params.q, mode: "insensitive" };
  }

  return where;
}

/**
 * Récupère une page filtrée/paginée de la bibliothèque d'extraits.
 *
 * `extraitDelegate` est injecté (plutôt que d'importer directement `prisma`)
 * pour permettre un test unitaire avec un mock, sans base de données réelle.
 */
export async function listExtraits(
  extraitDelegate: ExtraitDelegate,
  params: ExtraitsQueryParams
): Promise<ExtraitsPage> {
  const where = buildExtraitsWhere(params);
  const skip = (params.page - 1) * params.pageSize;

  const [items, total] = await Promise.all([
    extraitDelegate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: params.pageSize,
    }),
    extraitDelegate.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  };
}
