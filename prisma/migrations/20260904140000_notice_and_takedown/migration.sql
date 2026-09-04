-- Migration : procédure notice-and-takedown (ST 7.3 « Procédure
-- notice-and-takedown »).
--
-- Trois changements :
--   1. valeur d'enum `RETRAIT_AYANT_DROIT` sur `ActionModeration` — distingue,
--      dans le journal des décisions, un retrait décidé sur demande d'un ayant
--      droit d'un retrait de modération classique (reporting séparé des délais) ;
--   2. colonne `demande_retrait_id` + index `(action, date_creation)` sur
--      `decisions_moderation` — rattacher une décision à la demande d'origine et
--      requêter efficacement les retraits ayant droit sur une période ;
--   3. table `demandes_retrait` — réclamations des ayants droit (point de
--      contact, tâche 2).
--
-- La valeur `RETRAIT_AYANT_DROIT` de l'enum `StatutModeration` (statut de
-- contenu) existe déjà (créée avec l'enum) : rien à ajouter côté `extraits` /
-- `doublages`.

-- AlterEnum : nouvelle valeur d'action journalisée.
ALTER TYPE "ActionModeration" ADD VALUE 'RETRAIT_AYANT_DROIT';

-- CreateEnum
CREATE TYPE "StatutDemandeRetrait" AS ENUM ('EN_ATTENTE', 'TRAITEE', 'REJETEE');

-- AlterTable : rattachement d'une décision à une demande de retrait.
ALTER TABLE "decisions_moderation"
    ADD COLUMN "demande_retrait_id" TEXT;

-- CreateIndex : reporting des retraits ayant droit (délais de traitement).
CREATE INDEX "decisions_moderation_action_date_creation_idx"
    ON "decisions_moderation"("action", "date_creation");

-- CreateTable
CREATE TABLE "demandes_retrait" (
    "id" TEXT NOT NULL,
    "contenu_type" "TypeContenuSignale" NOT NULL,
    "contenu_id" TEXT NOT NULL,
    "oeuvre" TEXT NOT NULL,
    "demandeur_nom" TEXT NOT NULL,
    "demandeur_email" TEXT NOT NULL,
    "demandeur_organisation" TEXT,
    "motif" TEXT NOT NULL,
    "declaration_bonne_foi" BOOLEAN NOT NULL,
    "statut" "StatutDemandeRetrait" NOT NULL DEFAULT 'EN_ATTENTE',
    "commentaire_traitement" TEXT,
    "traitee_par_id" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_traitement" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demandes_retrait_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- File de traitement : demandes en attente, les plus anciennes d'abord.
CREATE INDEX "demandes_retrait_statut_date_creation_idx"
    ON "demandes_retrait"("statut", "date_creation");

-- CreateIndex
-- Rapprocher une demande des signalements / décisions du même contenu.
CREATE INDEX "demandes_retrait_contenu_type_contenu_id_idx"
    ON "demandes_retrait"("contenu_type", "contenu_id");

-- AddForeignKey
-- `ON DELETE SET NULL` : le départ d'un modérateur ne fait pas disparaître la
-- trace du traitement d'une demande.
ALTER TABLE "demandes_retrait"
    ADD CONSTRAINT "demandes_retrait_traitee_par_id_fkey"
    FOREIGN KEY ("traitee_par_id") REFERENCES "utilisateurs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
