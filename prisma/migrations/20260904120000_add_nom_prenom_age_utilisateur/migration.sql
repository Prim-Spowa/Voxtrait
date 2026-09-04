-- Migration : ajout des colonnes nom / prénom / âge sur `utilisateurs`
-- (mise à jour de ST 4.1 « Inscription », découpage en tâches point 1).
--
-- Colonnes ajoutées NOT NULL. Comme la table peut déjà contenir des lignes
-- (comptes créés avant cette mise à jour), on procède en deux temps, motif
-- standard pour une colonne requise ajoutée après coup :
--   1. ajout avec une valeur par défaut transitoire ;
--   2. suppression du défaut, pour que toute nouvelle ligne doive fournir
--      explicitement une valeur (le défaut ne sert qu'au backfill des lignes
--      existantes, il n'est pas destiné à durer).
-- Les lignes déjà existantes se retrouvent avec des valeurs de repli
-- (`''`, `0`) manifestement incomplètes : un script de backfill applicatif
-- (ou une purge, en l'absence d'environnement réel à ce stade — cf. notes de
-- dev) est nécessaire avant mise en production si des comptes réels existent.

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN "nom" TEXT NOT NULL DEFAULT '';
ALTER TABLE "utilisateurs" ADD COLUMN "prenom" TEXT NOT NULL DEFAULT '';
ALTER TABLE "utilisateurs" ADD COLUMN "age" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "utilisateurs" ALTER COLUMN "nom" DROP DEFAULT;
ALTER TABLE "utilisateurs" ALTER COLUMN "prenom" DROP DEFAULT;
ALTER TABLE "utilisateurs" ALTER COLUMN "age" DROP DEFAULT;
