/**
 * Garde d'accès commune aux endpoints d'import (ST 5.1) — combine le contrôle
 * de session (ST 4.2) et l'acceptation des CGU (ST 4.3, qui « bloque ST 5.1 »).
 *
 * Serveur uniquement (`readActiveSessionFromCookieStore` → `node:crypto` +
 * révocation Redis, ST 9.4). Regroupée
 * ici pour que `POST /api/import/upload-url`, `POST /api/import` et
 * `GET /api/import/:id` appliquent exactement la même règle sans la
 * dupliquer.
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isMockDataSource } from "@/lib/config";
import { mockUtilisateurDelegate } from "@/lib/mocks/auth.mock";
import type { UtilisateurDelegate } from "@/lib/auth";
import { readActiveSessionFromCookieStore } from "@/lib/session";
import { peutImporter, raisonBlocageImport } from "@/lib/cgu";

export type ImportAccess =
  | { ok: true; utilisateurId: string }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Résout l'utilisateur autorisé à importer.
 *
 *  - `401` : pas de session valide, ou compte introuvable/suspendu (le jeton
 *    a pu survivre à une suppression/suspension — on relit la source de
 *    vérité, comme `GET /api/auth/session`) ;
 *  - `403` : session valide mais CGU non acceptées (ou version périmée) —
 *    le message renvoyé (`raisonBlocageImport`) invite à (ré)accepter via
 *    `POST /api/auth/cgu` ;
 *  - `ok` : `utilisateurId` prêt à être utilisé comme `importeParId`.
 */
export async function resolveImportAccess(): Promise<ImportAccess> {
  const payload = await readActiveSessionFromCookieStore(cookies());
  if (!payload) {
    return {
      ok: false,
      status: 401,
      error: "Vous devez être connecté·e pour importer une vidéo.",
    };
  }

  const delegate: UtilisateurDelegate = isMockDataSource()
    ? mockUtilisateurDelegate
    : prisma.utilisateur;

  const user = await delegate.findFirst({ where: { id: payload.sub } });
  if (!user || user.statut === "SUSPENDU") {
    return {
      ok: false,
      status: 401,
      error: "Votre session n'est plus valide. Reconnectez-vous.",
    };
  }

  if (!peutImporter(user)) {
    return {
      ok: false,
      status: 403,
      error:
        raisonBlocageImport(user) ??
        "Vous devez accepter les conditions générales d'utilisation avant d'importer.",
    };
  }

  return { ok: true, utilisateurId: user.id };
}
