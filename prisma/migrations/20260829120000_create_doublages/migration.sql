-- Migration : table `doublages` (ST 6.1 « Sauvegarde privée d'un doublage »).
--
-- ⚠️ Migration écrite rétroactivement dans le cadre de ST 9.1 (bascule
-- intégrale sur PostgreSQL) : le modèle `Doublage` est présent dans
-- `prisma/schema.prisma` depuis ST 6.1 et des migrations ultérieures
-- (`20260904130000_moderation_dashboard`, `20260904140000_notice_and_takedown`)
-- lui appliquent déjà des `ALTER TABLE "doublages"`, mais aucune migration ne
-- créait la table elle-même — gap repéré et documenté (hors périmètre) dans
-- les notes de dev de ST 8.1, et qui empêchait `prisma migrate deploy` de
-- fonctionner sur une base vierge (`P3018` : « la relation doublages
-- n'existe pas »). Corrigé ici car ST 9.1 est précisément la story qui
-- exige qu'un déploiement Postgres complet (dev, CI, prod) fonctionne de
-- bout en bout sans étape manuelle.

-- CreateEnum
CREATE TYPE "VisibiliteDoublage" AS ENUM ('PRIVEE', 'PUBLIC');

-- CreateTable
CREATE TABLE "doublages" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "extrait_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "fichier_url" TEXT NOT NULL,
    "visibilite" "VisibiliteDoublage" NOT NULL DEFAULT 'PRIVEE',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doublages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Idempotence de la sauvegarde (cf. `sauvegarderDoublage`, un seul
-- enregistrement par job de génération et par compte).
CREATE UNIQUE INDEX "doublages_utilisateur_id_job_id_key" ON "doublages"("utilisateur_id", "job_id");

-- CreateIndex
-- Listing de l'espace privé (« mon historique », ST 6.2), le plus récent
-- d'abord.
CREATE INDEX "doublages_utilisateur_id_date_creation_idx" ON "doublages"("utilisateur_id", "date_creation");

-- AddForeignKey
-- `ON DELETE CASCADE` : la suppression d'un compte emporte les doublages
-- qu'il a sauvegardés (même posture que `favoris.utilisateur_id`, ST 8.1).
ALTER TABLE "doublages"
    ADD CONSTRAINT "doublages_utilisateur_id_fkey"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
