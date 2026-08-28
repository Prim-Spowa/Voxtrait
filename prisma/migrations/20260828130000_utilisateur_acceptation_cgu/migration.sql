-- Migration : acceptation des CGU (ST 4.3 « Acceptation des CGU (fan-usage) »).
--
-- Ajoute sur `utilisateurs` la trace de l'acceptation des CGU :
--  - `cgu_acceptees_le`     : horodatage de l'acceptation (preuve datée) ;
--  - `cgu_version_acceptee` : version du texte acceptée (cf. `CGU_VERSION`
--                             dans src/lib/cgu.ts), pour redemander
--                             l'acceptation si les CGU évoluent.
--
-- Colonnes nullables : les comptes créés avant cette migration n'ont pas
-- encore accepté la version courante — ils seront invités à le faire au
-- premier import (cf. `peutImporter` / `aAccepteCguActuelles`).

-- AlterTable
ALTER TABLE "utilisateurs"
    ADD COLUMN "cgu_acceptees_le" TIMESTAMP(3),
    ADD COLUMN "cgu_version_acceptee" TEXT;
