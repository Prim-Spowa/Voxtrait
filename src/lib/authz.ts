/**
 * RBAC minimal — ST 7.2 « Dashboard de modération », découpage en tâches
 * point 1 : « Ajouter un rôle utilisateur (`utilisateur` / `moderateur` /
 * `admin`) ».
 *
 * Module **pur / client-safe** (aucune dépendance : ni `@prisma/client`, ni
 * `node:crypto`) — importable depuis un composant `"use client"` comme depuis
 * un Route Handler, à l'image de `authClient.ts` (ST 4.1) ou `authGuard.ts`
 * (ST 4.2).
 *
 * Choix (ST 7.2, « Choix techniques ») : une simple **hiérarchie de rôles**
 * (`UTILISATEUR` < `MODERATEUR` < `ADMIN`) plutôt qu'un système de permissions
 * granulaires — l'équipe de modération peut être l'équipe de développement au
 * démarrage (cahier des charges §7). `ADMIN` n'ouvre aujourd'hui aucune action
 * de plus que `MODERATEUR` sur le dashboard ; le rang est là pour accueillir
 * sans migration une future action réservée (gestion des rôles, purge de
 * comptes).
 */

/** Rôle applicatif — miroir client-safe de l'enum Prisma `RoleUtilisateur`. */
export type RoleUtilisateur = "UTILISATEUR" | "MODERATEUR" | "ADMIN";

export const ROLES_UTILISATEUR: readonly RoleUtilisateur[] = [
  "UTILISATEUR",
  "MODERATEUR",
  "ADMIN",
];

/**
 * Rang de chaque rôle dans la hiérarchie. Un rôle « couvre » tous les rôles de
 * rang inférieur ou égal.
 */
const RANG_ROLE: Record<RoleUtilisateur, number> = {
  UTILISATEUR: 0,
  MODERATEUR: 1,
  ADMIN: 2,
};

/** `true` si `valeur` est un rôle connu (garde-fou sur une donnée externe). */
export function estRoleConnu(valeur: unknown): valeur is RoleUtilisateur {
  return (
    typeof valeur === "string" &&
    (ROLES_UTILISATEUR as readonly string[]).includes(valeur)
  );
}

/**
 * `true` si `role` est au moins aussi élevé que `minimum` dans la hiérarchie.
 * Une valeur de `role` inconnue (donnée corrompue) est traitée comme le rôle
 * le plus faible — jamais une élévation de privilège par défaut.
 */
export function aAuMoinsLeRole(
  role: RoleUtilisateur | string | null | undefined,
  minimum: RoleUtilisateur
): boolean {
  const rang = estRoleConnu(role) ? RANG_ROLE[role] : -1;
  return rang >= RANG_ROLE[minimum];
}

/** `true` si le rôle donne accès au dashboard de modération (`MODERATEUR` ou `ADMIN`). */
export function peutModerer(
  role: RoleUtilisateur | string | null | undefined
): boolean {
  return aAuMoinsLeRole(role, "MODERATEUR");
}

/**
 * Levée quand un compte authentifié tente une action qui exige un rôle plus
 * élevé — l'endpoint la traduit en `403` (à distinguer du `401` « pas de
 * session » : ici l'identité est prouvée, c'est l'autorisation qui manque).
 */
export class RoleInsuffisantError extends Error {
  readonly roleRequis: RoleUtilisateur;
  constructor(roleRequis: RoleUtilisateur) {
    super("Vous n'avez pas les droits nécessaires pour cette action.");
    this.name = "RoleInsuffisantError";
    this.roleRequis = roleRequis;
  }
}
