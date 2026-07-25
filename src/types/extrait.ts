/**
 * Types côté frontend pour la réponse de `GET /api/extraits`.
 *
 * Volontairement découplés des types Prisma (`@prisma/client` ne doit pas être
 * importé dans du code bundlé côté client) : ceci reflète la forme JSON réelle
 * renvoyée par l'API (dates sérialisées en string ISO).
 */

export type Origine = "FR" | "US" | "JP";
export type TypeContenu = "FILM" | "SERIE" | "DESSIN_ANIME";

export interface ExtraitDTO {
  id: string;
  titre: string;
  origine: Origine;
  type: TypeContenu;
  source: "EMBED" | "UPLOAD";
  urlSource: string;
  thumbnail: string | null;
  statut: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtraitsResponse {
  items: ExtraitDTO[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const ORIGINE_LABELS: Record<Origine, string> = {
  FR: "France",
  US: "États-Unis",
  JP: "Japon",
};

export const TYPE_LABELS: Record<TypeContenu, string> = {
  FILM: "Film",
  SERIE: "Série",
  DESSIN_ANIME: "Dessin animé",
};
