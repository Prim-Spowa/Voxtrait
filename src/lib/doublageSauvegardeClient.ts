/**
 * Logique client-safe de la sauvegarde privée d'un doublage — ST 6.1
 * « Sauvegarde privée d'un doublage » (US 6.1 : sauvegarder un doublage dans
 * mon espace privé).
 *
 * Séparée de `lib/doublageSauvegarde.ts` (orchestration serveur : store,
 * contrôle d'accès, `node:crypto` indirect) pour pouvoir être importée depuis
 * un composant `"use client"` — même séparation que `doublageClient.ts` vs
 * `doublage.ts` (ST 3.1) ou `doublageShareClient.ts` vs `doublageShare.ts`
 * (ST 3.2).
 *
 * Contient : le type de visibilité, la forme de la vue API (`DoublageSauvegardeView`)
 * et le libellé de la route de l'espace privé.
 */

/**
 * Visibilité d'une entrée `Doublage` sauvegardée. Reprend les valeurs de l'enum
 * Prisma `VisibiliteDoublage`, dupliquées ici pour rester client-safe (même
 * approche que `DoublageVisibilite` dans `doublageShareClient.ts`).
 *
 *  - `PRIVEE` (défaut à la sauvegarde) : lisible uniquement par le propriétaire ;
 *  - `PUBLIC` : réservé à un usage ultérieur (partage depuis l'espace privé).
 *
 * ⚠️ À ne pas confondre avec `DoublageVisibilite` (`privee` / `lien_public`,
 * ST 3.2) qui gouverne la page de partage anonyme `/doublage/:id`.
 */
export type VisibiliteDoublage = "PRIVEE" | "PUBLIC";

/** Chemin de l'espace privé où l'utilisateur retrouve ses doublages (ST 6.2). */
export const MON_ESPACE_DOUBLAGES_PATH = "/mon-espace/doublages";

/**
 * Projection d'une entrée `Doublage` renvoyée par l'API au client. On expose
 * l'id de la sauvegarde, l'extrait d'origine, l'URL du fichier, la visibilité
 * et la date de création — pas l'`utilisateurId` (implicite : c'est toujours
 * celui de la session) ni le `jobId` (détail d'implémentation ST 3.1).
 */
export interface DoublageSauvegardeView {
  id: string;
  extraitId: string;
  fichierUrl: string;
  visibilite: VisibiliteDoublage;
  /** Date de création, ISO 8601. */
  dateCreation: string;
}
