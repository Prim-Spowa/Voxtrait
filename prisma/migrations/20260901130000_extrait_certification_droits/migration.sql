-- Migration : certification des droits à l'import
-- (ST 5.2 « Certification des droits à l'import »).
--
-- Ajoute sur `extraits` la trace de la certification faite par l'utilisateur
-- au moment de l'import (case à cocher obligatoire, ST 5.2 découpage point 1) :
--  - `certification_droits_le`      : horodatage de la certification ;
--  - `certification_droits_version` : version du texte certifié (cf.
--                                     `CERTIFICATION_DROITS_VERSION` dans
--                                     src/lib/certificationDroits.ts).
--
-- Colonnes nullables : les extraits existants (seed/admin, ou importés avant
-- cette migration) n'ont pas de certification individuelle.

-- AlterTable
ALTER TABLE "extraits"
    ADD COLUMN "certification_droits_le" TIMESTAMP(3),
    ADD COLUMN "certification_droits_version" TEXT;
