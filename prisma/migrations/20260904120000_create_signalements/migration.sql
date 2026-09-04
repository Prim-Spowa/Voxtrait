-- Migration : table `signalements` (ST 7.1 « Signalement de contenu »).
--
-- Un signalement vise un contenu (`contenu_type` + `contenu_id`) et porte un
-- `motif` obligatoire (texte libre). L'auteur est **optionnel** : le
-- signalement est ouvert aux visiteurs non connectés (cf. cahier des charges
-- §3-4). `contenu_id` n'est pas une clé étrangère : il peut viser un `Extrait`
-- comme un job de doublage (ST 3.1, sans table). Le traitement des
-- signalements (retrait / rejet) relève du dashboard de modération (ST 7.2).

-- CreateEnum
CREATE TYPE "TypeContenuSignale" AS ENUM ('EXTRAIT', 'DOUBLAGE');

-- CreateEnum
CREATE TYPE "StatutSignalement" AS ENUM ('EN_ATTENTE', 'RETENU', 'REJETE');

-- CreateTable
CREATE TABLE "signalements" (
    "id" TEXT NOT NULL,
    "contenu_type" "TypeContenuSignale" NOT NULL,
    "contenu_id" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "auteur_id" TEXT,
    "statut" "StatutSignalement" NOT NULL DEFAULT 'EN_ATTENTE',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signalements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- File de modération (ST 7.2) : signalements en attente, les plus anciens d'abord.
CREATE INDEX "signalements_statut_date_creation_idx" ON "signalements"("statut", "date_creation");

-- CreateIndex
-- Regrouper les signalements visant un même contenu.
CREATE INDEX "signalements_contenu_type_contenu_id_idx" ON "signalements"("contenu_type", "contenu_id");

-- AddForeignKey
-- `ON DELETE SET NULL` : supprimer un compte ne fait pas disparaître les
-- signalements qu'il a émis (utile au suivi de modération).
ALTER TABLE "signalements"
    ADD CONSTRAINT "signalements_auteur_id_fkey"
    FOREIGN KEY ("auteur_id") REFERENCES "utilisateurs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
