/**
 * Adaptateur `ExtraitLibraryWriter` (`lib/import.ts`) → `prisma.extrait.create`
 * — extrait de `src/app/api/import/route.ts` (ST 9.3) pour être réutilisable
 * depuis le worker de compression (`scripts/worker.ts`), qui appelle
 * `runImportJob` en dehors de toute requête HTTP.
 *
 * L'extrait est créé `source = UPLOAD` et `statut = EN_ATTENTE` (« en attente
 * de modération », Epic 7) — comportement inchangé depuis ST 5.1/ST 5.2.
 */

import { prisma } from "@/lib/prisma";
import type { ExtraitLibraryWriter } from "@/lib/import";

export function prismaExtraitLibraryWriter(): ExtraitLibraryWriter {
  return {
    async create(input) {
      const created = await prisma.extrait.create({
        data: {
          titre: input.titre,
          origine: input.origine,
          type: input.type,
          source: "UPLOAD",
          urlSource: input.urlSource,
          statut: "EN_ATTENTE",
          dureeSecondes: input.dureeSecondes,
          importeParId: input.importeParId,
          certificationDroitsLe: input.certificationDroitsLe,
          certificationDroitsVersion: input.certificationDroitsVersion,
        },
        select: { id: true },
      });
      return created;
    },
  };
}
