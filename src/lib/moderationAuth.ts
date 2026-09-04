/**
 * Garde d'accès des routes de modération — ST 7.2 « Dashboard de modération »,
 * découpage en tâches point 2 : « Endpoint de listing des signalements en
 * attente (**protégé par rôle**) ».
 *
 * Contrôle en deux temps, cohérent avec le reste du projet (ST 4.2) :
 *  - le middleware Edge (`src/middleware.ts`) barre l'accès aux chemins
 *    `/admin/moderation*` sans cookie de session (garde-fou UX) ;
 *  - ici (runtime Node), on **vérifie** le jeton (`readActiveSessionFromCookieStore`,
 *    `node:crypto` + révocation Redis, ST 9.4), on relit le compte en base
 *    (il a pu être supprimé / suspendu / rétrogradé depuis) et on exige le
 *    rôle `MODERATEUR`.
 *
 * Serveur uniquement (importe `@/lib/prisma` via les adaptateurs). Ne pas
 * importer depuis un composant client.
 */

import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import type { UtilisateurDelegate } from "@/lib/auth";
import { readActiveSessionFromCookieStore, type ReadonlyCookieStore } from "@/lib/session";
import { peutModerer, RoleInsuffisantError, type RoleUtilisateur } from "@/lib/authz";

/** Aucune session valide — mène à un `401`. */
export class NonAuthentifieError extends Error {
  constructor() {
    super("Authentification requise.");
    this.name = "NonAuthentifieError";
  }
}

export interface ModerateurCourant {
  utilisateurId: string;
  role: RoleUtilisateur;
}

/**
 * Résout le modérateur courant à partir du store de cookies, ou lève :
 *  - `NonAuthentifieError` (`401`) : cookie absent / jeton invalide / expiré,
 *    ou compte introuvable / suspendu ;
 *  - `RoleInsuffisantError` (`403`) : compte valide mais rôle < `MODERATEUR`.
 */
export async function exigerModerateur(
  cookieStore: ReadonlyCookieStore
): Promise<ModerateurCourant> {
  const payload = await readActiveSessionFromCookieStore(cookieStore);
  if (!payload) throw new NonAuthentifieError();

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : (prisma.utilisateur as unknown as UtilisateurDelegate);

  const user = await delegate.findFirst({ where: { id: payload.sub } });
  if (!user || user.statut === "SUSPENDU") throw new NonAuthentifieError();

  const role = (user.role ?? "UTILISATEUR") as RoleUtilisateur;
  if (!peutModerer(role)) throw new RoleInsuffisantError("MODERATEUR");

  return { utilisateurId: user.id, role };
}
