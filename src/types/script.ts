/**
 * Types côté frontend pour `GET/POST /api/extraits/:id/script` (ST 1.3).
 *
 * Volontairement découplés des types Prisma (`@prisma/client` ne doit pas
 * être importé dans du code bundlé côté client) — même règle que
 * `types/extrait.ts` pour ST 1.1 : ceci reflète la forme JSON réelle
 * renvoyée par l'API (dates non exposées, non nécessaires à l'affichage).
 */

export interface ScriptLigneDTO {
  id: string;
  texte: string;
  timestampDebut: number;
  timestampFin: number;
}

export interface ScriptResponse {
  extraitId: string;
  lignes: ScriptLigneDTO[];
}
