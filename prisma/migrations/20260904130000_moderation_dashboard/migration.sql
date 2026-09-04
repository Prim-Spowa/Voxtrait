-- Migration : dashboard de modération (ST 7.2 « Dashboard de modération »).
--
-- Trois changements :
--   1. rôle applicatif sur `utilisateurs` (`utilisateur` / `moderateur` /
--      `admin`) — RBAC minimal du dashboard (cf. `src/lib/authz.ts`) ;
--   2. statut de modération sur `doublages` — permet de retirer un doublage
--      suite à un signalement fondé, comme on retire déjà un `Extrait` ;
--   3. table `decisions_moderation` — journal append-only des décisions
--      (traçabilité, ST 7.2 tâche 4 ; base du reporting des délais, ST 7.3).

-- CreateEnum
CREATE TYPE "RoleUtilisateur" AS ENUM ('UTILISATEUR', 'MODERATEUR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ActionModeration" AS ENUM ('REJET_SIGNALEMENT', 'RETRAIT_CONTENU', 'SUSPENSION_COMPTE');

-- AlterTable : rôle utilisateur (défaut `UTILISATEUR` — aucun compte existant
-- n'est promu automatiquement).
ALTER TABLE "utilisateurs"
    ADD COLUMN "role" "RoleUtilisateur" NOT NULL DEFAULT 'UTILISATEUR';

-- AlterTable : statut de modération d'un doublage (défaut `VALIDE` — les
-- doublages déjà sauvegardés restent visibles).
ALTER TABLE "doublages"
    ADD COLUMN "statut_moderation" "StatutModeration" NOT NULL DEFAULT 'VALIDE';

-- CreateTable
CREATE TABLE "decisions_moderation" (
    "id" TEXT NOT NULL,
    "action" "ActionModeration" NOT NULL,
    "moderateur_id" TEXT,
    "signalement_id" TEXT,
    "contenu_type" "TypeContenuSignale",
    "contenu_id" TEXT,
    "compte_cible_id" TEXT,
    "commentaire" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_moderation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Journal trié par récence (vue « historique des décisions »).
CREATE INDEX "decisions_moderation_date_creation_idx" ON "decisions_moderation"("date_creation");

-- CreateIndex
-- Retrouver les décisions liées à un signalement donné.
CREATE INDEX "decisions_moderation_signalement_id_idx" ON "decisions_moderation"("signalement_id");

-- AddForeignKey
-- `ON DELETE SET NULL` : la suppression d'un compte modérateur ne fait pas
-- disparaître les décisions qu'il a prises (le journal doit rester complet).
ALTER TABLE "decisions_moderation"
    ADD CONSTRAINT "decisions_moderation_moderateur_id_fkey"
    FOREIGN KEY ("moderateur_id") REFERENCES "utilisateurs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
