import type { Origine, TypeContenu } from "@/types/extrait";

/**
 * Construction de l'URL d'appel à `GET /api/extraits` à partir de l'état des
 * filtres du composant de listing (ST 1.1). Extrait en fonction pure pour être
 * testée indépendamment du rendu React.
 */
export interface BibliothequeFilters {
  origine?: Origine | "";
  type?: TypeContenu | "";
  q?: string;
  page?: number;
}

export function buildExtraitsApiUrl(filters: BibliothequeFilters): string {
  const params = new URLSearchParams();

  if (filters.origine) params.set("origine", filters.origine);
  if (filters.type) params.set("type", filters.type);
  if (filters.q && filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));

  const query = params.toString();
  return query ? `/api/extraits?${query}` : "/api/extraits";
}
