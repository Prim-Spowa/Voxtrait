-- Migration initiale : table `extraits` (ST 1.1) + index de recherche texte.
--
-- NB : cette migration a été réécrite pour inclure la création de la table
-- (initialement absente ici, ce qui causait l'erreur P1014 "the underlying
-- table ... does not exist" lors de l'application de l'index pg_trgm sur une
-- table qui n'existait pas encore).

-- CreateEnum
CREATE TYPE "OrigineExtrait" AS ENUM ('FR', 'US', 'JP');

-- CreateEnum
CREATE TYPE "TypeExtrait" AS ENUM ('FILM', 'SERIE', 'DESSIN_ANIME');

-- CreateEnum
CREATE TYPE "SourceExtrait" AS ENUM ('EMBED', 'UPLOAD');

-- CreateEnum
CREATE TYPE "StatutModeration" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REJETE', 'RETRAIT_MODERATION', 'RETRAIT_AYANT_DROIT');

-- CreateTable
CREATE TABLE "extraits" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "origine" "OrigineExtrait" NOT NULL,
    "type" "TypeExtrait" NOT NULL,
    "source" "SourceExtrait" NOT NULL,
    "url_source" TEXT NOT NULL,
    "thumbnail" TEXT,
    "statut" "StatutModeration" NOT NULL DEFAULT 'EN_ATTENTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extraits_statut_origine_type_idx" ON "extraits"("statut", "origine", "type");

-- CreateIndex
CREATE INDEX "extraits_created_at_idx" ON "extraits"("created_at");

-- Recherche texte sur `extraits.titre` (cf. ST 1.1 — "Ajouter l'indexation/recherche
-- texte (ex. pg_trgm ou recherche full-text Postgres)").
--
-- pg_trgm est utilisé plutôt qu'un index GIN full-text classique (to_tsvector) car il
-- supporte nativement la recherche "contains"/partielle (ILIKE '%terme%') sans nécessiter
-- de dictionnaire linguistique par langue — pertinent ici puisque les titres mélangent
-- français, anglais et japonais romanisé (cf. cahier des charges, catalogue FR/US/JP).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS extraits_titre_trgm_idx
  ON extraits
  USING GIN (titre gin_trgm_ops);
